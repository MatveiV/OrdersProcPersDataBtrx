'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  appendPrivacyRecord,
  csvCell,
  readPrivacyLog
} = require('../privacy-log');

function tempLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-log-'));
  return path.join(dir, 'anonymization.csv');
}

test('пишет заголовок и строку без персональных данных', async () => {
  const file = tempLog();
  process.env.PRIVACY_LOG_FILE = file;
  process.env.PRIVACY_LOG_ENABLED = 'true';

  const result = await appendPrivacyRecord({
    timestamp: '2026-10-26T12:00:00.000Z',
    requestId: 'req-1',
    model: 'GigaChat-2-Max',
    elapsedMs: 7800,
    total: 3,
    unique: 3,
    restored: 3,
    unresolved: 0,
    byType: { 'ИМЯ': 1, 'ТЕЛЕФОН': 1, 'EMAIL': 1 },
    leadType: 'целевой',
    needsHuman: false,
    b24Status: 'ok'
  });

  assert.equal(result.enabled, true);
  assert.equal(result.appended, true);

  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);

  assert.match(lines[0], /timestamp,request_id,model/);
  assert.match(lines[1], /2026-10-26T12:00:00.000Z,req-1,GigaChat-2-Max,7800,3,3,3,0/);
  assert.match(lines[1], /ИМЯ=1; ТЕЛЕФОН=1; EMAIL=1/);
  assert.match(lines[1], /целевой,no,ok/);

  // В журнале не должно быть ни текста заявки, ни телефона, ни e-mail.
  assert.doesNotMatch(text, /\+7|@example|Марина/);

  const log = await readPrivacyLog();
  assert.equal(log.enabled, true);
  assert.equal(log.records, 1);
  assert.match(log.text, /req-1/);

  delete process.env.PRIVACY_LOG_FILE;
});

test('дописывает вторую строку и считает записи', async () => {
  const file = tempLog();
  process.env.PRIVACY_LOG_FILE = file;
  process.env.PRIVACY_LOG_ENABLED = 'true';

  await appendPrivacyRecord({ requestId: 'req-1', total: 1, byType: { 'ИМЯ': 1 } });
  await appendPrivacyRecord({ requestId: 'req-2', total: 2, byType: { 'EMAIL': 2 } });

  const log = await readPrivacyLog();
  assert.equal(log.records, 2);
  assert.match(log.text, /req-1/);
  assert.match(log.text, /req-2/);

  delete process.env.PRIVACY_LOG_FILE;
});

test('экранирует кавычки и защищает от формул Excel', async () => {
  assert.equal(csvCell('обычное'), 'обычное');
  assert.equal(csvCell('значение, с запятой'), '"значение, с запятой"');
  assert.equal(csvCell('кавычка "внутри"'), '"кавычка ""внутри"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('+7 999'), "'+7 999");

  const file = tempLog();
  process.env.PRIVACY_LOG_FILE = file;
  process.env.PRIVACY_LOG_ENABLED = 'true';

  await appendPrivacyRecord({ requestId: 'req,1', model: '=модель', total: 1 });
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /"req,1"/);
  assert.match(text, /'=модель/);

  delete process.env.PRIVACY_LOG_FILE;
});

test('журнал можно отключить переменной окружения', async () => {
  const file = tempLog();
  process.env.PRIVACY_LOG_FILE = file;
  process.env.PRIVACY_LOG_ENABLED = 'false';

  const result = await appendPrivacyRecord({ requestId: 'req-1', total: 1 });

  assert.equal(result.enabled, false);
  assert.equal(result.appended, false);
  assert.equal(fs.existsSync(file), false);

  const log = await readPrivacyLog();
  assert.equal(log.enabled, false);
  assert.equal(log.records, 0);

  delete process.env.PRIVACY_LOG_FILE;
  delete process.env.PRIVACY_LOG_ENABLED;
});
