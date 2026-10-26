'use strict';

const MAX_TEXT_LENGTH = 5000;
const MAX_COMPOSED_LENGTH = 6000;

const FIELD_LIMITS = {
  name: 100,
  phone: 30,
  email: 254,
  company: 200,
  address: 300
};

const FIELD_LABELS = {
  name: 'Имя и фамилия',
  phone: 'Телефон',
  email: 'E-mail',
  company: 'Компания',
  address: 'Адрес',
  text: 'Текст заявки'
};

const SERVICE_TOKEN_RE = /\[[А-ЯЁA-Z][А-ЯЁA-Z_\s-]*\d+\]/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

class LeadInputError extends Error {
  constructor({ message, hint = '', status = 400, field = '' }) {
    super(message);
    this.name = 'LeadInputError';
    this.userMessage = message;
    this.hint = hint;
    this.status = status;
    this.field = field;
  }
}

function clean(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function normalizeLeadInput(payload) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const fieldsSource =
    source.fields && typeof source.fields === 'object' && !Array.isArray(source.fields)
      ? source.fields
      : {};

  const text = clean(fieldsSource.text) || clean(source.text);

  return {
    name: clean(fieldsSource.name),
    phone: clean(fieldsSource.phone),
    email: clean(fieldsSource.email),
    company: clean(fieldsSource.company),
    address: clean(fieldsSource.address),
    text
  };
}

function composeLeadText(fields) {
  const lines = [];
  const contactLines = [
    ['Имя', fields.name],
    ['Телефон', fields.phone],
    ['E-mail', fields.email],
    ['Компания', fields.company],
    ['Адрес', fields.address]
  ]
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `${label}: ${value}`);

  if (contactLines.length) {
    lines.push('Данные заявителя:');
    lines.push(...contactLines);
    lines.push('');
  }

  lines.push('Текст заявки:');
  lines.push(fields.text);

  return lines.join('\n');
}

function validateLeadInput(fields) {
  if (!fields.text) {
    throw new LeadInputError({
      message: 'Текст заявки пустой.',
      hint: 'Заполните поле «Текст заявки» и попробуйте снова.',
      field: 'text'
    });
  }

  if (fields.text.length > MAX_TEXT_LENGTH) {
    throw new LeadInputError({
      message: 'Текст заявки слишком длинный.',
      hint: `Сократите текст до ${MAX_TEXT_LENGTH} символов и попробуйте снова.`,
      field: 'text'
    });
  }

  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (fields[field].length > limit) {
      throw new LeadInputError({
        message: 'Одно из полей заполнено слишком длинным текстом.',
        hint: `Поле «${FIELD_LABELS[field] || field}» должно быть не длиннее ${limit} символов.`,
        field
      });
    }
  }

  if (fields.phone) {
    const digits = fields.phone.replace(/\D/g, '');
    if (!/^[+\d\s()\-]+$/.test(fields.phone) || digits.length < 10 || digits.length > 15) {
      throw new LeadInputError({
        message: 'Телефон указан неверно.',
        hint: 'Укажите телефон в формате +7 999 123-45-67.',
        field: 'phone'
      });
    }
  }

  if (fields.email && !EMAIL_RE.test(fields.email)) {
    throw new LeadInputError({
      message: 'E-mail указан неверно.',
      hint: 'Укажите адрес в формате name@example.com.',
      field: 'email'
    });
  }

  for (const [field, value] of Object.entries(fields)) {
    if (SERVICE_TOKEN_RE.test(value)) {
      throw new LeadInputError({
        message: 'В данных есть служебные метки.',
        hint: 'Уберите отметки вида [ТЕЛЕФОН_1] — они предназначены только для внутренней обработки.',
        field
      });
    }
  }

  const composed = composeLeadText(fields);

  if (composed.length > MAX_COMPOSED_LENGTH) {
    throw new LeadInputError({
      message: 'Заявка получилась слишком длинной.',
      hint: 'Сократите текст заявки или контактные данные и попробуйте снова.',
      field: 'text'
    });
  }

  return composed;
}

module.exports = {
  LeadInputError,
  MAX_TEXT_LENGTH,
  MAX_COMPOSED_LENGTH,
  normalizeLeadInput,
  composeLeadText,
  validateLeadInput
};
