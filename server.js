'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { analyzeLead, GigaChatError, publicConfig } = require('./gigachat');
const { createPrivacySession, PrivacyError } = require('./privacy');
const { appendPrivacyRecord, readPrivacyLog } = require('./privacy-log');
const {
  BitrixError,
  isConfigured: isBitrixConfigured,
  publicStatus: bitrixPublicStatus,
  syncLead
} = require('./bitrix');
const {
  LeadInputError,
  normalizeLeadInput,
  validateLeadInput,
  MAX_TEXT_LENGTH
} = require('./lead-input');

// Читаем .env из папки проекта (встроенная возможность Node.js, без библиотек).
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // Файла .env нет — приложение подскажет об этом при первой обработке.
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 30 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Файл не найден');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=60'
    });
    res.end(content);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error('Слишком большой запрос');
        error.code = 'BODY_TOO_LARGE';
        req.destroy();
        reject(error);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function syncToBitrix({ payload, fields, data, meta, privacyStats, requestId }) {
  if (payload && payload.b24 === false) {
    return {
      enabled: isBitrixConfigured(),
      ok: false,
      skipped: true,
      message: 'Отправка в Битрикс24 отключена в форме.'
    };
  }

  if (!isBitrixConfigured()) {
    return {
      enabled: false,
      ok: false,
      skipped: true,
      message: 'Интеграция с Битрикс24 не настроена.'
    };
  }

  const startedAt = Date.now();

  try {
    const result = await syncLead({
      fields,
      data,
      meta,
      privacyStats,
      requestId
    });

    if (result.dealId) {
      const parts = [`сделка ${result.dealId}`];
      if (result.contactId) parts.push(`контакт ${result.contactId}`);
      if (result.companyId) parts.push(`компания ${result.companyId}`);
      if (result.taskId) parts.push(`задача ${result.taskId}`);
      console.log(`Битрикс24: ${result.existing ? 'найдена' : 'создана'} ${parts.join(', ')}`);
    }

    return {
      enabled: true,
      ...result,
      ms: Date.now() - startedAt
    };
  } catch (error) {
    const isBitrix = error instanceof BitrixError;

    console.error(`Битрикс24: ошибка ${isBitrix ? error.code : 'INTERNAL'}`);

    return {
      enabled: true,
      ok: false,
      error: {
        code: isBitrix ? error.code : 'INTERNAL',
        message: isBitrix ? error.userMessage : 'Не удалось создать сделку в Битрикс24.',
        hint: isBitrix ? error.hint : 'Проверьте настройки интеграции и повторите обработку.'
      },
      ms: Date.now() - startedAt
    };
  }
}

async function handleAnalyze(req, res) {
  const declaredSize = Number(req.headers['content-length'] || 0);
  if (declaredSize > MAX_BODY_BYTES) {
    sendJson(res, 413, {
      ok: false,
      error: {
        message: 'Текст заявки слишком длинный.',
        hint: `Максимальная длина — ${MAX_TEXT_LENGTH} символов. Сократите текст и попробуйте снова.`
      }
    });
    return;
  }

  let payload;

  try {
    const body = await readBody(req);
    payload = JSON.parse(body);
  } catch (error) {
    if (error.code === 'BODY_TOO_LARGE') {
      sendJson(res, 413, {
        ok: false,
        error: {
          message: 'Текст заявки слишком длинный.',
          hint: `Максимальная длина — ${MAX_TEXT_LENGTH} символов. Сократите текст и попробуйте снова.`
        }
      });
      return;
    }
    sendJson(res, 400, {
      ok: false,
      error: {
        message: 'Не удалось прочитать отправленные данные.',
        hint: 'Обновите страницу и попробуйте снова.'
      }
    });
    return;
  }

  let privacy = null;

  try {
    const fields = normalizeLeadInput(payload);
    const composedText = validateLeadInput(fields);

    privacy = createPrivacySession();

    const knownValues = [
      { type: 'ИМЯ', value: fields.name },
      { type: 'ТЕЛЕФОН', value: fields.phone },
      { type: 'EMAIL', value: fields.email },
      { type: 'КОМПАНИЯ', value: fields.company },
      { type: 'АДРЕС', value: fields.address }
    ].filter((item) => item.value);

    const anonymizedText = privacy.anonymize(composedText, knownValues);
    const result = await analyzeLead(anonymizedText);
    const data = privacy.restore(result.data);
    const privacyStats = privacy.getStats(anonymizedText);

    const requestId = crypto.randomUUID();
    const b24 = await syncToBitrix({
      payload,
      fields,
      data,
      meta: result.meta,
      privacyStats,
      requestId
    });

    // Журнал хранит только счётчики: ни текста заявки, ни значений полей в нём нет.
    const privacyLog = await appendPrivacyRecord({
      requestId,
      model: result.meta.model,
      elapsedMs: result.meta.ms,
      ...privacyStats,
      leadType: data.lead_type,
      needsHuman: data.needs_human,
      b24Status: b24.ok ? 'ok' : b24.skipped ? (payload.b24 === false ? 'disabled' : 'skipped') : 'error'
    });

    sendJson(res, 200, {
      ok: true,
      data,
      meta: {
        ...result.meta,
        privacy: privacyStats,
        privacyLog: {
          enabled: privacyLog.enabled,
          appended: privacyLog.appended,
          file: privacyLog.file
        },
        b24
      }
    });
  } catch (error) {
    if (error instanceof LeadInputError) {
      sendJson(res, error.status, {
        ok: false,
        error: {
          message: error.userMessage,
          hint: error.hint,
          field: error.field
        }
      });
      return;
    }

    if (error instanceof PrivacyError) {
      sendJson(res, error.status, {
        ok: false,
        error: {
          code: error.code,
          message: error.userMessage,
          hint: error.hint
        }
      });
      return;
    }

    if (error instanceof GigaChatError) {
      sendJson(res, error.status, {
        ok: false,
        error: {
          code: error.code,
          message: error.userMessage,
          hint: error.hint
        }
      });
      return;
    }

    console.error('Внутренняя ошибка обработки:', error && (error.stack || error.message));
    sendJson(res, 500, {
      ok: false,
      error: {
        message: 'Внутренняя ошибка при обработке заявки.',
        hint: 'Попробуйте ещё раз. Если не помогает — перезапустите приложение.'
      }
    });
  } finally {
    if (privacy) privacy.destroy();
  }
}

