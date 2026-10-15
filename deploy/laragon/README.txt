SutraFlow under Laragon
=======================

start-sutra.cmd     Studio: designer + Admin Console + engine     http://127.0.0.1:4810  (http://sutra.test)
start-engine.cmd    Headless engine on the same database            http://127.0.0.1:4811/admin
stop.cmd            Graceful stop of the studio; stop.cmd engine for the engine
status.cmd          Ready or not, and every engine of the cluster
open-designer.cmd   open-admin.cmd   open-guide.cmd
sutra.cmd ...       The sutra command against this server, for example: sutra.cmd sutras list
_env.cmd            Shared settings: data folder, Node.js, ports, the local admin token

Data (database, vault key, logs, admin-token.txt): C:\laragon\data\sutraflow
Gateway: studio http://127.0.0.1:8090, engine http://127.0.0.1:8091
Laragon starts the studio by itself (Menu > Procfile > SutraFlow).
Keep admin-token.txt private: it acts as an administrator.
