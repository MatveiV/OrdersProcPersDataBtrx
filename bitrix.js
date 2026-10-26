'use strict';

/**
 * Интеграция с Битрикс24 через входящий вебхук.
 *
 * Модуль не хранит персональные данные: он получает уже восстановленную
 * заявку, отправляет её в CRM и возвращает только идентификаторы созданных
 * сущностей. URL вебхука никогда не попадает в сообщения об ошибках и в логи.
 */

const crypto = require('node:crypto');

const NOT_SPECIFIED = 'не указано';
const FIELD_PREFIX = 'UF_CRM_';
const DEFAULT_TIMEOUT_MS = 12_000;
const RETRY_DELAYS_MS = [400, 1200];
const FIELD_CACHE_TTL_MS = 5 * 60_000;
const WEBHOOK_RE = /^https:\/\/[^/\s]+\/rest\/\d+\/[^/\s]+$/;

const RETRYABLE_CODES = new Set(['QUERY_LIMIT_EXCEEDED', 'OPERATION_TIME_LIMIT']);

const KEY_LABELS = {
  company: 'Компания',
  contact_person: 'Контактное лицо',
  contact: 'Контакт',
  product: 'Продукт или услуга',
  quantity: 'Количество',
  budget: 'Бюджет',
  deadline: 'Сроки',
  address: 'Адрес доставки'
};

const DEAL_FIELDS = [
  {
    code: 'AI_REQUEST_ID',
    label: 'ID запроса ИИ',
    type: 'string',
    rows: 1,
    searchable: true,
    showFilter: true
  },
  {
    code: 'AI_LEAD_TYPE',
    label: 'Тип лида (ИИ)',
    type: 'enumeration',
    list: ['целевой', 'нецелевой', 'неясно'],
    showFilter: true,
    showInList: true
  },
  {
    code: 'AI_SUMMARY',
    label: 'Резюме заявки (ИИ)',
    type: 'string',
    rows: 4
  },
  {
    code: 'AI_CONTACT_PERSON',
    label: 'Контактное лицо (ИИ)',
    type: 'string'
  },
  {
    code: 'AI_PRODUCT',
    label: 'Продукт или услуга (ИИ)',
    type: 'string'
  },
  {
    code: 'AI_QUANTITY',
    label: 'Количество (ИИ)',
    type: 'string'
  },
  {
    code: 'AI_BUDGET',
    label: 'Бюджет из заявки (ИИ)',
    type: 'string'
  },
  {
    code: 'AI_DEADLINE',
    label: 'Сроки (ИИ)',
    type: 'string'
  },
  {
    code: 'AI_ADDRESS',
    label: 'Адрес доставки (ИИ)',
    type: 'string',
    rows: 2
  },
  {
    code: 'AI_MISSING',
    label: 'Недостающие данные (ИИ)',
    type: 'string',
    rows: 4
  },
  {
    code: 'AI_NEXT_STEP',
    label: 'Следующий шаг (ИИ)',
    type: 'string'
  },
  {
    code: 'AI_REPLY_DRAFT',
    label: 'Черновик ответа (ИИ)',
    type: 'string',
    rows: 6
  },
  {
    code: 'AI_NEEDS_HUMAN',
    label: 'Нужен человек (ИИ)',
    type: 'boolean',
    showInList: true
  },
  {
    code: 'AI_HUMAN_REASON',
    label: 'Причина передачи человеку (ИИ)',
    type: 'string',
    rows: 2
  },
  {
    code: 'AI_META',
    label: 'Метаданные обработки (ИИ)',
    type: 'string',
    rows: 3
  },
  {
    code: 'CLIENT_ADDRESS',
    label: 'Адрес из формы',
    type: 'string',
    rows: 2
  }
];

class BitrixError extends Error {
  constructor({ code, message, hint = '', status = 502, retriable = false }) {
    super(message);
    this.name = 'BitrixError';
    this.code = code;
    this.userMessage = message;
    this.hint = hint;
    this.status = status;
    this.retriable = retriable;
  }
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'да', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'нет', 'off'].includes(normalized)) return false;
  return fallback;
}

function toPositiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function readConfig(env = process.env) {
  const source = env || {};
  const rawUrl = String(source.B24_URL || '').trim();

  return {
    url: rawUrl.replace(/\/+$/, ''),
    enabled: readBoolean(source.B24_ENABLED, true),
    responsibleId: toPositiveInt(source.B24_RESPONSIBLE_ID),
    sourceId: String(source.B24_SOURCE_ID || 'WEB').trim() || 'WEB',
    currencyId: String(source.B24_CURRENCY || 'RUB').trim() || 'RUB',
    taskOnHuman: readBoolean(source.B24_TASK_ON_HUMAN, true),
    notifyOnHuman: readBoolean(source.B24_NOTIFY_ON_HUMAN, true),
    timeline: readBoolean(source.B24_TIMELINE, true),
    timeoutMs: toPositiveInt(source.B24_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  };
}

function isConfigured(envOrConfig = process.env) {
  const config =
    envOrConfig && typeof envOrConfig === 'object' && 'url' in envOrConfig
      ? envOrConfig
      : readConfig(envOrConfig);

  return Boolean(config.enabled && config.url && WEBHOOK_RE.test(config.url));
}

function publicStatus(env = process.env) {
  return { configured: isConfigured(env) };
}

function describeError(code, status) {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return {
        message: 'Битрикс24 отклонил вебхук.',
        hint: 'Проверьте B24_URL в файле .env: ссылка входящего вебхука должна быть скопирована целиком.'
      };
    case 'insufficient_scope':
      return {
        message: 'У вебхука не хватает прав.',
        hint: 'Пересоздайте вебхук с правами crm, task и im и обновите B24_URL.'
      };
    case 'ACCESS_DENIED':
      return {
        message: 'В Битрикс24 недостаточно прав для этой операции.',
        hint: 'Вебхук должен быть создан пользователем с правами администратора CRM.'
      };
    case 'ERROR_METHOD_NOT_FOUND':
      return {
        message: 'Метод недоступен на этом портале Битрикс24.',
        hint: 'Проверьте, что REST API включён и портал работает на подходящем тарифе.'
      };
    case 'QUERY_LIMIT_EXCEEDED':
      return {
        message: 'Битрикс24 ограничил интенсивность запросов.',
        hint: 'Подождите несколько секунд и повторите обработку.'
      };
    case 'OPERATION_TIME_LIMIT':
      return {
        message: 'Битрикс24 прервал запрос по времени.',
        hint: 'Повторите обработку через несколько секунд.'
      };
    case 'NOT_CONFIGURED':
      return {
        message: 'Интеграция с Битрикс24 не настроена.',
        hint: 'Заполните B24_URL в файле .env и перезапустите приложение.'
      };
    case 'TIMEOUT':
      return {
        message: 'Битрикс24 не ответил вовремя.',
        hint: 'Проверьте интернет и повторите обработку.'
      };
    case 'NETWORK':
      return {
        message: 'Не удалось связаться с Битрикс24.',
        hint: 'Проверьте интернет и доступность портала, затем повторите обработку.'
      };
    default:
      return {
        message: `Битрикс24 вернул ошибку${code ? ` ${code}` : ''}.`,
        hint: status ? 'Повторите обработку позже.' : 'Проверьте настройки интеграции.'
      };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Вызывает метод REST API. Возвращает содержимое result.
 * Тело запроса и URL вебхука не выводятся в сообщения об ошибках.
 */
async function callMethod(method, params = {}, options = {}) {
  const config = options.config || readConfig();
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!config.url) {
    throw new BitrixError({
      code: 'NOT_CONFIGURED',
      ...describeError('NOT_CONFIGURED'),
      status: 503
    });
  }

  const timeoutMs = toPositiveInt(options.timeoutMs) || config.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries === undefined ? RETRY_DELAYS_MS.length : Number(options.retries);
  const url = `${config.url}/${method}.json`;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify(params || {})
        },
        timeoutMs
      );

      const raw = await response.text();
      let payload = null;

      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = null;
        }
      }

      if (payload && payload.error) {
        const code = String(payload.error);
        const retriable =
          RETRYABLE_CODES.has(code) || response.status === 429 || response.status === 503;
        const info = describeError(code, response.status);
        const error = new BitrixError({
          code,
          message: info.message,
          hint: info.hint,
          status: response.status || 502,
          retriable
        });

        if (retriable && attempt < maxRetries) {
          lastError = error;
          await sleep(RETRY_DELAYS_MS[attempt] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
          continue;
        }

        throw error;
      }

      if (!response.ok) {
        const error = new BitrixError({
          code: `HTTP_${response.status}`,
          message: `Битрикс24 ответил кодом ${response.status}.`,
          hint: 'Повторите обработку позже.',
          status: response.status,
          retriable: response.status >= 500
        });

        if (error.retriable && attempt < maxRetries) {
          lastError = error;
          await sleep(RETRY_DELAYS_MS[attempt] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
          continue;
        }

        throw error;
      }

      if (!payload || typeof payload !== 'object') {
        throw new BitrixError({
          code: 'BAD_RESPONSE',
          message: 'Битрикс24 вернул ответ в неожиданном формате.',
          hint: 'Повторите обработку. Если ошибка повторяется — проверьте настройки портала.',
          status: 502
        });
      }

      return Object.prototype.hasOwnProperty.call(payload, 'result') ? payload.result : payload;
    } catch (error) {
      if (error instanceof BitrixError) throw error;

      const aborted = error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      const code = aborted ? 'TIMEOUT' : 'NETWORK';
      const info = describeError(code);

      throw new BitrixError({
        code,
        message: info.message,
        hint: info.hint,
        status: aborted ? 504 : 502
      });
    }
  }

  throw (
    lastError ||
    new BitrixError({
      code: 'UNKNOWN',
      message: 'Не удалось выполнить запрос к Битрикс24.',
      hint: 'Повторите обработку позже.',
      status: 502
    })
  );
}

