'use strict';

/**
 * Обезличивание персональных данных перед отправкой в GigaChat.
 *
 * Соответствие «токен → реальное значение» живёт только внутри одного
 * экземпляра сессии. Сессия создаётся на один HTTP-запрос и очищается
 * в finally. Ничего не пишется на диск и не попадает в логи.
 */

const TOKEN_TYPES = Object.freeze({
  NAME: 'ИМЯ',
  PHONE: 'ТЕЛЕФОН',
  EMAIL: 'EMAIL',
  ADDRESS: 'АДРЕС',
  COMPANY: 'КОМПАНИЯ',
  PASSPORT: 'ПАСПОРТ',
  SNILS: 'СНИЛС',
  INN: 'ИНН',
  OGRN: 'ОГРН',
  KPP: 'КПП',
  ACCOUNT: 'СЧЁТ',
  CARD: 'КАРТА',
  BIRTH_DATE: 'ДАТА_РОЖДЕНИЯ',
  MESSENGER: 'МЕССЕНДЖЕР'
});

const SERVICE_TOKEN_RE = /\[[А-ЯЁA-Z][А-ЯЁA-Z_\s-]*\d+\]/i;

const SURNAME_END =
  '(?:ов|ев|ёв|ин|ын|ский|цкий|ской|цкой|ая|яя|их|ых|енко|ук|юк|ян|ко|ий|ый|ова|ева|ёва|ина|ына|ская|цкая)';

