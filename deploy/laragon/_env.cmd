@echo off
rem Shared settings for the SutraFlow scripts in this folder. Change them here only.
set "SUTRA_HOME=%~dp0"
set "SUTRA_DATA_DIR=C:\laragon\data\sutraflow"
set "SUTRA_NODE=C:\Users\kunwa\AppData\Local\Author Software\nvm\.nodejs\node.exe"
rem Studio (designer + Admin Console + engine) and a headless engine, on one database.
set "STUDIO_PORT=4810"
set "ENGINE_PORT=4811"
rem Database: empty = SQLite in the data folder. To use Laragon's PostgreSQL (port 5432), stop
rem SutraFlow, copy the data once with
rem   sutra.cmd db copy --to postgres://postgres@127.0.0.1:5432/sutraflow
rem then set the address here. The master key stays in the data folder, so secrets remain readable.
set "SUTRA_DB=postgres://postgres@127.0.0.1:5432/sutraflow"
if not exist "%SUTRA_DATA_DIR%" mkdir "%SUTRA_DATA_DIR%"
rem A local admin token, made once, kept outside the web folder: lets stop, status and sutra.cmd work.
if not exist "%SUTRA_DATA_DIR%\admin-token.txt" "%SUTRA_NODE%" -e "require('fs').writeFileSync(process.argv[1], require('crypto').randomBytes(24).toString('hex'))" "%SUTRA_DATA_DIR%\admin-token.txt"
set /p SUTRA_ADMIN_TOKEN=<"%SUTRA_DATA_DIR%\admin-token.txt"
set "SUTRA_ADMIN_HOST=127.0.0.1"