const fieldCache = new Map();
const profileCache = new Map();

function clearFieldCache() {
  fieldCache.clear();
}

async function listDealUserFields(options = {}) {
  const result = await callMethod('crm.deal.userfield.list', { order: { SORT: 'ASC' } }, options);
  return Array.isArray(result) ? result : [];
}

async function getDealFieldMeta(options = {}) {
  const config = options.config || readConfig();
  const cached = fieldCache.get(config.url);

  if (cached && Date.now() - cached.at < FIELD_CACHE_TTL_MS) {
    return cached.map;
  }

  const list = await listDealUserFields({ ...options, config });
  const map = new Map(list.map((field) => [String(field.FIELD_NAME), field]));
  fieldCache.set(config.url, { at: Date.now(), map });
  return map;
}

function toUserFieldPayload(definition, sort) {
  const payload = {
    FIELD_NAME: `${FIELD_PREFIX}${definition.code}`,
    USER_TYPE_ID: definition.type,
    XML_ID: `${FIELD_PREFIX}${definition.code}`,
    SORT: sort,
    MULTIPLE: 'N',
    MANDATORY: 'N',
    SHOW_FILTER: definition.showFilter ? 'Y' : 'N',
    SHOW_IN_LIST: definition.showInList ? 'Y' : 'N',
    EDIT_IN_LIST: 'Y',
    IS_SEARCHABLE: definition.searchable ? 'Y' : 'N',
    SETTINGS: {},
    LABEL: definition.label
  };

  if (definition.type === 'string') {
    payload.SETTINGS.ROWS = definition.rows || 1;
  }

  if (definition.type === 'boolean') {
    payload.SETTINGS.DEFAULT_VALUE = 0;
  }

  if (definition.type === 'enumeration') {
    payload.LIST = (definition.list || []).map((value, index) => ({
      VALUE: value,
      SORT: (index + 1) * 10,
      DEF: index === 0 ? 'Y' : 'N'
    }));
  }

  return payload;
}

/**
 * Идемпотентно создаёт пользовательские поля сделки.
 * Возвращает списки созданных и уже существующих полей.
 */
async function ensureDealFields(options = {}) {
  const config = options.config || readConfig();

  if (!isConfigured(config)) {
    throw new BitrixError({
      code: 'NOT_CONFIGURED',
      ...describeError('NOT_CONFIGURED'),
      status: 503
    });
  }

  const existing = await listDealUserFields({ ...options, config });
  const existingNames = new Set(existing.map((field) => String(field.FIELD_NAME)));
  const created = [];
  const skipped = [];
  let sort = 100;

  for (const definition of DEAL_FIELDS) {
    const name = `${FIELD_PREFIX}${definition.code}`;

    if (existingNames.has(name)) {
      skipped.push(name);
      sort += 10;
      continue;
    }

    if (options.dryRun) {
      created.push({ name, id: null, dryRun: true });
      sort += 10;
      continue;
    }

    const id = await callMethod('crm.deal.userfield.add', toUserFieldPayload(definition, sort), {
      ...options,
      config
    });

    created.push({ name, id });
    sort += 10;
  }

  clearFieldCache();

  return {
    created,
    existing: skipped,
    total: DEAL_FIELDS.length
  };
}

function textValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text || text.toLowerCase() === NOT_SPECIFIED) return '';
  return text;
}

function effectiveCompany(fields, data) {
  return (
    textValue(fields && fields.company) ||
    textValue(data && data.company) ||
    textValue(data && data.key_data && data.key_data.company)
  );
}