const FIRST_NAMES = [
  'Александр', 'Алексей', 'Анатолий', 'Андрей', 'Антон', 'Аркадий', 'Арсений', 'Артём',
  'Борис', 'Вадим', 'Валентин', 'Валерий', 'Василий', 'Виктор', 'Виталий', 'Владимир',
  'Владислав', 'Всеволод', 'Вячеслав', 'Геннадий', 'Георгий', 'Герман', 'Глеб', 'Григорий',
  'Даниил', 'Денис', 'Дмитрий', 'Евгений', 'Егор', 'Иван', 'Игорь', 'Илья', 'Кирилл',
  'Константин', 'Лев', 'Леонид', 'Максим', 'Марк', 'Матвей', 'Михаил', 'Никита', 'Николай',
  'Олег', 'Павел', 'Пётр', 'Роман', 'Руслан', 'Семён', 'Сергей', 'Станислав', 'Степан',
  'Тимофей', 'Тимур', 'Фёдор', 'Эдуард', 'Юрий', 'Ярослав',
  'Анна', 'Алина', 'Алиса', 'Алла', 'Анастасия', 'Ангелина', 'Валентина', 'Валерия',
  'Варвара', 'Вера', 'Вероника', 'Виктория', 'Галина', 'Дарья', 'Диана', 'Ева', 'Евгения',
  'Екатерина', 'Елена', 'Елизавета', 'Жанна', 'Зинаида', 'Зоя', 'Инна', 'Ирина', 'Карина',
  'Кристина', 'Ксения', 'Лариса', 'Любовь', 'Людмила', 'Маргарита', 'Марина', 'Мария',
  'Милана', 'Надежда', 'Наталья', 'Нина', 'Оксана', 'Ольга', 'Полина', 'Раиса', 'Регина',
  'Римма', 'Светлана', 'София', 'Тамара', 'Татьяна', 'Ульяна', 'Элина', 'Эмма', 'Юлия', 'Яна'
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CARD_RE = /(?<!\d)(?:\d[ -]?){15}\d(?!\d)/g;
const PHONE_RE =
  /(?<!\d)(?:(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}|\d{3}[\s\-]\d{3}[\s\-]\d{2}[\s\-]\d{2}|\d{10,11})(?!\d)/g;
const SNILS_RE = /(?<!\d)\d{3}-\d{3}-\d{3}\s?\d{2}(?!\d)/g;
const PASSPORT_LABELED_RE =
  /(?:паспорт|серия\s+и\s+номер|серия|номер\s+паспорта)\s*[:\-]?\s*(?<value>\d{2}\s?\d{2}\s?\d{6})/giu;
const PASSPORT_GENERIC_RE = /(?<!\d)\d{4}\s\d{6}(?!\d)/g;
const INN_LABELED_RE = /(?:ИНН)\s*[:\-]?\s*(?<value>\d{12}|\d{10})(?!\d)/giu;
const INN_12_RE = /(?<!\d)\d{12}(?!\d)/g;
const OGRN_LABELED_RE = /(?:ОГРНИП|ОГРН)\s*[:\-]?\s*(?<value>\d{15}|\d{13})(?!\d)/giu;
const OGRN_GENERIC_RE = /(?<!\d)(?:\d{15}|\d{13})(?!\d)/g;
const KPP_LABELED_RE = /(?:КПП)\s*[:\-]?\s*(?<value>\d{9})(?!\d)/giu;
const ACCOUNT_LABELED_RE =
  /(?:р\/с|расч[её]тный\s+сч[её]т|лицевой\s+сч[её]т|банковский\s+сч[её]т|сч[её]т)\s*[:\-]?\s*(?<value>\d{20})(?!\d)/giu;
const ACCOUNT_GENERIC_RE = /(?<!\d)\d{20}(?!\d)/g;
const BIRTH_DATE_RE =
  /(?:дата\s+рождения|родил(?:ся|ась)|д\.?\s*р\.?)\s*[:\-]?\s*(?<value>\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/giu;
const MESSENGER_RE =
  /(?:telegram|телеграм|whatsapp|ватсап|viber|вайбер|skype|скайп)\s*[:\-]?\s*@?[A-Za-z0-9_.-]{3,}/giu;
const SOCIAL_RE = /(?:https?:\/\/)?(?:t\.me|vk\.com|wa\.me)\/[A-Za-z0-9_./-]+/giu;

const ADDRESS_LABELED_RE = new RegExp(
  '(?:адрес(?:\\s+доставки)?|место\\s+доставки)\\s*[:\\-]\\s*' +
    '(?<value>(?:(?:\\d{6}\\s*,\\s*)?(?:г\\.\\s*)?[А-ЯЁ][а-яё-]+(?:\\s*,\\s*)?)?' +
    '(?:[А-ЯЁ][а-яё-]+\\s+)?' +
    '(?:ул\\.|улица|проспект|пр-т|пр\\.|переулок|пер\\.|набережная|наб\\.|шоссе|ш\\.|бульвар|б-р|площадь|пл\\.|микрорайон|мкр\\.|проезд|тупик)\\s+' +
    '[^.;\\n]{2,80}(?:,\\s*(?:(?:д\\.|дом)\\s*)?\\d+[^.;\\n]{0,20})?)',
  'giu'
);
const FULL_ADDRESS_RE = new RegExp(
  '(?<![А-ЯЁа-яёA-Za-z])(?:[А-ЯЁ][а-яё-]+)\\s*,\\s*' +
    '(?:[А-ЯЁ][а-яё-]+\\s+)?' +
    '(?:ул\\.|улица|проспект|пр-т|пр\\.|переулок|пер\\.|набережная|наб\\.|шоссе|ш\\.|бульвар|б-р|площадь|пл\\.|микрорайон|мкр\\.|проезд|тупик)\\s+' +
    '[^,\\n.;]{2,80}(?:,\\s*(?:(?:д\\.|дом)\\s*)?\\d+[^,\\n.;]{0,20})?',
  'giu'
);
const STREET_RE = new RegExp(
  '(?<![А-ЯЁа-яёA-Za-z])(?:[А-ЯЁ][а-яё-]+\\s+)?' +
    '(?:ул\\.|улица|проспект|пр-т|пр\\.|переулок|пер\\.|набережная|наб\\.|шоссе|ш\\.|бульвар|б-р|площадь|пл\\.|микрорайон|мкр\\.|проезд|тупик)\\s+' +
    '[А-ЯЁA-Z][^,\\n.;]{2,80}(?:,\\s*(?:(?:д\\.|дом)\\s*)?\\d+[^,\\n.;]{0,20})?',
  'giu'
);
const CITY_LABELED_RE =
  /(?<![А-ЯЁа-яёA-Za-z])(?:г\.|город)\s+[А-ЯЁ][а-яё-]+(?:\s*,\s*[^\n.;]{3,150})?/giu;
const REGION_RE =
  /(?<![А-ЯЁа-яёA-Za-z])(?:обл\.|область|край|республика|респ\.)\s+[А-ЯЁ][а-яё-]+/giu;
const POSTAL_RE = /(?<!\d)\d{6}(?!\d)\s*,?\s*(?:г\.|город)?\s*[А-ЯЁ][а-яё-]+/gu;

const COMPANY_LABELED_RE =
  /(?:компания|компании|организация|фирма|работодатель)\s*[«"„']?\s*(?<value>[А-ЯЁA-Z][^»"“',\n.]{1,80})/giu;
const COMPANY_LEGAL_RE =
  /(?<![А-ЯЁа-яёA-Za-z])(?:ООО|АО|ПАО|ЗАО|ОАО|ИП)\s*[«"„']?\s*[А-ЯЁA-Z][^»"“',\n.]{1,100}/giu;

const NAME_LABELED_RE =
  /(?:меня\s+зовут|мо[её]\s+имя|контактное\s+лицо|фио|зовут)\s*[:\-]?\s*(?<value>[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+){0,2})/giu;
const NAME_FULL_RE = new RegExp(
  '(?<![А-ЯЁа-яёA-Za-z-])([А-ЯЁ][а-яё-]+\\s+(?:[А-ЯЁ][а-яё-]+\\s+)?[А-ЯЁ][а-яё-]*' +
    SURNAME_END +
    ')(?![А-ЯЁа-яёA-Za-z-])',
  'gu'
);
const NAME_INITIALS_RE =
  /(?<![А-ЯЁа-яёA-Za-z])(?:(?:[А-ЯЁ]\.\s*){1,2}[А-ЯЁ][а-яё-]+|[А-ЯЁ][а-яё-]+\s+(?:[А-ЯЁ]\.\s*){1,2})(?![А-ЯЁа-яёA-Za-z])/gu;

// Фамилия без имени: подпись, строка «С уважением, …», метка «Фамилия: …».
// Полные ФИО ловят шаблоны выше, здесь закрываем одиночные фамилии.
const SURNAME_LABELED_RE = new RegExp(
  '(?:фамилия|с\\s+уважением|подпись|подписал[а-я]*|клиент|от)\\s*[:,]?\\s*' +
    '(?<value>[А-ЯЁ][а-яё-]*' +
    SURNAME_END +
    ')(?![А-ЯЁа-яёA-Za-z-])',
  'giu'
);
const SURNAME_LINE_RE = new RegExp(
  '(?:^|\\n)[ \\t]*(?<value>[А-ЯЁ][а-яё-]*' +
    SURNAME_END +
    ')[ \\t]*(?=\\n|$)',
  'gmu'
);

const FIRST_NAMES_PATTERN = FIRST_NAMES
  .slice()
  .sort((a, b) => b.length - a.length)
  .map((name) => withYo(escapeRegExp(name)))
  .join('|');
const NAME_FIRST_SURNAME_RE = new RegExp(
  '(?<![А-ЯЁа-яёA-Za-z-])(?:(?:' +
    FIRST_NAMES_PATTERN +
    ')\\s+[А-ЯЁ][а-яё-]*' +
    SURNAME_END +
    ')(?![А-ЯЁа-яёA-Za-z-])',
  'giu'
);
const NAME_SURNAME_FIRST_RE = new RegExp(
  '(?<![А-ЯЁа-яёA-Za-z-])(?:[А-ЯЁ][а-яё-]*' +
    SURNAME_END +
    '\\s+(?:' +
    FIRST_NAMES_PATTERN +
    '))(?![А-ЯЁа-яёA-Za-z-])',
  'giu'
);

const HIGH_CONFIDENCE_RESIDUAL = [
  EMAIL_RE,
  CARD_RE,
  PHONE_RE,
  SNILS_RE,
  INN_12_RE,
  PASSPORT_GENERIC_RE
];

class PrivacyError extends Error {
  constructor({ code = 'PRIVACY_FAILED', message, hint = '', status = 422 }) {
    super(message);
    this.name = 'PrivacyError';
    this.code = code;
    this.userMessage = message;
    this.hint = hint;
    this.status = status;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withYo(value) {
  return String(value).replace(/[еёЕЁ]/g, '[еёЕЁ]');
}

function cleanValue(value) {
  return String(value || '')
    .trim()
    .replace(/^[«"„']+|[»"“']+$/g, '')
    .replace(/[.,;:]+$/g, '')
    .trim();
}

function normalizeKey(type, value) {
  let text = String(value || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  if (type === TOKEN_TYPES.PHONE) {
    const digits = text.replace(/\D/g, '');
    if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) return digits.slice(1);
    return digits;
  }
  if (
    [
      TOKEN_TYPES.PASSPORT,
      TOKEN_TYPES.SNILS,
      TOKEN_TYPES.INN,
      TOKEN_TYPES.OGRN,
      TOKEN_TYPES.KPP,
      TOKEN_TYPES.ACCOUNT,
      TOKEN_TYPES.CARD
    ].includes(type)
  ) {
    return text.replace(/\D/g, '');
  }
  return text;
}

function buildPhonePattern(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  const body = digits.split('').join('[\\s\\-()]*');
  return new RegExp('(?<!\\d)(?:\\+?7|8)?[\\s\\-()]*' + body + '(?!\\d)', 'g');
}

function buildNamePattern(value) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const variants = [words, [...words].reverse()];
  const patterns = variants.map((list) =>
    list.map((word) => withYo(escapeRegExp(word))).join('[\\s\\-]+')
  );
  return new RegExp(
    '(?<![А-ЯЁа-яёA-Za-z])' + '(?:' + patterns.join('|') + ')' + '(?![А-ЯЁа-яёA-Za-z])',
    'giu'
  );
}

function buildFlexiblePattern(value) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return new RegExp(
    '(?<![А-ЯЁа-яёA-Za-z])' +
      words.map((word) => withYo(escapeRegExp(word))).join('[\\s]+') +
      '(?![А-ЯЁа-яёA-Za-z])',
    'giu'
  );
}

function createPrivacySession() {
  const tokenToValue = new Map();
  const valueToToken = new Map();
  const counters = new Map();
  const typeTokens = new Map();

  let total = 0;
  let restored = 0;
  let unresolved = 0;
  const byType = {};

  function countReplacement(type) {
    total += 1;
    byType[type] = (byType[type] || 0) + 1;
  }

  function tokenFor(type, value) {
    const key = `${type}:${normalizeKey(type, value)}`;
    if (valueToToken.has(key)) return valueToToken.get(key);

    const number = (counters.get(type) || 0) + 1;
    counters.set(type, number);

    const token = `[${type}_${number}]`;
    tokenToValue.set(token, value);
    valueToToken.set(key, token);

    if (!typeTokens.has(type)) typeTokens.set(type, []);
    typeTokens.get(type).push(token);

    return token;
  }

  function replaceMatches(text, regex, type) {
    regex.lastIndex = 0;
    return text.replace(regex, (match) => {
      const leading = (match.match(/^\s*/) || [''])[0];
      const trailing = (match.match(/\s*$/) || [''])[0];
      const value = cleanValue(match);
      if (!value) return match;
      countReplacement(type);
      return leading + tokenFor(type, value) + trailing;
    });
  }

  function replaceGroup(text, regex, type) {
    regex.lastIndex = 0;
    return text.replace(regex, (match, ...args) => {
      const groups = args[args.length - 1];
      if (!groups || typeof groups !== 'object' || !groups.value) return match;

      const rawValue = groups.value;
      const value = cleanValue(rawValue);
      if (!value) return match;

      countReplacement(type);
      const token = tokenFor(type, value);
      const index = match.indexOf(rawValue);
      if (index === -1) return token;

      return match.slice(0, index) + token + match.slice(index + rawValue.length);
    });
  }

  function replaceWithPattern(text, pattern, type, canonicalValue) {
    if (!pattern) return text;
    pattern.lastIndex = 0;
    return text.replace(pattern, (match) => {
      if (!match.trim()) return match;
      countReplacement(type);
      return tokenFor(type, canonicalValue || match.trim());
    });
  }

  function replaceKnown(text, item) {
    const { type, value } = item;

    if (type === TOKEN_TYPES.PHONE) {
      const pattern = buildPhonePattern(value);
      if (pattern) return replaceWithPattern(text, pattern, type, value);
      const fallback = new RegExp(escapeRegExp(value), 'giu');
      return replaceWithPattern(text, fallback, type, value);
    }

    if (type === TOKEN_TYPES.EMAIL) {
      const pattern = new RegExp(escapeRegExp(value), 'giu');
      return replaceWithPattern(text, pattern, type, value);
    }

    if (type === TOKEN_TYPES.NAME) {
      const pattern = buildNamePattern(value);
      if (pattern) return replaceWithPattern(text, pattern, type, value);
      const fallback = new RegExp(
        '(?<![А-ЯЁа-яёA-Za-z])' + withYo(escapeRegExp(value)) + '(?![А-ЯЁа-яёA-Za-z])',
        'giu'
      );
      return replaceWithPattern(text, fallback, type, value);
    }

    const pattern = buildFlexiblePattern(value);
    if (pattern) return replaceWithPattern(text, pattern, type, value);
    return text;
  }

  function applyDetectors(text) {
    let result = text;

    result = replaceMatches(result, EMAIL_RE, TOKEN_TYPES.EMAIL);
    result = replaceMatches(result, CARD_RE, TOKEN_TYPES.CARD);

    // Документы с явной меткой обрабатываем раньше телефонов:
    // иначе 10-значный ИНН превратился бы в [ТЕЛЕФОН_1].
    result = replaceGroup(result, PASSPORT_LABELED_RE, TOKEN_TYPES.PASSPORT);
    result = replaceMatches(result, PASSPORT_GENERIC_RE, TOKEN_TYPES.PASSPORT);
    result = replaceMatches(result, SNILS_RE, TOKEN_TYPES.SNILS);
    result = replaceGroup(result, INN_LABELED_RE, TOKEN_TYPES.INN);
    result = replaceGroup(result, OGRN_LABELED_RE, TOKEN_TYPES.OGRN);
    result = replaceGroup(result, KPP_LABELED_RE, TOKEN_TYPES.KPP);
    result = replaceGroup(result, ACCOUNT_LABELED_RE, TOKEN_TYPES.ACCOUNT);
    result = replaceGroup(result, BIRTH_DATE_RE, TOKEN_TYPES.BIRTH_DATE);

    result = replaceMatches(result, PHONE_RE, TOKEN_TYPES.PHONE);
    result = replaceMatches(result, INN_12_RE, TOKEN_TYPES.INN);
    result = replaceMatches(result, OGRN_GENERIC_RE, TOKEN_TYPES.OGRN);
    result = replaceMatches(result, ACCOUNT_GENERIC_RE, TOKEN_TYPES.ACCOUNT);

    result = replaceMatches(result, MESSENGER_RE, TOKEN_TYPES.MESSENGER);
    result = replaceMatches(result, SOCIAL_RE, TOKEN_TYPES.MESSENGER);

    result = replaceGroup(result, ADDRESS_LABELED_RE, TOKEN_TYPES.ADDRESS);
    result = replaceMatches(result, FULL_ADDRESS_RE, TOKEN_TYPES.ADDRESS);
    result = replaceMatches(result, STREET_RE, TOKEN_TYPES.ADDRESS);
    result = replaceMatches(result, CITY_LABELED_RE, TOKEN_TYPES.ADDRESS);
    result = replaceMatches(result, REGION_RE, TOKEN_TYPES.ADDRESS);
    result = replaceMatches(result, POSTAL_RE, TOKEN_TYPES.ADDRESS);

    result = replaceGroup(result, COMPANY_LABELED_RE, TOKEN_TYPES.COMPANY);
    result = replaceMatches(result, COMPANY_LEGAL_RE, TOKEN_TYPES.COMPANY);

    result = replaceGroup(result, NAME_LABELED_RE, TOKEN_TYPES.NAME);
    result = replaceMatches(result, NAME_FULL_RE, TOKEN_TYPES.NAME);
    result = replaceMatches(result, NAME_FIRST_SURNAME_RE, TOKEN_TYPES.NAME);
    result = replaceMatches(result, NAME_SURNAME_FIRST_RE, TOKEN_TYPES.NAME);
    result = replaceMatches(result, NAME_INITIALS_RE, TOKEN_TYPES.NAME);
    result = replaceGroup(result, SURNAME_LABELED_RE, TOKEN_TYPES.NAME);
    result = replaceGroup(result, SURNAME_LINE_RE, TOKEN_TYPES.NAME);

    return result;
  }

  function findResidual(text) {
    return HIGH_CONFIDENCE_RESIDUAL.some((regex) => {
      regex.lastIndex = 0;
      return regex.test(text);
    });
  }

  function anonymize(text, knownValues = []) {
    let result = String(text || '');
    if (!result.trim()) return result;

    const prepared = knownValues
      .filter((item) => item && item.value && String(item.value).trim())
      .map((item) => ({ type: item.type, value: String(item.value).trim() }))
      .sort((a, b) => b.value.length - a.value.length);

    for (const item of prepared) {
      result = replaceKnown(result, item);
    }

    result = applyDetectors(result);
    result = applyDetectors(result);

    if (findResidual(result)) {
      throw new PrivacyError({
        code: 'PRIVACY_NOT_ANONYMIZED',
        message: 'Не удалось безопасно обезличить персональные данные.',
        hint: 'Сократите текст заявки или уберите лишние персональные данные и попробуйте снова.'
      });
    }

    return result;
  }

  function resolveUnknownTokens(text) {
    return text.replace(/\[([А-ЯЁA-Z][А-ЯЁA-Z_\s-]*?)[\s_-]*(\d+)\]/gi, (match, type) => {
      const normalizedType = String(type)
        .toUpperCase()
        .replace(/[\s-]+/g, '_')
        .replace(/_+$/, '');
      const tokens = typeTokens.get(normalizedType);

      if (tokens && tokens.length === 1) {
        const original = tokenToValue.get(tokens[0]);
        if (original) {
          restored += 1;
          return original;
        }
      }

      unresolved += 1;
      return '';
    });
  }

  function restoreString(value) {
    let result = String(value);

    for (const [token, original] of tokenToValue.entries()) {
      const match = token.match(/^\[([А-ЯЁA-Z_]+)_(\d+)\]$/);
      if (!match) continue;

      const [, type, number] = match;
      const typePattern = escapeRegExp(type).replace(/_/g, '[\\s_-]*');
      const bracketed = new RegExp(
        '\\[\\s*' + typePattern + '[\\s_-]*' + number + '\\s*\\]',
        'gi'
      );

      result = result.replace(bracketed, () => {
        restored += 1;
        return original;
      });

      const bare = new RegExp(
        '(?<![А-ЯЁA-Z])' + typePattern + '[\\s_-]*' + number + '(?![А-ЯЁA-Z0-9])',
        'g'
      );
      result = result.replace(bare, () => {
        restored += 1;
        return original;
      });
    }

    if (/\[[А-ЯЁA-Z][А-ЯЁA-Z_\s-]*\d+\]/i.test(result)) {
      result = resolveUnknownTokens(result);
      result = result
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([.,!?;:])/g, '$1')
        .trim();
    }

    return result;
  }

  function restore(value) {
    if (typeof value === 'string') return restoreString(value);
    if (Array.isArray(value)) return value.map(restore);
    if (value && typeof value === 'object') {
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = restore(item);
      }
      return result;
    }
    return value;
  }

  function getStats(preview) {
    return {
      total,
      byType: { ...byType },
      unique: tokenToValue.size,
      restored,
      unresolved,
      preview: String(preview || '')
    };
  }

  function destroy() {
    tokenToValue.clear();
    valueToToken.clear();
    counters.clear();
    typeTokens.clear();
  }

  return {
    anonymize,
    restore,
    getStats,
    destroy
  };
}

module.exports = {
  createPrivacySession,
  PrivacyError,
  SERVICE_TOKEN_RE,
  TOKEN_TYPES
};
