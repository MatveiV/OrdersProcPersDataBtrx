'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BitrixError,
  DEAL_FIELDS,
  buildContactFields,
  buildTitle,
  buildUserFields,
  clearFieldCache,
  ensureDealFields,
  isConfigured,
  parseBudget,
  readConfig,
  resolveEnumId,
  syncLead
} = require('../bitrix');

const WEBHOOK = 'https://example.bitrix24.ru/rest/1/test-token/';

function buildFieldList() {
  return DEAL_FIELDS.map((definition, index) => {
    const field = {
      FIELD_NAME: `UF_CRM_${definition.code}`,
      USER_TYPE_ID: definition.type,
      SORT: 100 + index * 10
    };

    if (definition.type === 'enumeration') {
      field.LIST = definition.list.map((value, itemIndex) => ({
        ID: String(200 + itemIndex),
        VALUE: value,
        SORT: (itemIndex + 1) * 10
      }));
    }

    return field;
  });
}

function createFakeFetch(routes) {
  const calls = [];

  const fetchImpl = async (url, init) => {
    const method = url.split('/').pop().replace(/\.json$/, '');
    const body = JSON.parse((init && init.body) || '{}');
    calls.push({ method, body });

    if (!Object.prototype.hasOwnProperty.call(routes, method)) {
      throw new Error(`Неожиданный метод: ${method}`);
    }

    const route = routes[method];
    const result = typeof route === 'function' ? route(body, calls) : route;

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result })
    };
  };

  return { fetchImpl, calls };
}

function buildFields() {
  return {
    name: 'Марина Соколова',
    phone: '+7 999 123-45-67',
    email: 'marinas@example.com',
    company: 'Вектор-Медиа',
    address: 'Москва, ул. Ленинская Слобода, 19',
    text: 'Нужны письменные столы и кресла на 25 рабочих мест.'
  };
}

function buildData() {
  return {
    company: 'Вектор-Медиа',
    summary: 'Нужна мебель для нового этажа.',
    lead_type: 'целевой',
    key_data: {
      company: 'Вектор-Медиа',
      contact_person: 'Марина Соколова',
      contact: '+7 999 123-45-67',
      product: 'Столы и кресла',
      quantity: '25 рабочих мест',
      budget: '2,3 млн рублей',
      deadline: 'до 15 декабря',
      address: 'Москва, ул. Ленинская Слобода, 19'
    },
    missing_data: ['Точная дата поставки'],
    next_step: 'Отправить коммерческое предложение.',
    reply_draft: 'Здравствуйте! Спасибо за заявку, подготовим предложение.',
    needs_human: true,
    human_reason: 'Крупный заказ, нужна проверка менеджера.'
  };
}

function baseEnv() {
  return {
    B24_URL: WEBHOOK,
    B24_RESPONSIBLE_ID: '1'
  };
}

test('parseBudget разбирает типовые формулировки бюджета', () => {
  assert.equal(parseBudget('2,3 млн рублей'), 2_300_000);
  assert.equal(parseBudget('1.5 млн'), 1_500_000);
  assert.equal(parseBudget('1 500 000 ₽'), 1_500_000);
  assert.equal(parseBudget('100 тыс. рублей'), 100_000);
  assert.equal(parseBudget('до 500 000'), 500_000);
  assert.equal(parseBudget('2 млрд рублей'), 2_000_000_000);
  assert.equal(parseBudget('бюджет пока не определили'), null);
  assert.equal(parseBudget('не указано'), null);
  assert.equal(parseBudget(''), null);
});

test('buildTitle использует компанию и дату', () => {
  const now = new Date(2026, 9, 26, 12, 0, 0);
  const title = buildTitle({
    fields: buildFields(),
    data: buildData(),
    now
  });

  assert.equal(title, 'Заявка с сайта: Вектор-Медиа от 26.10.2026');
});

test('buildContactFields собирает имя и мультиполя', () => {
  const fields = buildContactFields({
    fields: buildFields(),
    data: buildData(),
    config: { responsibleId: 1 },
    companyId: 501
  });

  assert.equal(fields.name, 'Марина Соколова');
  assert.equal(fields.companyId, 501);
  assert.deepEqual(fields.fm, [
    { typeId: 'PHONE', valueType: 'WORK', value: '+7 999 123-45-67' },
    { typeId: 'EMAIL', valueType: 'WORK', value: 'marinas@example.com' }
  ]);
});

