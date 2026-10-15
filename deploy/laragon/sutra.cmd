@echo off
rem The sutra command, pointed at this server with the local admin token.
rem   sutra.cmd sutras list          sutra.cmd runs list --status failed
rem   sutra.cmd engines list         sutra.cmd gateway stats --period 24h
rem   sutra.cmd user add alice --role developer --password-from-env NEW_PASSWORD
call "%~dp0_env.cmd"
if not defined SUTRA_SERVER set "SUTRA_SERVER=http://127.0.0.1:%STUDIO_PORT%"
"%SUTRA_NODE%" --disable-warning=ExperimentalWarning "%SUTRA_HOME%dist\server\cli.js" %*
