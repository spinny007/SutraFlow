@echo off
@rem SutraFlow
@rem Copyright (c) 2026-27 Surya Partap Singh
@rem Developer: Surya Partap Singh | Website: MixAgile.com
@rem File version: 1.7.5
@rem License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
@rem A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
@rem SPDX-License-Identifier: AGPL-3.0-only
rem Moves SutraFlow from SQLite to PostgreSQL on Windows: stops it, copies the data, points
rem sutraflow.env at PostgreSQL, starts it again and checks it (back to SQLite if anything fails).
rem The PostgreSQL connection is the one saved on the Admin Console's Database page, or give
rem --url postgres://user:password@host:5432/sutraflow. Add --replace to overwrite SutraFlow tables
rem already in that database. Node.js: SUTRA_NODE, else from sutraflow.env, else node on the PATH.
setlocal
set "SF_ENV=%SUTRAFLOW_ENV%"
if not defined SF_ENV set "SF_ENV=%~dp0..\sutraflow.env"
if not defined SUTRA_NODE if exist "%SF_ENV%" for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%SF_ENV%") do if /i "%%a"=="SUTRA_NODE" if not "%%b"=="" set "SUTRA_NODE=%%b"
if not defined SUTRA_NODE set "SUTRA_NODE=node"
"%SUTRA_NODE%" "%~dp0migrate-to-postgres.mjs" --env "%SF_ENV%" %*
