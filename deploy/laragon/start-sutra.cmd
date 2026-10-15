@echo off
rem SutraFlow under Laragon. Started from Laragon's Procfile (Menu > Procfile) or by hand.
rem Data (database, vault key, logs) lives outside the web folder: C:\laragon\data\sutraflow
rem Studio and Admin Console: http://sutra.test (Apache proxy) or http://127.0.0.1:4810
rem Gateway (deployed REST/SOAP/MCP services): http://127.0.0.1:8090
cd /d "%~dp0"
set SUTRA_DATA_DIR=C:\laragon\data\sutraflow
set SUTRA_ADMIN_HOST=127.0.0.1
set SUTRA_ADMIN_PORT=4810
set SUTRA_GATEWAY_HTTP_PORT=8090
set SUTRA_GATEWAY_HTTPS_PORT=8453
set SUTRA_ENGINE_ID=laragon
"C:\Users\kunwa\AppData\Local\Author Software\nvm\.nodejs\node.exe" --disable-warning=ExperimentalWarning dist\server\main.js