function effectiveContactName(fields, data) {
  return (
    textValue(fields && fields.name) ||
    textValue(data && data.key_data && data.key_data.contact_person)
  );
}

function formatDate(date) {
  const value = date instanceof Date ? date : new Date(date);
  const day = String(value.getDate()).padStart(2, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${value.getFullYear()}`;
}

function formatDateTime(date) {
  const value = date instanceof Date ? date : new Date(date);
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${formatDate(value)} ${hours}:${minutes}`;
}

/**
 * Разбирает бюджет из свободного текста.
 * Понимает «2,3 млн рублей», «1 500 000 ₽», «100 тыс.», «до 500 000».
 * Возвращает число или null, если разобрать не удалось.
 */
function parseBudget(rawValue) {
  const text = textValue(rawValue).toLowerCase().replace(/\u00a0/g, ' ');
  if (!text || !/\d/.test(text)) return null;

  const unitMatch = text.match(/(млрд|миллиард\w*|млн|миллион\w*|тыс\.?|тысяч\w*|\bm\b|\bk\b)/i);
  let rawNumber = null;
  let multiplier = 1;

  if (unitMatch) {
    const beforeUnit = text.slice(0, unitMatch.index);
    const numbers = beforeUnit.match(/\d[\d\s.,]*/g);
    rawNumber = numbers && numbers.length ? numbers[numbers.length - 1] : null;

    const unit = unitMatch[1];
    if (/^(млрд|миллиард)/.test(unit)) multiplier = 1_000_000_000;
    else if (/^(млн|миллион)/.test(unit)) multiplier = 1_000_000;
    else if (/^(тыс|тысяч)/.test(unit)) multiplier = 1_000;
    else if (unit === 'm') multiplier = 1_000_000;
    else if (unit === 'k') multiplier = 1_000;
  } else {
    const numbers = text.match(/\d[\d\s.,]*/g);
    if (!numbers || !numbers.length) return null;
    const parsed = numbers
      .map((item) => parseBudgetNumber(item))
      .filter((item) => item !== null);
    if (!parsed.length) return null;
    rawNumber = String(Math.max(...parsed));
  }

  const number = parseBudgetNumber(rawNumber);
  if (number === null) return null;

  const result = number * multiplier;
  if (!Number.isFinite(result) || result <= 0 || result >= 1_000_000_000_000) return null;

  return Math.round(result * 100) / 100;
}

function parseBudgetNumber(rawValue) {
  let value = String(rawValue || '')
    .replace(/[\s\u00a0]/g, '')
    .replace(/[^\d.,]/g, '');

  if (!value) return null;

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) value = value.replace(/\./g, '').replace(',', '.');
    else value = value.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const parts = value.split(',');
    if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
      value = parts.join('.');
    } else {
      value = value.replace(/,/g, '');
    }
  } else if (lastDot !== -1) {
    const parts = value.split('.');
    if (parts.length > 2) value = value.replace(/\./g, '');
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildTitle({ fields, data, now = new Date() }) {
  const company = effectiveCompany(fields, data);
  const name = effectiveContactName(fields, data);
  const product = textValue(data && data.key_data && data.key_data.product);
  const subject = company || name || product;

  return `${subject ? `Заявка с сайта: ${subject}` : 'Заявка с сайта'} от ${formatDate(now)}`;
}

function buildMetaText({ meta, requestId, privacyStats }) {
  const lines = [];
  lines.push(`Модель: ${textValue(meta && meta.model) || 'GigaChat'}`);

  if (meta && meta.ms !== undefined && meta.ms !== null) {
    const seconds = (Number(meta.ms) / 1000).toFixed(1).replace('.', ',');
    lines.push(`Время обработки: ${seconds} с`);
  }

  if (privacyStats && privacyStats.total !== undefined) {
    lines.push(`Обезличено фрагментов: ${privacyStats.total}`);
  }

  if (requestId) lines.push(`Запрос: ${requestId}`);
  return lines.join('\n');
}

function buildComments({ fields, data, meta, requestId, privacyStats, now = new Date() }) {
  const keyData = (data && data.key_data) || {};
  const lines = [];

  lines.push('=== ЗАЯВКА С САЙТА ===');
  lines.push(`Дата: ${formatDateTime(now)}`);
  if (requestId) lines.push(`ID запроса: ${requestId}`);

  for (const [key, label] of [
    ['name', 'Имя'],
    ['phone', 'Телефон'],
    ['email', 'E-mail'],
    ['company', 'Компания'],
    ['address', 'Адрес']
  ]) {
    const value = textValue(fields && fields[key]);
    if (value) lines.push(`${label}: ${value}`);
  }

  lines.push('');
  lines.push('--- ТЕКСТ ЗАЯВКИ ---');
  lines.push(textValue(fields && fields.text) || 'не указано');

  lines.push('');
  lines.push('=== РЕЗУЛЬТАТ ИИ ===');
  lines.push(`Тип лида: ${textValue(data && data.lead_type) || 'неясно'}`);
  lines.push(`Компания: ${effectiveCompany(fields, data) || 'не указано'}`);
  lines.push(`Краткое резюме: ${textValue(data && data.summary) || 'не указано'}`);

  lines.push('');
  lines.push('Ключевые данные:');
  let keyCount = 0;
  for (const [key, label] of Object.entries(KEY_LABELS)) {
    const value = textValue(keyData[key]);
    if (!value) continue;
    lines.push(`- ${label}: ${value}`);
    keyCount += 1;
  }
  if (!keyCount) lines.push('- нет');

  lines.push('');
  lines.push('Недостающие данные:');
  const missing = Array.isArray(data && data.missing_data)
    ? data.missing_data.map((item) => textValue(item)).filter(Boolean)
    : [];
  if (missing.length) {
    for (const item of missing) lines.push(`- ${item}`);
  } else {
    lines.push('- нет');
  }

  lines.push('');
  lines.push(`Следующий шаг: ${textValue(data && data.next_step) || 'не указано'}`);

  const replyDraft = textValue(data && data.reply_draft);
  if (replyDraft) {
    lines.push('');
    lines.push('Черновик ответа:');
    lines.push(replyDraft);
  }

  lines.push('');
  lines.push(`Нужен человек: ${data && data.needs_human ? 'да' : 'нет'}`);
  if (data && data.needs_human) {
    lines.push(`Причина: ${textValue(data.human_reason) || 'не указана'}`);
  }

  lines.push('');
  lines.push('=== МЕТАДАННЫЕ ===');
  lines.push(buildMetaText({ meta, requestId, privacyStats }));

  return lines.join('\n');
}

function resolveEnumId(meta, fieldName, value) {
  if (!meta || !meta.has(fieldName)) return null;

  const field = meta.get(fieldName);
  if (!field || field.USER_TYPE_ID !== 'enumeration') return null;

  const items = Array.isArray(field.LIST) ? field.LIST : Array.isArray(field.ITEMS) ? field.ITEMS : [];
  const target = textValue(value).toLowerCase();
  if (!target) return null;

  const match = items.find((item) => textValue(item.VALUE).toLowerCase() === target);
  return match && match.ID ? Number(match.ID) : null;
}

function buildUserFields({ meta, data, fields, requestId, metaText }) {
  const keyData = (data && data.key_data) || {};
  const result = {};

  const set = (code, value) => {
    const name = `${FIELD_PREFIX}${code}`;
    if (!meta || !meta.has(name)) return;
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && !value.trim()) return;
    result[name] = value;
  };

  const leadTypeName = `${FIELD_PREFIX}AI_LEAD_TYPE`;
  const leadTypeId = resolveEnumId(meta, leadTypeName, data && data.lead_type);
  if (leadTypeId !== null) result[leadTypeName] = leadTypeId;

  set('AI_REQUEST_ID', requestId);
  set('AI_SUMMARY', textValue(data && data.summary));
  set('AI_CONTACT_PERSON', textValue(keyData.contact_person));
  set('AI_PRODUCT', textValue(keyData.product));
  set('AI_QUANTITY', textValue(keyData.quantity));
  set('AI_BUDGET', textValue(keyData.budget));
  set('AI_DEADLINE', textValue(keyData.deadline));
  set('AI_ADDRESS', textValue(keyData.address));
  set(
    'AI_MISSING',
    (Array.isArray(data && data.missing_data) ? data.missing_data : [])
      .map((item) => textValue(item))
      .filter(Boolean)
      .map((item) => `• ${item}`)
      .join('\n')
  );
  set('AI_NEXT_STEP', textValue(data && data.next_step));
  set('AI_REPLY_DRAFT', textValue(data && data.reply_draft));
  // Поле типа boolean принимает только настоящее логическое значение:
  // строки '1'/'0' и число 1 Битрикс24 молча сохраняет как «нет».
  set('AI_NEEDS_HUMAN', Boolean(data && data.needs_human));
  set('AI_HUMAN_REASON', data && data.needs_human ? textValue(data.human_reason) : '');
  set('AI_META', metaText);
  set('CLIENT_ADDRESS', textValue(fields && fields.address));

  return result;
}

