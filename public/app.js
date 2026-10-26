'use strict';

/* Тестовые заявки: заполняют и контактные поля, и текст обращения. */
const SAMPLES = [
  {
    fields: {
      name: '',
      phone: '',
      email: '',
      company: 'Альфа-Логистик',
      address: '',
      text:
        'Здравствуйте! Я офис-менеджер компании "Альфа-Логистик". Мы переезжаем в новый офис на 40 рабочих мест и хотим заказать поставку и сборку офисной мебели: столы, кресла и шкафы. Переезд — в начале следующего месяца, бюджет около 1,5 млн рублей. Пришлите, пожалуйста, коммерческое предложение.'
    }
  },
  {
    fields: {
      name: '',
      phone: '',
      email: '',
      company: '',
      address: '',
      text: 'Добрый день, сколько у вас стоят офисные кресла? Нужно несколько штук.'
    }
  },
  {
    fields: {
      name: '',
      phone: '',
      email: '',
      company: '',
      address: '',
      text:
        'Это уже третье письмо! Заказ должны были привезти в понедельник, сейчас четверг — ни мебели, ни звонка. Менеджер не берёт трубку. Если завтра ничего не изменится, будем отказываться и требовать возврат предоплаты.'
    }
  },
  {
    fields: {
      name: 'Марина Соколова',
      phone: '+7 999 123-45-67',
      email: 'marinas@example.com',
      company: 'Вектор-Медиа',
      address: 'Москва, ул. Ленинская Слобода, 19',
      text:
        'Здравствуйте! Меня зовут Марина Соколова, я административный директор компании «Вектор-Медиа». Планируем обустроить новый этаж на 25 рабочих мест: нужны письменные столы, эргономичные кресла и три шкафа для документов. Также требуется доставка и сборка. Бюджет — 2,3 млн рублей, срок — до 15 декабря. Свяжитесь со мной по телефону +7 999 123-45-67 или marinas@example.com. Ждём коммерческое предложение.'
    }
  },
  {
    fields: {
      name: '',
      phone: '',
      email: '',
      company: '',
      address: '',
      text:
        'Здравствуйте! Пишу по поводу размещения рекламы. Мы предлагаем опубликовать вакансии вашей компании на нашем job-портале: аудитория 50 000 соискателей в месяц, пакет размещения — 15 000 рублей. Будет интересно? Готова прислать подробные условия.'
    }
  },
  {
    fields: {
      name: '',
      phone: '',
      email: '',
      company: '',
      address: '',
      text:
        'Добрый день! Хотим заказать шкафы для раздевалки в спортзал, примерно 10 штук. Подскажите, какие есть варианты и сколько будет стоить с доставкой? Бюджет пока не определили.'
    }
  }
];

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

const PRIVACY_LABELS = {
  'ИМЯ': 'имя',
  'ТЕЛЕФОН': 'телефон',
  'EMAIL': 'e-mail',
  'АДРЕС': 'адрес',
  'КОМПАНИЯ': 'компания',
  'ПАСПОРТ': 'паспорт',
  'СНИЛС': 'СНИЛС',
  'ИНН': 'ИНН',
  'ОГРН': 'ОГРН',
  'КПП': 'КПП',
  'СЧЁТ': 'расчётный счёт',
  'КАРТА': 'банковская карта',
  'ДАТА_РОЖДЕНИЯ': 'дата рождения',
  'МЕССЕНДЖЕР': 'мессенджер'
};