test('buildUserFields подставляет ID значения списка и флаг', () => {
  const meta = new Map([
    ['UF_CRM_AI_LEAD_TYPE', { USER_TYPE_ID: 'enumeration', LIST: [
      { ID: '200', VALUE: 'целевой' },
      { ID: '201', VALUE: 'нецелевой' }
    ] }],
    ['UF_CRM_AI_NEEDS_HUMAN', { USER_TYPE_ID: 'boolean' }],
    ['UF_CRM_AI_SUMMARY', { USER_TYPE_ID: 'string' }]
  ]);

  const fields = buildUserFields({
    meta,
    data: buildData(),
    fields: buildFields(),
    requestId: 'req-1',
    metaText: 'Модель: GigaChat'
  });

  assert.equal(fields['UF_CRM_AI_LEAD_TYPE'], 200);
  assert.equal(fields['UF_CRM_AI_NEEDS_HUMAN'], true);
  assert.equal(fields['UF_CRM_AI_SUMMARY'], 'Нужна мебель для нового этажа.');
  assert.equal(fields['UF_CRM_AI_REQUEST_ID'], undefined);
});

test('resolveEnumId возвращает null для неизвестного значения', () => {
  const meta = new Map([
    ['UF_CRM_AI_LEAD_TYPE', { USER_TYPE_ID: 'enumeration', LIST: [
      { ID: '200', VALUE: 'целевой' }
    ] }]
  ]);

  assert.equal(resolveEnumId(meta, 'UF_CRM_AI_LEAD_TYPE', 'нецелевой'), null);
  assert.equal(resolveEnumId(meta, 'UF_CRM_AI_LEAD_TYPE', 'целевой'), 200);
});

test('isConfigured проверяет формат ссылки вебхука', () => {
  assert.equal(isConfigured({ B24_URL: WEBHOOK }), true);
  assert.equal(isConfigured({ B24_URL: 'https://example.bitrix24.ru/rest/1/token' }), true);
  assert.equal(isConfigured({ B24_URL: '' }), false);
  assert.equal(isConfigured({ B24_URL: 'http://example.bitrix24.ru/rest/1/token/' }), false);
  assert.equal(isConfigured({ B24_URL: WEBHOOK, B24_ENABLED: 'false' }), false);
});

test('readConfig подставляет значения по умолчанию', () => {
  const config = readConfig(baseEnv());

  assert.equal(config.url, 'https://example.bitrix24.ru/rest/1/test-token');
  assert.equal(config.sourceId, 'WEB');
  assert.equal(config.currencyId, 'RUB');
  assert.equal(config.taskOnHuman, true);
  assert.equal(config.notifyOnHuman, true);
  assert.equal(config.timeline, true);
});