function buildDealPayload({
  fields,
  data,
  meta,
  requestId,
  config,
  fieldMeta,
  contactId,
  companyId,
  privacyStats,
  now = new Date()
}) {
  const keyData = (data && data.key_data) || {};
  const metaText = buildMetaText({ meta, requestId, privacyStats });

  const deal = {
    title: buildTitle({ fields, data, now }),
    categoryId: 0,
    stageId: 'NEW',
    sourceId: config.sourceId,
    currencyId: config.currencyId,
    comments: buildComments({ fields, data, meta, requestId, privacyStats, now }),
    opened: 'Y',
    ...buildUserFields({ meta: fieldMeta, data, fields, requestId, metaText })
  };

  if (config.responsibleId) deal.assignedById = config.responsibleId;
  if (contactId) deal.contactId = contactId;
  if (companyId) deal.companyId = companyId;

  const opportunity = parseBudget(keyData.budget);
  if (opportunity !== null) {
    deal.opportunity = opportunity;
    deal.isManualOpportunity = 'Y';
  }

  return deal;
}

function buildCompanyFields({ title, config }) {
  const result = { title };
  if (config.responsibleId) result.assignedById = config.responsibleId;
  return result;
}

function buildContactFields({ fields, data, config, companyId }) {
  const result = {};
  const name = effectiveContactName(fields, data);
  const phone = textValue(fields && fields.phone);
  const email = textValue(fields && fields.email);
  const fm = [];

  if (name) result.name = name;
  if (phone) fm.push({ typeId: 'PHONE', valueType: 'WORK', value: phone });
  if (email) fm.push({ typeId: 'EMAIL', valueType: 'WORK', value: email });
  if (fm.length) result.fm = fm;
  if (companyId) result.companyId = companyId;
  if (config.responsibleId) result.assignedById = config.responsibleId;

  return result;
}