const FIELD_NAMES = ['name', 'phone', 'email', 'company', 'address', 'text'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const els = {
  form: document.getElementById('requestForm'),
  name: document.getElementById('name'),
  phone: document.getElementById('phone'),
  email: document.getElementById('email'),
  company: document.getElementById('company'),
  address: document.getElementById('address'),
  text: document.getElementById('requestText'),
  charCount: document.getElementById('charCount'),
  submit: document.getElementById('submitBtn'),
  status: document.getElementById('status'),
  statusText: document.getElementById('statusText'),
  error: document.getElementById('error'),
  errorMessage: document.getElementById('errorMessage'),
  errorHint: document.getElementById('errorHint'),
  result: document.getElementById('result'),
  resultMeta: document.getElementById('resultMeta'),
  leadTypeBadge: document.getElementById('leadTypeBadge'),
  humanBadge: document.getElementById('humanBadge'),
  privacyBox: document.getElementById('privacyBox'),
  privacySummary: document.getElementById('privacySummary'),
  privacyDetails: document.getElementById('privacyDetails'),
  privacyPreview: document.getElementById('privacyPreview'),
  b24Option: document.getElementById('b24Option'),
  b24Enabled: document.getElementById('b24Enabled'),
  b24Box: document.getElementById('b24Box'),
  b24Title: document.getElementById('b24Title'),
  b24Details: document.getElementById('b24Details'),
  companyResult: document.getElementById('companyResult'),
  summary: document.getElementById('summary'),
  keyData: document.getElementById('keyData'),
  keyDataField: document.getElementById('keyDataField'),
  missingData: document.getElementById('missingData'),
  missingStat: document.getElementById('missingStat'),
  missingCount: document.getElementById('missingCount'),
  crmStat: document.getElementById('crmStat'),
  nextStep: document.getElementById('nextStep'),
  replyDraft: document.getElementById('replyDraft'),
  humanBox: document.getElementById('humanBox'),
  humanReason: document.getElementById('humanReason'),
  copyBtn: document.getElementById('copyBtn'),
  copyNextBtn: document.getElementById('copyNextBtn'),
  copyCardBtn: document.getElementById('copyCardBtn'),
  privacyLogRow: document.getElementById('privacyLogRow'),
  privacyLogLink: document.getElementById('privacyLogLink')
};

const FIELD_ERRORS = {
  name: document.getElementById('nameError'),
  phone: document.getElementById('phoneError'),
  email: document.getElementById('emailError'),
  company: document.getElementById('companyError'),
  address: document.getElementById('addressError'),
  text: document.getElementById('textError')
};

const FIELD_INPUTS = {
  name: els.name,
  phone: els.phone,
  email: els.email,
  company: els.company,
  address: els.address,
  text: els.text
};

let busy = false;
let timerId = null;
let startedAt = 0;
let lastDraft = '';
let lastData = null;
let lastB24 = null;

function updateCounter() {
  els.charCount.textContent = `${els.text.value.length} / 5000`;
}

function hideError() {
  els.error.classList.add('hidden');
}

function showError(message, hint) {
  els.errorMessage.textContent = message || 'Неизвестная ошибка.';
  els.errorHint.textContent = hint || '';
  els.errorHint.classList.toggle('hidden', !hint);
  els.error.classList.remove('hidden');
  els.error.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setBusy(value) {
  busy = value;
  els.submit.disabled = value;
  els.submit.classList.toggle('loading', value);
  els.status.classList.toggle('hidden', !value);

  if (value) {
    startedAt = Date.now();
    const withBitrix = els.b24Enabled ? els.b24Enabled.checked : true;
    const statusPrefix = withBitrix
      ? 'Обезличиваем данные, анализируем заявку и создаём сделку'
      : 'Обезличиваем данные и анализируем заявку';
    els.statusText.textContent = `${statusPrefix}…`;
    timerId = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      els.statusText.textContent = `${statusPrefix}… ${seconds} с`;
    }, 1000);
  } else if (timerId) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function readFields() {
  return {
    name: els.name.value.trim(),
    phone: els.phone.value.trim(),
    email: els.email.value.trim(),
    company: els.company.value.trim(),
    address: els.address.value.trim(),
    text: els.text.value.trim()
  };
}

function clearFieldErrors() {
  for (const field of FIELD_NAMES) {
    const input = FIELD_INPUTS[field];
    const error = FIELD_ERRORS[field];
    if (error) {
      error.textContent = '';
      error.classList.add('hidden');
    }
    if (input) {
      input.classList.remove('invalid');
      input.removeAttribute('aria-invalid');
    }
  }
}

function showFieldError(field, message) {
  const input = FIELD_INPUTS[field];
  const error = FIELD_ERRORS[field];
  if (!input || !error) return;

  error.textContent = message;
  error.classList.remove('hidden');
  input.classList.add('invalid');
  input.setAttribute('aria-invalid', 'true');
}

function validateForm(fields) {
  const errors = {};

  if (!fields.text) {
    errors.text = 'Заполните текст заявки.';
  } else if (fields.text.length > 5000) {
    errors.text = 'Текст заявки должен быть не длиннее 5000 символов.';
  }

  if (fields.phone) {
    const digits = fields.phone.replace(/\D/g, '');
    if (!/^[+\d\s()\-]+$/.test(fields.phone) || digits.length < 10 || digits.length > 15) {
      errors.phone = 'Укажите телефон в формате +7 999 123-45-67.';
    }
  }

  if (fields.email && !EMAIL_RE.test(fields.email)) {
    errors.email = 'Укажите e-mail в формате name@example.com.';
  }

  if (fields.name.length > 100) errors.name = 'Не больше 100 символов.';
  if (fields.company.length > 200) errors.company = 'Не больше 200 символов.';
  if (fields.address.length > 300) errors.address = 'Не больше 300 символов.';

  return errors;
}

function fillSample(index) {
  const sample = SAMPLES[index];
  if (!sample) return;

  clearFieldErrors();
  for (const field of FIELD_NAMES) {
    FIELD_INPUTS[field].value = sample.fields[field] || '';
  }

  updateCounter();
  hideError();
  els.text.focus();
  els.text.setSelectionRange(els.text.value.length, els.text.value.length);
}

async function submit() {
  if (busy) return;

  hideError();
  clearFieldErrors();

  const fields = readFields();
  const errors = validateForm(fields);
  const errorFields = Object.keys(errors);

  if (errorFields.length) {
    for (const field of errorFields) {
      showFieldError(field, errors[field]);
    }
    const first = FIELD_INPUTS[errorFields[0]];
    if (first) first.focus();
    return;
  }

  els.result.classList.add('hidden');
  setBusy(true);

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields,
        b24: els.b24Enabled ? els.b24Enabled.checked : true
      })
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || !payload || payload.ok !== true) {
      const error = (payload && payload.error) || {};
      if (error.field && FIELD_ERRORS[error.field]) {
        showFieldError(error.field, error.message || 'Проверьте поле.');
      }
      showError(
        error.message || 'Сервер вернул ошибку при обработке заявки.',
        error.hint || 'Попробуйте ещё раз. Если ошибка повторяется — проверьте настройки в файле .env.'
      );
      return;
    }

    renderResult(payload.data, payload.meta);
  } catch {
    showError(
      'Не удалось связаться с приложением.',
      'Проверьте, что окно с сервером открыто и не закрыто, и обновите страницу.'
    );
  } finally {
    setBusy(false);
  }
}

