@echo off
rem SutraFlow launcher for Windows: start, stop, status and more. Run "sutraflow help".
rem Node.js: SUTRA_NODE from the environment, else from sutraflow.env, else node on the PATH.
setlocal
set "SF_ENV=%SUTRAFLOW_ENV%"
if not defined SF_ENV set "SF_ENV=%~dp0..\sutraflow.env"
if not defined SUTRA_NODE if exist "%SF_ENV%" for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%SF_ENV%") do if /i "%%a"=="SUTRA_NODE" if not "%%b"=="" set "SUTRA_NODE=%%b"
if not defined SUTRA_NODE set "SUTRA_NODE=node"
"%SUTRA_NODE%" "%~dp0sutraflow.mjs" %*
