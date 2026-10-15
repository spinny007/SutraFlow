@echo off
rem Studio: designer, Admin Console and engine in one process.
rem   Designer       http://127.0.0.1:4810        (or http://sutra.test through Apache)
rem   Admin Console  http://127.0.0.1:4810/admin
rem   Gateway        http://127.0.0.1:8090        (deployed REST, SOAP and MCP services)
rem Started by Laragon's Procfile, or by hand. Stop with stop.cmd (running steps finish first).
call "%~dp0_env.cmd"
cd /d "%SUTRA_HOME%"
set "SUTRA_MODE=studio"
set "SUTRA_ADMIN_PORT=%STUDIO_PORT%"
set "SUTRA_GATEWAY_HTTP_PORT=8090"
set "SUTRA_GATEWAY_HTTPS_PORT=8453"
set "SUTRA_ENGINE_ID=laragon"
"%SUTRA_NODE%" --disable-warning=ExperimentalWarning dist\server\main.js
