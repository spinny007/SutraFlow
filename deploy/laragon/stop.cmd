@echo off
rem Graceful stop: no new work, running steps finish (up to 30 s), the rest goes to another engine.
rem   stop.cmd          the studio (port 4810)
rem   stop.cmd engine   the headless engine (port 4811)
call "%~dp0_env.cmd"
set "PORT=%STUDIO_PORT%"
if /i "%~1"=="engine" set "PORT=%ENGINE_PORT%"
curl -s -X POST -H "Authorization: Bearer %SUTRA_ADMIN_TOKEN%" -H "Content-Type: application/json" -d "{}" http://127.0.0.1:%PORT%/api/engine/drain
echo.