function buildLinks(config, ids) {
  const origin = getPortalOrigin(config);
  if (!origin) return { deal: '', contact: '', company: '' };

  return {
    deal: ids.dealId ? `${origin}/crm/deal/details/${ids.dealId}/` : '',
    contact: ids.contactId ? `${origin}/crm/contact/details/${ids.contactId}/` : '',
    company: ids.companyId ? `${origin}/crm/company/details/${ids.companyId}/` : ''
  };
}

function getPortalOrigin(config = readConfig()) {
  if (!config || !config.url) return '';
  try {
    return new URL(config.url).origin;
  } catch {
    return '';
  }
}

function extractItemId(result) {
  const id = result && result.item && result.item.id;
  return id ? Number(id) : null;
}

function toWarning(step, error) {
  return {
    step,
    code: error && error.code ? String(error.code) : 'ERROR',
    message:
      error && error.userMessage
        ? error.userMessage
        : 'Не удалось выполнить шаг интеграции с Битрикс24.'
  };
}

async function findCompanyByTitle(call, title) {
  const result = await call('crm.company.list', {
    filter: { TITLE: title },
    select: ['ID', 'TITLE'],
    order: { ID: 'ASC' }
  });

  const items = Array.isArray(result) ? result : [];
  return items.length ? Number(items[0].ID) : null;
}

async function findContactByCommunication(call, phone, email) {
  const ids = [];

  for (const [type, value] of [
    ['PHONE', phone],
    ['EMAIL', email]
  ]) {
    if (!value) continue;

    const result = await call('crm.duplicate.findbycomm', {
      type,
      values: [value],
      entity_type: 'CONTACT'
    });

    const found = result && Array.isArray(result.CONTACT) ? result.CONTACT : [];
    for (const id of found) {
      const number = Number(id);
      if (Number.isInteger(number) && number > 0) ids.push(number);
    }
  }

  return ids.length ? Math.min(...ids) : null;
}

async function enrichContact(call, contactId, desired) {
  const result = await call('crm.item.get', { entityTypeId: 3, id: contactId });
  const item = (result && result.item) || {};
  const update = {};

  if (desired.name && !textValue(item.name)) update.name = desired.name;

  const current = Array.isArray(item.fm) ? item.fm : [];
  const fm = current
    .filter((entry) => entry && entry.value)
    .map((entry) => ({
      typeId: entry.typeId,
      valueType: entry.valueType || 'WORK',
      value: entry.value
    }));

  const hasType = (type) => fm.some((entry) => String(entry.typeId).toUpperCase() === type);

  if (desired.phone && !hasType('PHONE')) {
    fm.push({ typeId: 'PHONE', valueType: 'WORK', value: desired.phone });
  }
  if (desired.email && !hasType('EMAIL')) {
    fm.push({ typeId: 'EMAIL', valueType: 'WORK', value: desired.email });
  }

  if (fm.length !== current.length) update.fm = fm;

  if (Object.keys(update).length) {
    await call('crm.item.update', { entityTypeId: 3, id: contactId, fields: update });
  }
}

