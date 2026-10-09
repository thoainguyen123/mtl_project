@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Dang cai thu vien lan dau...
  call npm install --no-audit --no-fund
)
if not exist .next (
  echo Dang build ban demo...
  call npx next build
)
start "" http://localhost:3100
call npx next start -p 3100