function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function renderPrivacy(privacy, privacyLog) {
  if (!privacy) {
    els.privacyBox.classList.add('hidden');
    return;
  }

  els.privacyBox.classList.remove('hidden');

  const total = Number(privacy.total) || 0;

  if (total === 0) {
    els.privacySummary.textContent = 'Персональные данные не обнаружены — текст отправлен без замен.';
  } else {
    const parts = Object.entries(privacy.byType || {})
      .map(([type, count]) => {
        const label = PRIVACY_LABELS[type] || type.toLowerCase();
        return count > 1 ? `${label} (${count})` : label;
      });
    const word = plural(total, 'фрагмент', 'фрагмента', 'фрагментов');
    let text = `Обезличено ${total} ${word}: ${parts.join(', ')}.`;
    if (Number(privacy.unresolved) > 0) {
      text += ' Часть служебных меток не удалось восстановить — проверьте ответ.';
    }
    els.privacySummary.textContent = text;
  }

  const preview = privacy.preview || '';
  els.privacyPreview.textContent = preview;
  els.privacyDetails.classList.toggle('hidden', !preview);
  els.privacyDetails.open = true;

  const logging = Boolean(privacyLog && privacyLog.enabled);
  els.privacyLogRow.classList.toggle('hidden', !logging);
  if (logging && privacyLog.file) {
    els.privacyLogLink.title = `Журнал: ${privacyLog.file}`;
  }
}

