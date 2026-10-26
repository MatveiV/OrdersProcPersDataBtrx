'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { capitalizeSentences, normalizeResult, sanitizeReply } = require('../gigachat');

test('capitalizeSentences поднимает регистр после точки, восклицания и перевода строки', () => {
  assert.equal(
    capitalizeSentences(
      'мы получили запрос. отправим предложение! если есть вопросы — спрашивайте.\nследующий шаг: позвонить.'
    ),
    'Мы получили запрос. Отправим предложение! Если есть вопросы — спрашивайте.\nСледующий шаг: позвонить.'
  );
});

test('capitalizeSentences не трогает телефоны, адреса и e-mail', () => {
  assert.equal(
    capitalizeSentences('Телефон +7 495 120-45-67, почта a.kuznetsova@example.com.'),
    'Телефон +7 495 120-45-67, почта a.kuznetsova@example.com.'
  );
});

test('sanitizeReply убирает лишние пробелы и восстанавливает регистр', () => {
  const result = sanitizeReply(
    'Здравствуйте!  Мы получили ваш запрос на мебель для офиса на 40 рабочих мест. отправим вам коммерческое предложение.  Пожалуйста,  уточните сроки.'
  );

  assert.equal(
    result,
    'Здравствуйте! Мы получили ваш запрос на мебель для офиса на 40 рабочих мест. Отправим вам коммерческое предложение. Пожалуйста, уточните сроки.'
  );
});

function buildRaw(overrides = {}) {
  return {
    company: 'Альфа-Логистик',
    summary: 'Запрос на мебель для офиса.',
    lead_type: 'целевой',
    key_data: {
      company: 'Альфа-Логистик',
      contact_person: 'Анна Кузнецова',
      contact: '+7 495 120-45-67',
      product: 'столы, кресла',
      quantity: '40 рабочих мест',
      budget: '1,5 млн рублей',
      deadline: 'в начале месяца',
      address: 'Москва'
    },
    missing_data: [],
    next_step: 'Отправить коммерческое предложение.',
    reply_draft: 'Здравствуйте! Отправим вам коммерческое предложение.',
    needs_human: false,
    human_reason: 'не требуется',
    ...overrides
  };
}

test('normalizeResult добавляет «точное количество» для расплывчатого количества', () => {
  const raw = buildRaw();
  raw.key_data.quantity = 'несколько штук';
  raw.missing_data = ['бюджет', 'сроки'];

  const result = normalizeResult(raw);

  assert.deepEqual(result.missing_data, ['бюджет', 'сроки', 'точное количество']);
});

test('normalizeResult не добавляет «точное количество», если количество точное', () => {
  const result = normalizeResult(buildRaw());
  assert.equal(result.missing_data.some((item) => item.includes('количеств')), false);
});

test('normalizeResult дополняет next_step пропущенным «точным количеством»', () => {
  const raw = buildRaw();
  raw.key_data.quantity = 'несколько штук';
  raw.key_data.budget = 'не указано';
  raw.missing_data = ['бюджет', 'сроки'];
  raw.next_step = 'Уточнить у клиента бюджет и сроки.';

  const result = normalizeResult(raw);

  assert.deepEqual(result.missing_data, ['бюджет', 'сроки', 'точное количество']);
  assert.match(result.next_step, /^Уточнить у клиента бюджет и сроки, а также точное количество\.$/);
});

test('normalizeResult не переписывает next_step, если все пункты уже названы', () => {
  const raw = buildRaw();
  raw.key_data.budget = 'не указано';
  raw.missing_data = ['бюджет'];
  raw.next_step = 'Уточнить у клиента бюджет.';

  const result = normalizeResult(raw);

  assert.equal(result.next_step, 'Уточнить у клиента бюджет.');
});

test('normalizeResult не выдумывает отделы для нецелевого запроса', () => {
  const raw = buildRaw({
    lead_type: 'нецелевой',
    summary: 'Предложение о разработке мобильного приложения.',
    next_step: 'Передать заявку в отдел по работе с нецелевыми обращениями.'
  });

  const result = normalizeResult(raw);

  assert.equal(result.lead_type, 'нецелевой');
  assert.equal(result.next_step, 'Ответить вежливым отказом и не передавать заявку в работу.');
});

test('normalizeResult оставляет жалобу человеку и её причину', () => {
  const raw = buildRaw({
    lead_type: 'неясно',
    needs_human: true,
    human_reason: 'Жалоба на задержку доставки и угроза возврата предоплаты.',
    summary: 'Жалоба на задержку доставки.'
  });

  const result = normalizeResult(raw);

  assert.equal(result.needs_human, true);
  assert.match(result.human_reason, /Жалоба/);
});
