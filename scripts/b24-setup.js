'use strict';

/**
 * Настройка интеграции с Битрикс24.
 *
 * Запуск:
 *   npm run b24:setup
 *   npm run b24:setup -- --dry-run
 *
 * Скрипт проверяет вебхук и права, затем идемпотентно создаёт
 * пользовательские поля сделки. Повторный запуск ничего не дублирует.
 */

const path = require('node:path');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // Файла .env нет — ниже покажем понятную ошибку.
}

const {
  BitrixError,
  callMethod,
  ensureDealFields,
  isConfigured,
  readConfig
} = require('../bitrix');

const REQUIRED_SCOPES = ['crm', 'task', 'im'];

function printHeader(config) {
  let host = '';
  try {
    host = new URL(config.url).host;
  } catch {
    host = 'портал';
  }

  console.log('');
  console.log('  Настройка интеграции с Битрикс24');
  console.log(`  Портал: ${host}`);
  console.log('');
}

async function main() {
  const config = readConfig();
  const dryRun = process.argv.includes('--dry-run');

  if (!isConfigured(config)) {
    console.error('  B24_URL не задан или имеет неверный формат.');
    console.error('  Укажите ссылку входящего вебхука в файле .env, например:');
    console.error('  B24_URL=https://example.bitrix24.ru/rest/1/xxxxxxxxxxxxxxxx/');
    console.error('');
    process.exitCode = 1;
    return;
  }

  printHeader(config);

  const options = { config };

  const profile = await callMethod('profile', {}, options);
  const scope = await callMethod('scope', {}, options);

  console.log(`  Пользователь вебхука: ID ${profile.ID || '—'}${profile.ADMIN ? ' (администратор)' : ''}`);
  console.log(`  Права вебхука: ${Array.isArray(scope) && scope.length ? scope.join(', ') : 'не определены'}`);

  const missingScopes = REQUIRED_SCOPES.filter(
    (required) => !Array.isArray(scope) || !scope.includes(required)
  );

  if (missingScopes.length) {
    console.log('');
    console.log(`  ВНИМАНИЕ: не хватает прав: ${missingScopes.join(', ')}.`);
    console.log('  Пересоздайте вебхук с правами crm, task и im и обновите B24_URL.');
  }

  try {
    const mode = await callMethod('crm.settings.mode.get', {}, options);
    console.log(
      `  Режим CRM: ${Number(mode) === 2 ? 'простой, без лидов — используются сделки' : 'классический, с лидами'}`
    );
  } catch (error) {
    if (error instanceof BitrixError) {
      console.log(`  Режим CRM: не удалось определить (${error.code})`);
    } else {
      throw error;
    }
  }

  console.log('');
  console.log(dryRun ? '  Проверка полей (dry-run, без изменений):' : '  Поля сделки:');

  const result = await ensureDealFields({ ...options, dryRun });

  if (result.created.length) {
    for (const field of result.created) {
      if (field.dryRun) {
        console.log(`  + ${field.name} — будет создано`);
      } else {
        console.log(`  + ${field.name} — создано (ID ${field.id})`);
      }
    }
  }

  if (result.existing.length) {
    for (const name of result.existing) {
      console.log(`  = ${name} — уже есть`);
    }
  }

  console.log('');
  console.log(
    `  Итого: ${result.total} полей, создано ${dryRun ? 'будет ' : ''}${result.created.length}, уже было ${result.existing.length}.`
  );

  if (!dryRun && result.created.length) {
    console.log('');
    console.log('  Перезапустите приложение, чтобы обновить кэш полей.');
  }

  if (missingScopes.length) {
    process.exitCode = 1;
  }

  console.log('');
}

main().catch((error) => {
  if (error instanceof BitrixError) {
    console.error('');
    console.error(`  Ошибка: ${error.userMessage}`);
    if (error.hint) console.error(`  Подсказка: ${error.hint}`);
    console.error(`  Код: ${error.code}`);
    console.error('');
  } else {
    console.error('');
    console.error('  Неожиданная ошибка:', error && (error.stack || error.message));
    console.error('');
  }
  process.exitCode = 1;
});