async function findDealByRequestId(call, requestId) {
  const result = await call('crm.deal.list', {
    filter: { [`${FIELD_PREFIX}AI_REQUEST_ID`]: requestId },
    select: ['ID', 'CONTACT_ID', 'COMPANY_ID']
  });

  const items = Array.isArray(result) ? result : [];
  if (!items.length) return null;

  return {
    id: Number(items[0].ID),
    contactId: Number(items[0].CONTACT_ID) || null,
    companyId: Number(items[0].COMPANY_ID) || null
  };
}

async function getCurrentUserId(call, config) {
  if (profileCache.has(config.url)) return profileCache.get(config.url);

  const profile = await call('profile', {});
  const id = profile && profile.ID ? Number(profile.ID) : null;
  if (id) profileCache.set(config.url, id);
  return id;
}

function buildTimelineComment(data, meta) {
  const lines = [];
  const model = textValue(meta && meta.model);
  lines.push(`AI-анализ заявки${model ? ` (${model})` : ''}`);
  lines.push('');

  if (data.summary) lines.push(`Резюме: ${data.summary}`);
  if (data.next_step) lines.push(`Следующий шаг: ${data.next_step}`);

  if (data.reply_draft) {
    lines.push('');
    lines.push('Черновик ответа:');
    lines.push(data.reply_draft);
  }

  if (data.needs_human) {
    lines.push('');
    lines.push(`Нужен человек: ${textValue(data.human_reason) || 'да'}`);
  }

  return lines.join('\n');
}

async function createTask(call, { dealId, contactId, companyId, responsibleId, title, reason }) {
  const links = [`D_${dealId}`];
  if (contactId) links.push(`C_${contactId}`);
  if (companyId) links.push(`CO_${companyId}`);

  const taskTitle = `Проверить заявку: ${title}`.slice(0, 250);

  const result = await call('tasks.task.add', {
    fields: {
      TITLE: taskTitle,
      DESCRIPTION: textValue(reason)
        ? `Причина передачи человеку: ${textValue(reason)}`
        : 'Требуется ручная проверка заявки.',
      RESPONSIBLE_ID: responsibleId,
      UF_CRM_TASK: links
    }
  });

  const id = result && result.task && result.task.id;
  return id ? Number(id) : null;
}

/**
 * Создаёт компанию, контакт и сделку, привязывает их друг к другу,
 * добавляет комментарий в таймлайн, задачу и уведомление при необходимости.
 *
 * Ошибки вспомогательных шагов попадают в warnings и не мешают созданию сделки.
 */