function appendB24Link(container, href, text) {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  container.append(link);
}

function renderBitrix(b24) {
  els.b24Box.classList.add('hidden');
  els.b24Box.classList.remove('b24-error');
  els.b24Details.textContent = '';
  els.b24Title.textContent = '';
  els.crmStat.textContent = '—';
  els.crmStat.classList.add('muted');
  els.crmStat.classList.remove('stat-error');
  lastB24 = b24 || null;

  if (!b24 || b24.enabled === false) {
    els.crmStat.textContent = 'не настроена';
    return;
  }

  if (b24.skipped) {
    els.crmStat.textContent = 'не создавалась';
    return;
  }

  els.b24Box.classList.remove('hidden');

  if (b24.ok) {
    els.b24Title.textContent = b24.existing ? 'Сделка уже создана ранее' : 'Сделка создана';

    if (b24.dealId) {
      els.crmStat.textContent = '';
      els.crmStat.classList.remove('muted');
      const link = document.createElement('a');
      link.href = (b24.links && b24.links.deal) || '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `Сделка №${b24.dealId}`;
      els.crmStat.append(link);
    }

    if (b24.links && b24.links.deal) {
      const line = document.createElement('p');
      line.className = 'b24-line';
      appendB24Link(line, b24.links.deal, `Открыть сделку №${b24.dealId}`);
      els.b24Details.append(line);
    }

    if (b24.links && (b24.links.contact || b24.links.company)) {
      const line = document.createElement('p');
      line.className = 'b24-line b24-links';
      if (b24.links.contact) {
        appendB24Link(line, b24.links.contact, 'Контакт');
      }
      if (b24.links.company) {
        appendB24Link(line, b24.links.company, 'Компания');
      }
      els.b24Details.append(line);
    }

    if (b24.taskId) {
      const line = document.createElement('p');
      line.className = 'b24-line';
      line.textContent = `Создана задача №${b24.taskId} для ручной проверки.`;
      els.b24Details.append(line);
    }
  } else {
    els.crmStat.textContent = 'ошибка';
    els.crmStat.classList.remove('muted');
    els.crmStat.classList.add('stat-error');
    els.b24Box.classList.add('b24-error');
    els.b24Title.textContent = 'Сделка не создана';

    const error = b24.error || {};
    const line = document.createElement('p');
    line.className = 'b24-line';
    line.textContent = error.message || b24.message || 'Битрикс24 вернул ошибку.';
    els.b24Details.append(line);

    if (error.hint) {
      const hint = document.createElement('p');
      hint.className = 'b24-line b24-hint';
      hint.textContent = error.hint;
      els.b24Details.append(hint);
    }
  }

  if (Array.isArray(b24.warnings) && b24.warnings.length) {
    const details = document.createElement('details');
    details.className = 'b24-warnings';

    const summary = document.createElement('summary');
    summary.textContent = `Предупреждения: ${b24.warnings.length}`;

    const list = document.createElement('ul');
    for (const warning of b24.warnings) {
      const item = document.createElement('li');
      item.textContent = `${warning.step}: ${warning.message}`;
      list.append(item);
    }

    details.append(summary, list);
    els.b24Details.append(details);
  }
}

