'use strict';

/* Тестовые заявки хранятся прямо в приложении — для кнопок подстановки. */
const SAMPLES = [
  'Здравствуйте! Я офис-менеджер компании "Альфа-Логистик". Мы переезжаем в новый офис на 40 рабочих мест и хотим заказать поставку и сборку офисной мебели: столы, кресла и шкафы. Переезд — в начале следующего месяца, бюджет около 1,5 млн рублей. Пришлите, пожалуйста, коммерческое предложение.',
  'Добрый день, сколько у вас стоят офисные кресла? Нужно несколько штук.',
  'Это уже третье письмо! Заказ должны были привезти в понедельник, сейчас четверг — ни мебели, ни звонка. Менеджер не берёт трубку. Если завтра ничего не изменится, будем отказываться и требовать возврат предоплаты.',
  'Здравствуйте! Меня зовут Марина Соколова, я административный директор компании «Вектор-Медиа». Планируем обустроить новый этаж на 25 рабочих мест: нужны письменные столы, эргономичные кресла и три шкафа для документов. Также требуется доставка и сборка. Бюджет — 2,3 млн рублей, срок — до 15 декабря. Адрес: Москва, ул. Ленинская Слобода, 19. Свяжитесь со мной по телефону +7 999 123-45-67 или marinas@example.com. Ждём коммерческое предложение.',
  'Здравствуйте! Пишу по поводу размещения рекламы. Мы предлагаем опубликовать вакансии вашей компании на нашем job-портале: аудитория 50 000 соискателей в месяц, пакет размещения — 15 000 рублей. Будет интересно? Готова прислать подробные условия.',
  'Добрый день! Хотим заказать шкафы для раздевалки в спортзал, примерно 10 штук. Подскажите, какие есть варианты и сколько будет стоить с доставкой? Бюджет пока не определили.'
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

const els = {
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
  company: document.getElementById('company'),
  summary: document.getElementById('summary'),
  keyData: document.getElementById('keyData'),
  keyDataField: document.getElementById('keyDataField'),
  missingData: document.getElementById('missingData'),
  nextStep: document.getElementById('nextStep'),
  replyDraft: document.getElementById('replyDraft'),
  humanBox: document.getElementById('humanBox'),
  humanReason: document.getElementById('humanReason'),
  copyBtn: document.getElementById('copyBtn')
};

let busy = false;
let timerId = null;
let startedAt = 0;
let lastDraft = '';

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
    els.statusText.textContent = 'Анализируем заявку…';
    timerId = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      els.statusText.textContent = `Анализируем заявку… ${seconds} с`;
    }, 1000);
  } else if (timerId) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function fillSample(index) {
  const sample = SAMPLES[index];
  if (typeof sample !== 'string') return;

  els.text.value = sample;
  updateCounter();
  hideError();
  els.text.focus();
  els.text.setSelectionRange(sample.length, sample.length);
}

async function submit() {
  if (busy) return;

  const text = els.text.value.trim();
  if (!text) {
    showError('Текст заявки пустой.', 'Вставьте текст обращения или выберите одну из тестовых заявок.');
    els.text.focus();
    return;
  }

  hideError();
  els.result.classList.add('hidden');
  setBusy(true);

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || !payload || payload.ok !== true) {
      const error = (payload && payload.error) || {};
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

function renderResult(data, meta) {
  if (!data) {
    showError('Сервер не вернул результат.', 'Попробуйте обработать заявку ещё раз.');
    return;
  }

  const leadType = data.lead_type || 'неясно';
  const leadLabels = {
    'целевой': 'Целевой лид',
    'нецелевой': 'Нецелевой лид',
    'неясно': 'Тип неясен'
  };

  els.leadTypeBadge.textContent = leadLabels[leadType] || leadLabels['неясно'];
  els.leadTypeBadge.className = `badge badge-${leadType === 'нецелевой' ? 'not-target' : leadType === 'целевой' ? 'target' : 'unclear'}`;

  els.humanBadge.textContent = data.needs_human ? 'Нужен человек' : 'Можно без человека';
  els.humanBadge.className = `badge ${data.needs_human ? 'badge-human' : 'badge-auto'}`;

  els.company.textContent = data.company || 'не указано';
  els.company.classList.toggle('muted', !data.company || data.company === 'не указано');

  els.summary.textContent = data.summary || 'не указано';

  renderKeyData(data.key_data || {});
  renderMissingData(data.missing_data || [], leadType, data.needs_human);

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

async function copyDraft() {
  if (!lastDraft) return;

  const original = els.copyBtn.textContent;

  try {
    await navigator.clipboard.writeText(lastDraft);
  } catch {
    const area = document.createElement('textarea');
    area.value = lastDraft;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  els.copyBtn.textContent = 'Скопировано';
  els.copyBtn.classList.add('copied');
  window.setTimeout(() => {
    els.copyBtn.textContent = original;
    els.copyBtn.classList.remove('copied');
  }, 1600);
}

els.text.addEventListener('input', updateCounter);
els.text.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    submit();
  }
});
els.submit.addEventListener('click', submit);
els.copyBtn.addEventListener('click', copyDraft);

document.querySelectorAll('[data-sample]').forEach((button) => {
  button.addEventListener('click', () => fillSample(Number(button.dataset.sample)));
});

updateCounter();
