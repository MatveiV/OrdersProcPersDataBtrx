@echo off
chcp 65001 >nul
cd /d "%~dp0"

title AI-помощник по заявкам

if not exist ".env" (
  echo.
  echo Не найден файл .env
  echo Скопируйте .env.example в .env и заполните GIGACHAT_AUTHORIZATION_KEY.
  echo.
  pause
  exit /b 1
)

echo.
echo Запускаю приложение. Браузер откроется автоматически.
echo Чтобы остановить — закройте это окно или нажмите Ctrl+C.
echo.

start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"

node server.js

echo.
echo Приложение остановлено.
pause