async function syncLead(input = {}) {
  const startedAt = Date.now();
  const config = input.config || readConfig(input.env || process.env);
  const warnings = [];

  if (!config.url || !WEBHOOK_RE.test(config.url)) {
    return {
      ok: false,
      enabled: false,
      skipped: true,
      message: 'Интеграция с Битрикс24 не настроена.',
      warnings,
      ms: 0
    };
  }

  if (!config.enabled) {
    return {
      ok: false,
      enabled: false,
      skipped: true,
      message: 'Интеграция с Битрикс24 выключена.',
      warnings,
      ms: 0
    };
  }

  const callOptions = {
    config,
    fetchImpl: input.fetchImpl,
    timeoutMs: config.timeoutMs
  };
  const call = (method, params) => callMethod(method, params, callOptions);

  const now = input.now instanceof Date ? input.now : new Date();
  const requestId = textValue(input.requestId) || crypto.randomUUID();
  const fields = input.fields || {};
  const data = input.data || {};
  const meta = input.meta || {};

  let fieldMeta = new Map();
  try {
    fieldMeta = await getDealFieldMeta(callOptions);
  } catch (error) {
    warnings.push(toWarning('fields', error));
  }

  const requestIdField = `${FIELD_PREFIX}AI_REQUEST_ID`;

  if (fieldMeta.has(requestIdField)) {
    try {
      const existing = await findDealByRequestId(call, requestId);
      if (existing) {
        return {
          ok: true,
          existing: true,
          requestId,
          dealId: existing.id,
          contactId: existing.contactId,
          companyId: existing.companyId,
          taskId: null,
          links: buildLinks(config, existing),
          warnings,
          ms: Date.now() - startedAt
        };
      }
    } catch (error) {
      warnings.push(toWarning('idempotency', error));
    }
  }

  const companyTitle = effectiveCompany(fields, data);
  let companyId = null;

  if (companyTitle) {
    try {
      companyId = await findCompanyByTitle(call, companyTitle);

      if (!companyId) {
        const created = await call('crm.item.add', {
          entityTypeId: 4,
          fields: buildCompanyFields({ title: companyTitle, config })
        });
        companyId = extractItemId(created);
      }
    } catch (error) {
      warnings.push(toWarning('company', error));
      companyId = null;
    }
  }

  const phone = textValue(fields.phone);
  const email = textValue(fields.email);
  let contactId = null;

  if (phone || email || effectiveContactName(fields, data)) {
    try {
      contactId = await findContactByCommunication(call, phone, email);

      if (contactId) {
        try {
          await enrichContact(call, contactId, {
            name: effectiveContactName(fields, data),
            phone,
            email
          });
        } catch (error) {
          warnings.push(toWarning('contact-update', error));
        }
      } else {
        const created = await call('crm.item.add', {
          entityTypeId: 3,
          fields: buildContactFields({ fields, data, config, companyId })
        });
        contactId = extractItemId(created);
      }
    } catch (error) {
      warnings.push(toWarning('contact', error));
      contactId = null;
    }
  }

  const dealFields = buildDealPayload({
    fields,
    data,
    meta,
    requestId,
    config,
    fieldMeta,
    contactId,
    companyId,
    privacyStats: input.privacyStats,
    now
  });

  let dealId = null;

  try {
    const created = await call('crm.item.add', {
      entityTypeId: 2,
      fields: dealFields,
      useOriginalUfNames: 'Y'
    });
    dealId = extractItemId(created);
  } catch (error) {
    if (
      fieldMeta.has(requestIdField) &&
      (error.code === 'TIMEOUT' || error.code === 'NETWORK')
    ) {
      try {
        const existing = await findDealByRequestId(call, requestId);
        if (existing) dealId = existing.id;
      } catch {
        // Повторная проверка не удалась — покажем исходную ошибку.
      }
    }

    if (!dealId) throw error;
  }

  if (!dealId) {
    throw new BitrixError({
      code: 'BAD_RESPONSE',
      message: 'Битрикс24 не вернул ID созданной сделки.',
      hint: 'Проверьте карточку сделки вручную и повторите обработку.',
      status: 502
    });
  }

  if (config.timeline) {
    try {
      await call('crm.timeline.comment.add', {
        fields: {
          ENTITY_ID: dealId,
          ENTITY_TYPE: 'deal',
          COMMENT: buildTimelineComment(data, meta)
        }
      });
    } catch (error) {
      warnings.push(toWarning('timeline', error));
    }
  }

  let taskId = null;

  if (data.needs_human && config.taskOnHuman) {
    try {
      const responsibleId = config.responsibleId || (await getCurrentUserId(call, config));
      taskId = await createTask(call, {
        dealId,
        contactId,
        companyId,
        responsibleId,
        title: dealFields.title,
        reason: data.human_reason
      });
    } catch (error) {
      warnings.push(toWarning('task', error));
    }
  }

  if (data.needs_human && config.notifyOnHuman) {
    try {
      const userId = config.responsibleId || (await getCurrentUserId(call, config));
      await call('im.notify', {
        USER_ID: userId,
        TYPE: 'USER',
        MESSAGE: `Заявка требует внимания: ${dealFields.title}`
      });
    } catch (error) {
      warnings.push(toWarning('notify', error));
    }
  }

  const links = buildLinks(config, { dealId, contactId, companyId });

  return {
    ok: true,
    existing: false,
    requestId,
    dealId,
    contactId,
    companyId,
    taskId,
    links,
    warnings,
    ms: Date.now() - startedAt
  };
}

module.exports = {
  BitrixError,
  DEAL_FIELDS,
  FIELD_PREFIX,
  buildComments,
  buildContactFields,
  buildDealPayload,
  buildLinks,
  buildTitle,
  buildUserFields,
  callMethod,
  clearFieldCache,
  ensureDealFields,
  getPortalOrigin,
  isConfigured,
  listDealUserFields,
  parseBudget,
  publicStatus,
  readConfig,
  resolveEnumId,
  syncLead
};
