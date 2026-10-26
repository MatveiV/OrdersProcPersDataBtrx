'use strict';

/**
 * Журнал анонимизации в CSV.
 *
 * В журнал попадают только счётчики и служебные поля: время, идентификатор
 * запроса, модель, количество замен по типам, тип лида и статус CRM.
 * Сами персональные данные, токены и текст заявки не записываются.
 *
 * Файл по умолчанию: logs/anonymization.csv (папка исключена из git).
 * Отключить журнал: PRIVACY_LOG_ENABLED=false.
 * Другой путь: PRIVACY_LOG_FILE=<путь>.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RELATIVE_FILE = path.join('logs', 'anonymization.csv');
const HEADER = [
  'timestamp',
  'request_id',
  'model',
  'elapsed_ms',
  'privacy_total',
  'privacy_unique',
  'privacy_restored',
  'privacy_unresolved',
  'by_type',
  'lead_type',
  'needs_human',
  'b24_status'
];

let writeQueue = Promise.resolve();

function isEnabled() {
  const value = String(process.env.PRIVACY_LOG_ENABLED || 'true').trim().toLowerCase();
  return value !== 'false' && value !== '0' && value !== 'no';
}

function resolveFile() {
  const custom = String(process.env.PRIVACY_LOG_FILE || '').trim();
  return custom ? path.resolve(custom) : path.join(__dirname, DEFAULT_RELATIVE_FILE);
}

function displayPath(file) {
  const relative = path.relative(__dirname, file);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join('/');
  }
  return path.basename(file);
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);

  // Защита от формул в Excel: ячейка, начинающаяся с = + - @,
  // не должна выполняться как формула.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatByType(byType) {
  return Object.entries(byType || {})
    .sort(([a], [b]) => a.localeCompare(b, 'ru'))
    .map(([type, count]) => `${type}=${count}`)
    .join('; ');
}

function buildRow(record) {
  return [
    record.timestamp || new Date().toISOString(),
    record.requestId || '',
    record.model || '',
    Number(record.elapsedMs) || 0,
    Number(record.total) || 0,
    Number(record.unique) || 0,
    Number(record.restored) || 0,
    Number(record.unresolved) || 0,
    formatByType(record.byType),
    record.leadType || '',
    record.needsHuman ? 'yes' : 'no',
    record.b24Status || ''
  ]
    .map(csvCell)
    .join(',');
}

async function fileExists(file) {
  try {
    await fs.promises.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Добавляет одну строку в журнал. Ошибки записи не пробрасываются:
 * журнал не должен ломать обработку заявки.
 */
function appendPrivacyRecord(record) {
  if (!isEnabled()) {
    return Promise.resolve({ enabled: false, appended: false });
  }

  const file = resolveFile();
  const line = `${buildRow(record)}\r\n`;

  writeQueue = writeQueue.then(async () => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const exists = await fileExists(file);
    const prefix = exists ? '' : `\ufeff${HEADER.map(csvCell).join(',')}\r\n`;
    await fs.promises.appendFile(file, prefix + line, 'utf8');
    const stat = await fs.promises.stat(file);
    return {
      enabled: true,
      appended: true,
      file: displayPath(file),
      bytes: stat.size
    };
  });

  return writeQueue.catch((error) => ({
    enabled: true,
    appended: false,
    file: displayPath(file),
    error: error.code || 'LOG_WRITE_FAILED'
  }));
}

async function readPrivacyLog() {
  const file = resolveFile();

  if (!isEnabled()) {
    return { enabled: false, file: displayPath(file), exists: false, records: 0, text: '' };
  }

  let text = '';
  try {
    text = await fs.promises.readFile(file, 'utf8');
  } catch {
    text = `${HEADER.map(csvCell).join(',')}\r\n`;
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  const records = Math.max(0, lines.length - 1);

  return {
    enabled: true,
    file: displayPath(file),
    exists: text.length > 0,
    records,
    text
  };
}

module.exports = {
  HEADER,
  appendPrivacyRecord,
  csvCell,
  isEnabled,
  readPrivacyLog,
  resolveFile
};
