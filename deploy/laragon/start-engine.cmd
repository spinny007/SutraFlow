@echo off
rem A headless engine beside the studio, on the same database: it shares the work, serves the
rem gateway on its own ports, and has the Admin Console (no designer) at http://127.0.0.1:4811/admin.
rem Sign in with the same users as the studio. Stop with: stop.cmd engine
call "%~dp0_env.cmd"
cd /d "%SUTRA_HOME%"
set "SUTRA_MODE=engine"
set "SUTRA_ADMIN_PORT=%ENGINE_PORT%"
set "SUTRA_GATEWAY_HTTP_PORT=8091"
set "SUTRA_GATEWAY_HTTPS_PORT=8454"
set "SUTRA_ENGINE_ID=laragon-engine"
"%SUTRA_NODE%" --disable-warning=ExperimentalWarning dist\server\main.js
