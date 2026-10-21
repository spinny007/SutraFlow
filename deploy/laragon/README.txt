SutraFlow
Copyright (c) 2026-27 Surya Partap Singh
Developer: Surya Partap Singh | Website: MixAgile.com
File version: 1.9.0
License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
SPDX-License-Identifier: AGPL-3.0-only

SutraFlow under Laragon
=======================

Everything is one launcher, the same one used on every machine:

  C:\laragon\www\sutra\bin\sutraflow.cmd <command>      (run "sutraflow help" for all)

  start              Studio: designer + Admin Console + engine   http://127.0.0.1:4810  (http://sutra.test)
  start engine       Headless engine on the same database         http://127.0.0.1:4811/admin
  stop | stop engine | stop all | restart      Graceful: running steps finish first
  status             Ready or not, process, addresses, database
  logs [engine] [--follow]                    The output log
  open | open admin | open guide              The page in the browser
  cli sutras list    The sutra command against this studio (local admin token)
  db info            Which database is in use

Install or update
  1. Copy the SutraFlow folder (dist, bin, docs, package.json, package-lock.json) to C:\laragon\www\sutra
     and run there: npm ci --omit=dev
  2. Copy this folder's sutraflow.env to C:\laragon\www\sutra\sutraflow.env (Laragon ports, data folder,
     PostgreSQL address, Node path).
  3. Apache site for http://sutra.test: copy 01-sutra.conf to C:\laragon\etc\apache2\sites-enabled\
  4. Start with Laragon: Menu > Procfile, add
       SutraFlow: autorun C:\laragon\www\sutra\bin\sutraflow.cmd start --foreground PWD=www/sutra

Data (database file, master.key, logs, admin-token.txt): C:\laragon\data\sutraflow
Gateway: studio http://127.0.0.1:8090, engine http://127.0.0.1:8091
Keep admin-token.txt and master.key private: the token acts as an administrator, the key opens the vault.
