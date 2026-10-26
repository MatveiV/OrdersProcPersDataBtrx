'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPrivacySession } = require('../privacy');
const {
  normalizeLeadInput,
  validateLeadInput,
  LeadInputError
} = require('../lead-input');

test('заменяет телефон и e-mail и восстанавливает их', () => {
  const session = createPrivacySession();
  const text = 'Телефон +7 (999) 123-45-67, почта marinas@example.com.';
  const anonymized = session.anonymize(text);

  assert.match(anonymized, /\[ТЕЛЕФОН_1\]/);
  assert.match(anonymized, /\[EMAIL_1\]/);
  assert.doesNotMatch(anonymized, /999/);
  assert.doesNotMatch(anonymized, /marinas@/);

  const restored = session.restore('Позвоните на [ТЕЛЕФОН_1] или напишите [EMAIL_1].');
  assert.equal(restored, 'Позвоните на +7 (999) 123-45-67 или напишите marinas@example.com.');

  session.destroy();
});

test('учитывает телефон в другом формате и ФИО из полей формы', () => {
  const session = createPrivacySession();
  const anonymized = session.anonymize(
    'Имя: Марина Соколова. Телефон: +7 (999) 123-45-67.',
    [
      { type: 'ИМЯ', value: 'Марина Соколова' },
      { type: 'ТЕЛЕФОН', value: '8 999 123-45-67' }
    ]
  );

  assert.match(anonymized, /Имя: \[ИМЯ_1\]/);
  assert.match(anonymized, /Телефон: \[ТЕЛЕФОН_1\]/);

  session.destroy();
});

test('находит ФИО в свободном тексте', () => {
  const session = createPrivacySession();
  const anonymized = session.anonymize('Здравствуйте! Меня зовут Марина Соколова, я директор.');

  assert.match(anonymized, /Меня зовут \[ИМЯ_1\]/);
  assert.doesNotMatch(anonymized, /Соколова/);

  session.destroy();
});

test('находит компанию и адрес', () => {
  const session = createPrivacySession();
  const anonymized = session.anonymize(
    'Компания «Вектор-Медиа». Адрес: Москва, ул. Ленинская Слобода, 19. Свяжитесь с нами.'
  );

  assert.match(anonymized, /\[КОМПАНИЯ_1\]/);
  assert.match(anonymized, /\[АДРЕС_1\]/);
  assert.match(anonymized, /Свяжитесь с нами/);

  session.destroy();
});

test('находит документы и банковскую карту', () => {
  const session = createPrivacySession();
  const anonymized = session.anonymize(
    'Паспорт 4510 123456, СНИЛС 123-456-789 01, карта 4111 1111 1111 1111.'
  );

  assert.match(anonymized, /\[ПАСПОРТ_1\]/);
  assert.match(anonymized, /\[СНИЛС_1\]/);
  assert.match(anonymized, /\[КАРТА_1\]/);

  session.destroy();
});

test('10-значный ИНН получает тип ИНН, а не телефон', () => {
  const session = createPrivacySession();
  const anonymized = session.anonymize('ИНН: 7707083893. Прошу выставить счёт.');

  assert.match(anonymized, /ИНН: \[ИНН_1\]/);
  assert.doesNotMatch(anonymized, /\[ТЕЛЕФОН_1\]/);
  assert.doesNotMatch(anonymized, /7707083893/);
  assert.match(anonymized, /Прошу выставить счёт/);

  session.destroy();
});

test('находит ОГРН, КПП и расчётный счёт', () => {
  const session = createPrivacySession();
  const anonymized = session.anonymize(
    'ОГРН 1157746123456, КПП: 770701001, р/с 40702810900000012345.'
  );

  assert.match(anonymized, /\[ОГРН_1\]/);
  assert.match(anonymized, /\[КПП_1\]/);
  assert.match(anonymized, /\[СЧЁТ_1\]/);
  assert.doesNotMatch(anonymized, /1157746123456/);
  assert.doesNotMatch(anonymized, /40702810900000012345/);

  session.destroy();
});

test('скрывает фамилию в подписи и после «С уважением»', () => {
  const session = createPrivacySession();
  const anonymized = session.anonymize(
    'Прошу выставить счёт.\nС уважением,\nВолков'
  );

  assert.doesNotMatch(anonymized, /Волков/);
  assert.match(anonymized, /\[ИМЯ_\d+\]/);
  assert.match(anonymized, /Прошу выставить счёт/);

  session.destroy();
});

test('не маскирует обычные слова, похожие на фамилию', () => {
  const session = createPrivacySession();
  const anonymized = session.anonymize('Нужны столы и кресла. Прошу выставить счёт.');

  assert.equal(anonymized, 'Нужны столы и кресла. Прошу выставить счёт.');

  session.destroy();
});

test('сессии не делят соответствия между запросами', () => {
  const first = createPrivacySession();
  const second = createPrivacySession();

  const firstText = first.anonymize('Телефон +7 999 111-22-33');
  const secondText = second.anonymize('Телефон +7 999 444-55-66');

  assert.equal(firstText, 'Телефон [ТЕЛЕФОН_1]');
  assert.equal(secondText, 'Телефон [ТЕЛЕФОН_1]');
  assert.equal(first.restore('[ТЕЛЕФОН_1]'), '+7 999 111-22-33');
  assert.equal(second.restore('[ТЕЛЕФОН_1]'), '+7 999 444-55-66');

  first.destroy();
  second.destroy();
});

test('восстанавливает вложенные объекты и массивы', () => {
  const session = createPrivacySession();
  session.anonymize('Телефон +7 999 111-22-33');

  const restored = session.restore({
    contact: '[ТЕЛЕФОН_1]',
    items: ['Позвонить на [ТЕЛЕФОН_1]']
  });

  assert.deepEqual(restored, {
    contact: '+7 999 111-22-33',
    items: ['Позвонить на +7 999 111-22-33']
  });

  session.destroy();
});

test('статистика не содержит реальных значений', () => {
  const session = createPrivacySession();
  const anonymized = session.anonymize('Телефон +7 999 111-22-33, почта test@example.com');
  const stats = session.getStats(anonymized);

  assert.equal(stats.total, 2);
  assert.equal(stats.byType['ТЕЛЕФОН'], 1);
  assert.equal(stats.byType['EMAIL'], 1);
  assert.equal(JSON.stringify(stats.byType).includes('999'), false);
  assert.match(stats.preview, /\[ТЕЛЕФОН_1\]/);

  session.destroy();
});

test('форма принимает старый формат text и новый fields', () => {
  const legacy = normalizeLeadInput({ text: 'Нужны кресла.' });
  assert.equal(legacy.text, 'Нужны кресла.');

  const modern = normalizeLeadInput({
    fields: {
      name: 'Марина Соколова',
      phone: '+7 999 123-45-67',
      email: 'marinas@example.com',
      company: 'Вектор-Медиа',
      address: 'Москва, ул. Ленинская Слобода, 19',
      text: 'Нужны кресла.'
    }
  });

  const composed = validateLeadInput(modern);
  assert.match(composed, /Имя: Марина Соколова/);
  assert.match(composed, /Текст заявки:/);
});

test('форма отклоняет неверный телефон', () => {
  const fields = normalizeLeadInput({
    fields: { phone: '123', text: 'Нужны кресла.' }
  });

  assert.throws(() => validateLeadInput(fields), LeadInputError);
});