function renderResult(data, meta) {
  if (!data) {
    showError('Сервер не вернул результат.', 'Попробуйте обработать заявку ещё раз.');
    return;
  }

  lastData = data;
  const leadType = data.lead_type || 'неясно';
  const leadLabels = {
    'целевой': 'Целевой лид',
    'нецелевой': 'Нецелевой лид',
    'неясно': 'Тип неясен'
  };

  els.result.classList.remove(
    'result--target',
    'result--not-target',
    'result--unclear',
    'result--human'
  );
  els.result.classList.add(
    leadType === 'нецелевой'
      ? 'result--not-target'
      : leadType === 'целевой'
        ? 'result--target'
        : 'result--unclear'
  );
  if (data.needs_human) els.result.classList.add('result--human');

  els.leadTypeBadge.textContent = leadLabels[leadType] || leadLabels['неясно'];
  els.leadTypeBadge.className =
    `badge badge-${leadType === 'нецелевой' ? 'not-target' : leadType === 'целевой' ? 'target' : 'unclear'}`;

  els.humanBadge.textContent = data.needs_human ? 'Нужен человек' : 'Можно без человека';
  els.humanBadge.className = `badge ${data.needs_human ? 'badge-human' : 'badge-auto'}`;

  const missing = Array.isArray(data.missing_data) ? data.missing_data : [];
  renderMissingStat(missing, leadType, data.needs_human);

  els.companyResult.textContent = data.company || 'не указано';
  els.companyResult.classList.toggle('muted', !data.company || data.company === 'не указано');

  els.summary.textContent = data.summary || 'не указано';

  renderKeyData(data.key_data || {});
  renderMissingData(missing, leadType, data.needs_human);
  renderPrivacy(meta && meta.privacy, meta && meta.privacyLog);
  renderBitrix(meta && meta.b24);

  els.nextStep.textContent = data.next_step || 'не указано';
  els.replyDraft.textContent = data.reply_draft || '';
  lastDraft = data.reply_draft || '';

  els.humanBox.classList.toggle('hidden', !data.needs_human);
  els.humanReason.textContent = data.human_reason || '';

  if (meta && meta.ms != null) {
    const seconds = (meta.ms / 1000).toFixed(1).replace('.', ',');
    els.resultMeta.textContent = `Модель: ${meta.model || 'GigaChat'} · Обработано за ${seconds} с`;
  } else {
    els.resultMeta.textContent = '';
  }

  els.result.classList.remove('hidden');
  els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderMissingStat(missing, leadType, needsHuman) {
  const count = missing.length;

  els.missingCount.classList.toggle('hidden', count === 0);
  els.missingCount.textContent = String(count);

  if (count > 0) {
    els.missingStat.textContent = `${count} ${plural(count, 'пункт', 'пункта', 'пунктов')}`;
    els.missingStat.classList.remove('muted');
    return;
  }

  els.missingStat.classList.add('muted');
  if (needsHuman) {
    els.missingStat.textContent = 'уточнит специалист';
  } else if (leadType === 'нецелевой') {
    els.missingStat.textContent = 'не требуется';
  } else {
    els.missingStat.textContent = 'всё есть';
  }
}

function renderKeyData(keyData) {
  els.keyData.textContent = '';

  const order = Object.keys(KEY_LABELS);
  const extraKeys = Object.keys(keyData).filter((key) => !KEY_LABELS[key]);
  let shown = 0;

  for (const key of [...order, ...extraKeys]) {
    if (!(key in keyData)) continue;

    const rawValue = String(keyData[key] || '').trim();
    if (!rawValue || rawValue.toLowerCase() === 'не указано') continue;

    const row = document.createElement('div');
    row.className = 'key-row';

    const label = document.createElement('div');
    label.className = 'key-label';
    label.textContent = KEY_LABELS[key] || key;

    const value = document.createElement('div');
    value.className = 'key-value';
    value.textContent = rawValue;

    row.append(label, value);
    els.keyData.append(row);
    shown += 1;
  }

  els.keyDataField.classList.toggle('hidden', shown === 0);
}

function renderMissingData(items, leadType, needsHuman) {
  els.missingData.textContent = '';

  if (!Array.isArray(items) || items.length === 0) {
    const li = document.createElement('li');

    if (needsHuman) {
      li.className = 'missing-human';
      li.textContent = 'Список недостающих данных уточнит специалист.';
    } else if (leadType === 'нецелевой') {
      li.className = 'missing-ok';
      li.textContent = 'Не требуется: запрос не относится к продуктам и услугам компании';
    } else {
      li.className = 'missing-ok';
      li.textContent = 'Всё необходимое указано';
    }

    els.missingData.append(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = String(item);
    els.missingData.append(li);
  }
}

async function copyText(text, button) {
  if (!text) return;

  if (!button.dataset.idle) button.dataset.idle = button.textContent.trim();

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  button.textContent = 'Скопировано';
  button.classList.add('copied');
  window.setTimeout(() => {
    button.textContent = button.dataset.idle;
    button.classList.remove('copied');
  }, 1600);
}

function buildCardText() {
  if (!lastData) return '';

  const leadLabels = {
    'целевой': 'целевой',
    'нецелевой': 'нецелевой',
    'неясно': 'неясно'
  };
  const lines = ['Результат обработки заявки'];

  lines.push(`Тип лида: ${leadLabels[lastData.lead_type] || 'неясно'}`);
  lines.push(`Нужен человек: ${lastData.needs_human ? 'да' : 'нет'}`);
  if (lastData.company && lastData.company !== 'не указано') {
    lines.push(`Компания: ${lastData.company}`);
  }
  if (lastData.summary) lines.push(`Суть: ${lastData.summary}`);

  const keyData = lastData.key_data || {};
  const keyLines = Object.entries(keyData)
    .filter(([, value]) => value && String(value).trim().toLowerCase() !== 'не указано')
    .map(([key, value]) => `- ${KEY_LABELS[key] || key}: ${value}`);

  if (keyLines.length) {
    lines.push('', 'Известные данные:', ...keyLines);
  }

  const missing = Array.isArray(lastData.missing_data) ? lastData.missing_data : [];
  lines.push(`Чего не хватает: ${missing.length ? missing.join(', ') : 'нет'}`);
  lines.push(`Следующий шаг: ${lastData.next_step || 'не указано'}`);

  if (lastData.reply_draft) {
    lines.push('', 'Черновик ответа:', lastData.reply_draft);
  }

  if (lastB24 && lastB24.ok && lastB24.dealId) {
    lines.push('', `Битрикс24: сделка №${lastB24.dealId}`);
  }

  return lines.join('\n');
}

function copyDraft() {
  copyText(lastDraft, els.copyBtn);
}

function copyNextStep() {
  copyText(els.nextStep.textContent.trim(), els.copyNextBtn);
}

function copyCard() {
  copyText(buildCardText(), els.copyCardBtn);
}

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  submit();
});

els.text.addEventListener('input', updateCounter);
els.text.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    submit();
  }
});

for (const field of FIELD_NAMES) {
  const input = FIELD_INPUTS[field];
  if (!input) continue;
  input.addEventListener('input', () => {
    const error = FIELD_ERRORS[field];
    if (error && !error.classList.contains('hidden')) {
      error.textContent = '';
      error.classList.add('hidden');
      input.classList.remove('invalid');
      input.removeAttribute('aria-invalid');
    }
  });
}

els.copyBtn.addEventListener('click', copyDraft);
els.copyNextBtn.addEventListener('click', copyNextStep);
els.copyCardBtn.addEventListener('click', copyCard);

document.querySelectorAll('[data-sample]').forEach((button) => {
  button.addEventListener('click', () => fillSample(Number(button.dataset.sample)));
});

async function initBitrixOption() {
  if (!els.b24Option) return;

  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;

    const payload = await response.json();
    if (!payload || !payload.b24 || payload.b24.configured !== true) {
      els.b24Option.classList.add('hidden');
    }
  } catch {
    // Если проверка не удалась, оставляем чекбокс видимым.
  }
}

initBitrixOption();
updateCounter();
