@echo off
rem Readiness of the studio and the engine, then every engine of the cluster.
call "%~dp0_env.cmd"
for %%P in (%STUDIO_PORT% %ENGINE_PORT%) do (
  echo Port %%P:
  curl -s http://127.0.0.1:%%P/ready
  echo.
)
call "%~dp0sutra.cmd" engines list