function createServer() {
  return http.createServer((req, res) => {
    const startedAt = Date.now();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    res.on('finish', () => {
      const ms = Date.now() - startedAt;
      console.log(`${new Date().toLocaleTimeString('ru-RU')} ${req.method} ${pathname} → ${res.statusCode} (${ms} мс)`);
    });

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true, ...publicConfig(), b24: bitrixPublicStatus() });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/privacy/log') {
      readPrivacyLog()
        .then((log) => {
          if (!log.enabled) {
            sendJson(res, 404, {
              ok: false,
              error: { message: 'Журнал анонимизации отключён в настройках.' }
            });
            return;
          }

          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="anonymization.csv"',
            'Cache-Control': 'no-store',
            'X-Log-Records': String(log.records)
          });
          res.end(log.text);
        })
        .catch(() => {
          if (!res.headersSent) {
            sendJson(res, 500, {
              ok: false,
              error: { message: 'Не удалось прочитать журнал анонимизации.' }
            });
          }
        });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/analyze') {
      handleAnalyze(req, res).catch((error) => {
        console.error('Необработанная ошибка:', error);
        if (!res.headersSent) {
          sendJson(res, 500, {
            ok: false,
            error: {
              message: 'Внутренняя ошибка при обработке заявки.',
              hint: 'Попробуйте ещё раз. Если не помогает — перезапустите приложение.'
            }
          });
        }
      });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      res.end('Метод не поддерживается');
      return;
    }

    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_DIR, relativePath);

    // Защита от выхода за пределы папки public.
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Доступ запрещён');
      return;
    }

    sendFile(res, filePath);
  });
}

const server = createServer();

server.listen(PORT, HOST, () => {
  const config = publicConfig();
  console.log('');
  console.log('  AI-помощник по входящим заявкам');
  console.log(`  Сайт:      http://localhost:${PORT}`);
  console.log(`  Модель:    ${config.model} (${config.scope})`);
  console.log(`  Доступ:    ${config.configured ? 'ключ найден в .env' : 'КЛЮЧ НЕ ЗАДАН — заполните .env'}`);
  console.log(`  Сертификаты Минцифры: ${config.certificates ? 'подключены из папки certs' : 'не найдены (используются системные)'}`);
  console.log(`  Битрикс24: ${isBitrixConfigured() ? 'сделки включены' : 'не настроен (B24_URL)'}`);
  console.log('');
  console.log('  Остановить: нажмите Ctrl + C в этом окне.');
  console.log('');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\nПорт ${PORT} уже занят. Закройте другое приложение или измените PORT в файле .env.\n`);
  } else {
    console.error('\nНе удалось запустить сервер:', error.message, '\n');
  }
  process.exit(1);
});

function shutdown() {
  console.log('\nОстанавливаю приложение…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
