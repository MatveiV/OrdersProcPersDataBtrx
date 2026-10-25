'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { analyzeLead, GigaChatError, publicConfig } = require('./gigachat');

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
const MAX_TEXT_LENGTH = 5000;

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

  const rawText = payload && typeof payload.text === 'string' ? payload.text : '';
  const text = rawText.replace(/\r\n/g, '\n').trim();

  if (!text) {
    sendJson(res, 400, {
      ok: false,
      error: {
        message: 'Текст заявки пустой.',
        hint: 'Вставьте текст обращения или выберите одну из тестовых заявок.'
      }
    });
    return;
  }

  if (text.length > MAX_TEXT_LENGTH) {
    sendJson(res, 400, {
      ok: false,
      error: {
        message: 'Текст заявки слишком длинный.',
        hint: `Сократите текст до ${MAX_TEXT_LENGTH} символов и попробуйте снова.`
      }
    });
    return;
  }

  try {
    const result = await analyzeLead(text);
    sendJson(res, 200, {
      ok: true,
      data: result.data,
      meta: result.meta
    });
  } catch (error) {
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

    console.error('Внутренняя ошибка обработки:', error);
    sendJson(res, 500, {
      ok: false,
      error: {
        message: 'Внутренняя ошибка при обработке заявки.',
        hint: 'Попробуйте ещё раз. Если не помогает — перезапустите приложение.'
      }
    });
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
      sendJson(res, 200, { ok: true, ...publicConfig() });
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