test('syncLead создаёт компанию, контакт, сделку, задачу и уведомление', async () => {
  clearFieldCache();

  const { fetchImpl, calls } = createFakeFetch({
    'crm.deal.userfield.list': buildFieldList(),
    'crm.deal.list': [],
    'crm.company.list': [],
    'crm.item.add': (body) => {
      if (body.entityTypeId === 4) return { item: { id: 501 } };
      if (body.entityTypeId === 3) return { item: { id: 502 } };
      if (body.entityTypeId === 2) return { item: { id: 503 } };
      throw new Error(`Неизвестный entityTypeId: ${body.entityTypeId}`);
    },
    'crm.duplicate.findbycomm': {},
    'crm.timeline.comment.add': 1,
    profile: { ID: '1' },
    'tasks.task.add': { task: { id: 601 } },
    'im.notify': true
  });

  const result = await syncLead({
    fields: buildFields(),
    data: buildData(),
    meta: { model: 'GigaChat-2-Max', ms: 1200 },
    privacyStats: { total: 4 },
    requestId: 'req-1',
    env: baseEnv(),
    fetchImpl,
    now: new Date(2026, 9, 26, 12, 0, 0)
  });

  assert.equal(result.ok, true);
  assert.equal(result.dealId, 503);
  assert.equal(result.contactId, 502);
  assert.equal(result.companyId, 501);
  assert.equal(result.taskId, 601);
  assert.equal(result.existing, false);
  assert.deepEqual(result.links, {
    deal: 'https://example.bitrix24.ru/crm/deal/details/503/',
    contact: 'https://example.bitrix24.ru/crm/contact/details/502/',
    company: 'https://example.bitrix24.ru/crm/company/details/501/'
  });

  const companyCall = calls.find(
    (call) => call.method === 'crm.item.add' && call.body.entityTypeId === 4
  );
  assert.equal(companyCall.body.fields.title, 'Вектор-Медиа');

  const contactCall = calls.find(
    (call) => call.method === 'crm.item.add' && call.body.entityTypeId === 3
  );
  assert.equal(contactCall.body.fields.name, 'Марина Соколова');
  assert.equal(contactCall.body.fields.companyId, 501);

  const dealCall = calls.find(
    (call) => call.method === 'crm.item.add' && call.body.entityTypeId === 2
  );
  assert.equal(dealCall.body.useOriginalUfNames, 'Y');
  assert.equal(dealCall.body.fields.title, 'Заявка с сайта: Вектор-Медиа от 26.10.2026');
  assert.equal(dealCall.body.fields.categoryId, 0);
  assert.equal(dealCall.body.fields.stageId, 'NEW');
  assert.equal(dealCall.body.fields.currencyId, 'RUB');
  assert.equal(dealCall.body.fields.contactId, 502);
  assert.equal(dealCall.body.fields.companyId, 501);
  assert.equal(dealCall.body.fields.opportunity, 2_300_000);
  assert.equal(dealCall.body.fields['UF_CRM_AI_LEAD_TYPE'], 200);
  assert.equal(dealCall.body.fields['UF_CRM_AI_NEEDS_HUMAN'], true);
  assert.equal(dealCall.body.fields['UF_CRM_AI_REQUEST_ID'], 'req-1');
  assert.match(dealCall.body.fields.comments, /Марина Соколова/);
  assert.match(dealCall.body.fields.comments, /2,3 млн рублей/);
  assert.match(dealCall.body.fields.comments, /Крупный заказ/);

  const taskCall = calls.find((call) => call.method === 'tasks.task.add');
  assert.deepEqual(taskCall.body.fields.UF_CRM_TASK, ['D_503', 'C_502', 'CO_501']);
  assert.equal(taskCall.body.fields.RESPONSIBLE_ID, 1);

  const notifyCall = calls.find((call) => call.method === 'im.notify');
  assert.match(notifyCall.body.MESSAGE, /Заявка с сайта: Вектор-Медиа/);
});

test('syncLead переиспользует сделку с тем же ID запроса', async () => {
  clearFieldCache();

  const { fetchImpl, calls } = createFakeFetch({
    'crm.deal.userfield.list': buildFieldList(),
    'crm.deal.list': [{ ID: '700', CONTACT_ID: '701', COMPANY_ID: '702' }]
  });

  const result = await syncLead({
    fields: buildFields(),
    data: buildData(),
    meta: { model: 'GigaChat-2-Max', ms: 1000 },
    requestId: 'req-1',
    env: baseEnv(),
    fetchImpl
  });

  assert.equal(result.ok, true);
  assert.equal(result.existing, true);
  assert.equal(result.dealId, 700);
  assert.equal(result.contactId, 701);
  assert.equal(result.companyId, 702);
  assert.equal(
    calls.some((call) => call.method === 'crm.item.add'),
    false
  );
});

test('syncLead не маскирует ошибку вебхука и не раскрывает URL', async () => {
  clearFieldCache();

  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () =>
      JSON.stringify({
        error: 'INVALID_CREDENTIALS',
        error_description: 'Invalid request credentials'
      })
  });

  await assert.rejects(
    () =>
      syncLead({
        fields: buildFields(),
        data: buildData(),
        meta: { model: 'GigaChat-2-Max', ms: 1000 },
        requestId: 'req-1',
        env: baseEnv(),
        fetchImpl
      }),
    (error) => {
      assert.equal(error instanceof BitrixError, true);
      assert.equal(error.code, 'INVALID_CREDENTIALS');
      assert.equal(String(error.message).includes('test-token'), false);
      assert.equal(String(error.message).includes('https://'), false);
      return true;
    }
  );
});

test('ensureDealFields в режиме dry-run не создаёт поля', async () => {
  const { fetchImpl, calls } = createFakeFetch({
    'crm.deal.userfield.list': [{ FIELD_NAME: 'UF_CRM_AI_SUMMARY' }]
  });

  const result = await ensureDealFields({
    config: readConfig(baseEnv()),
    fetchImpl,
    dryRun: true
  });

  assert.equal(result.total, DEAL_FIELDS.length);
  assert.equal(result.existing.length, 1);
  assert.equal(result.created.length, DEAL_FIELDS.length - 1);
  assert.equal(
    calls.some((call) => call.method === 'crm.deal.userfield.add'),
    false
  );
});
