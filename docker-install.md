# SutraFlow 2.1.8 in Docker — install steps

A fresh installation on Windows with Docker Desktop: one **studio** (design Sutras) and one **engine** (run them), each with its own data volume. Commands are for PowerShell.

> **Ports and name:** set in `.env`. This guide uses the studio on **4900** and the engine on **4901** (so it does not clash with a SutraFlow on 4800) and names the install **production** (`COMPOSE_PROJECT_NAME=sutraflow-production`, `SUTRA_ENVIRONMENT=production`). The same steps were run on this machine; the Admin Guide chapter "Docker in plain words" shows them with screenshots.

## 1. Download the image

```powershell
docker pull ghcr.io/spinny007/sutraflow:2.1.8
```

The image is public; no sign-in is needed. `latest` points at the newest release, but pin the version on real sites.

Optional: check the signature (needs cosign):

```powershell
cosign verify ghcr.io/spinny007/sutraflow:2.1.8 --certificate-identity-regexp '^https://github.com/spinny007/SutraFlow/' --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## 2. Make a folder with the compose file

```powershell
New-Item -ItemType Directory -Force C:\sutra-production\deploy-drop | Out-Null
Copy-Item C:\Users\kunwa\Documents\LocalGitHub\SutraFlow\deploy\docker\compose.yml C:\sutra-production\
cd C:\sutra-production
```

`compose.yml` is also in every release package under `deploy\docker\`. `.sutra` packages put in `deploy-drop` are deployed when the engine starts.

## 3. Make the `.env` file (token and vault key)

### What the two values are

| Value | What it is | Where it comes from |
| --- | --- | --- |
| `SUTRA_ADMIN_TOKEN` | The password of the admin API. `sutra` commands and pipelines present it. | **You make it up**: any long random string. You do not get it from anywhere; the containers read it from `.env` on start and from then on accept exactly that value. |
| `SUTRA_MASTER_KEY` | The key that encrypts the vault (secret properties). | **You make it up**: 32 random bytes, Base64. **Back it up**: without it the secrets cannot be read, and changing it later makes the stored ones unreadable. |

### Make both and write `.env`

```powershell
$r = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$t = New-Object byte[] 24; $r.GetBytes($t)
$k = New-Object byte[] 32; $r.GetBytes($k)
@"
COMPOSE_PROJECT_NAME=sutraflow-production
SUTRA_IMAGE=ghcr.io/spinny007/sutraflow
SUTRA_VERSION=2.1.8
SUTRA_ADMIN_TOKEN=$(($t | ForEach-Object { $_.ToString('x2') }) -join '')
SUTRA_MASTER_KEY=$([Convert]::ToBase64String($k))
SUTRA_ENVIRONMENT=production
SUTRA_DEPLOY_FOLDER=./deploy-drop
SUTRA_STUDIO_PORT=4900
SUTRA_STUDIO_GATEWAY_PORT=4980
SUTRA_ENGINE_PORT=4901
SUTRA_ENGINE_GATEWAY_PORT=4990
SUTRA_ENGINE_GATEWAY_TLS_PORT=4943
"@ | Set-Content -Encoding ascii .env
```

### The master key: check and back it up before the first start

```powershell
[Convert]::FromBase64String((Select-String -Path .env -Pattern '^SUTRA_MASTER_KEY=(.+)$').Matches[0].Groups[1].Value).Length
```

It must answer `32`. Then copy the key to a password manager or your secret store, away from the server. One key per environment; never change it on a running environment and never copy production's key to test. The Admin Guide shows this step as a screenshot (the key blurred).

### A token on its own (if you only need a new one)

```powershell
$b = New-Object byte[] 24; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

Paste it after `SUTRA_ADMIN_TOKEN=` in `.env`, then `docker compose up -d` so the containers take it.

### Ports in `.env`

| Setting | Default | Here |
| --- | --- | --- |
| `SUTRA_STUDIO_PORT` | 4800 | 4900 |
| `SUTRA_STUDIO_GATEWAY_PORT` | 8080 | 4980 |
| `SUTRA_ENGINE_PORT` | 4801 | 4901 |
| `SUTRA_ENGINE_GATEWAY_PORT` | 9080 | 4990 |
| `SUTRA_ENGINE_GATEWAY_TLS_PORT` | 9443 | 4943 |

Leave them out to use the defaults. Change them, then `docker compose up -d`, to move a running install.

### Keep it safe

- `.env` holds both values: keep it private, never in Git, never in a chat or ticket.
- See it again: `Get-Content C:\sutra-production\.env`.
- Keep a copy of `SUTRA_MASTER_KEY` somewhere safe (a password manager).

## 4. Start it

```powershell
docker compose up -d
docker compose ps
curl.exe http://localhost:4900/ready
curl.exe http://localhost:4901/ready
```

`/ready` answers 200 when the server is ready for work (studio on 4900, engine on 4901).

## 5. Sign in

| What | Address | First administrator |
| --- | --- | --- |
| Studio | http://localhost:4900 | Asked for on the first visit |
| Engine | http://localhost:4901/admin | Made with the command below |
| Gateways | engine: http 4990, https 4943; studio: http 4980 | — |

```powershell
docker compose exec -e ADMIN_PW="<choose a password>" engine sutra user add admin --role administrator --password-from-env ADMIN_PW
```

## After installation: where to sign in

The **studio** has the designer (editor). The **engine** is headless: it has no designer, only the Admin Console and the Approval Center. Sutras are designed in the studio and deployed to the engine.

| Page | Studio (port 4900) | Engine (port 4901) |
| --- | --- | --- |
| Designer / editor | http://localhost:4900/ | — not available (`/` answers 404) |
| Admin Console | http://localhost:4900/admin | http://localhost:4901/admin |
| Approval Center (business people) | http://localhost:4900/approvals | http://localhost:4901/approvals |
| Guides | `/guide`, `/admin-guide`, `/design-guide`, `/architecture` | the same |

Every page uses the same sign-in, and a sign-in on one page of a server counts for its other pages.

### The studio: designer and Admin Console

1. Open http://localhost:4900/.
2. **First visit only:** the page shows **Create the administrator**. Choose a name and a password (twice), then click the button. This is the studio's first administrator; it is signed in at once.
3. Later visits show **Sign in**: the same name and password.
4. The designer opens. The Admin Console is at http://localhost:4900/admin (same sign-in).
5. Add other people in the Admin Console on the **Users** page, or with `sutra user add` (section 7). They choose their own password at their first sign-in.

### The engine: Admin Console

1. Make its first administrator once (the command at the top of this step). The engine does not offer **Create the administrator** in the browser.
2. Open http://localhost:4901/admin and sign in with that name and password.
3. You are asked to choose a new password at the first sign-in (unless the account was made with `--keep-password`).
4. The console shows what is deployed, runs, approvals, engines, the gateway, alerts and users. Designing is done in the studio, then deployed here (step 6).

### Separate accounts

The studio and the engine each have their own database, so their accounts are separate: an administrator made in the studio cannot sign in to the engine, and the other way round. Make the people each one needs on each server. (In the cluster setup, `compose.cluster.yml`, all engines share one PostgreSQL database and therefore one set of accounts.)

### Forgotten password or a locked account

```powershell
docker compose exec -e NEW_PW="<new password>" engine sutra user password admin --password-from-env NEW_PW
docker compose exec engine sutra user unlock admin
```

Use `studio` instead of `engine` for a studio account.

## 6. Deploy a Sutra package to the engine

Either drop the `.sutra` file into `C:\sutra-production\deploy-drop` and run `docker compose restart engine`, or deploy it with an approved plan:

```powershell
docker compose cp orders-1.4.0.sutra engine:/tmp/
docker compose exec engine sutra check /tmp/orders-1.4.0.sutra
docker compose exec engine sutra deploy /tmp/orders-1.4.0.sutra --approve <plan id>
```

`check` lists what is new, unchanged, replaced and undeployed, and gives the plan id that `deploy` asks for. Nothing is replaced without it.

## 7. Logins (people) and system accounts

There are two kinds of account:

| Kind | Who | Signs in with |
| --- | --- | --- |
| **Person** (login) | Someone who opens the studio or the engine's console | Name and password |
| **System account** | A pipeline, a script or another system | An API token (no password) |

Run the commands below inside the container that should hold the account: `studio` or `engine`. In the studio, people can also be added on the **Users** page of the console.

### Roles

| Role | What it may do |
| --- | --- |
| `administrator` | Everything, including users, roles and server settings |
| `developer` | Design and test Sutras and connections |
| `deployer` | Deploy packages and Sutras, roll back |
| `operator` | Run production: runs, approvals, engines, gateway, alerts, audit |
| `approver` | Decide approvals |
| `viewer` | Read what it is granted, change nothing (default for a person) |
| `apiCaller` | Call gateway services (default for a system account) |

Without `--project` the role applies to all projects; with `--project "Orders"` to that project only.

### Add a person (login)

The password is passed through an environment variable so it is not left in the command history:

```powershell
docker compose exec -e NEW_PW="<first password>" engine sutra user add priya --role operator --display "Priya Shah" --email priya@example.com --password-from-env NEW_PW
```

The person chooses a new password at their first sign-in (add `--keep-password` to skip that). The first administrator of an engine is made the same way (step 5).

Looking after people:

```powershell
docker compose exec engine sutra user list
docker compose exec -e NEW_PW="<new password>" engine sutra user password priya --password-from-env NEW_PW
docker compose exec engine sutra user unlock priya        # after too many wrong passwords
docker compose exec engine sutra user sign-out priya      # ends every session (a lost laptop)
docker compose exec engine sutra user disable priya       # a leaver; enable brings them back
docker compose exec engine sutra user delete priya
```

### Add a system account and its token

1. Make the account with only the role it needs, for example a pipeline that deploys the Orders project:

   ```powershell
   docker compose exec engine sutra user add ci-orders --system --role deployer --project "Orders"
   ```

   A brand-new project is not there yet: for its first deploy, give the account `--role deployer` without `--project` (all projects), or deploy once with the admin token.

2. Make its token. **It is shown once**: put it straight into the CI system's secret store (or a password manager):

   ```powershell
   docker compose exec engine sutra token create ci-orders --name github --expires-days 90
   ```

3. Rotate and remove tokens:

   ```powershell
   docker compose exec engine sutra token list ci-orders
   docker compose exec engine sutra token revoke ci-orders <token id>
   ```

### Using a token

Inside a container, `sutra` needs no token: `docker compose exec engine sutra status` uses the container's own `SUTRA_ADMIN_TOKEN`.

From outside (another machine, a pipeline), give the server and a token:

```powershell
sutra status --server http://localhost:4901 --token <token>
```

or set `SUTRA_SERVER` and `SUTRA_ADMIN_TOKEN` once. A system account's token can do only what its role allows. **Do not hand out the admin token** from `.env`: it acts as an administrator and cannot be revoked on its own (only by changing `.env` and restarting).

## Everyday commands

| Task | Command |
| --- | --- |
| Status | `docker compose exec engine sutra status` |
| Logs | `docker compose logs -f engine` |
| Stop (running steps finish first, up to 45 s) | `docker compose stop` |
| Start again | `docker compose up -d` |
| Upgrade | Change `SUTRA_VERSION` in `.env`, then `docker compose pull` and `docker compose up -d` |
| Remove the containers, keep the data | `docker compose down` |
| Remove everything **including the data** | `docker compose down -v` (cannot be undone) |

Data lives in the Docker volumes `studio-data` and `engine-data`; stopping, upgrading and `down` keep it.

## Shortcut from the release package

From the unpacked 2.1.8 package, `bin\sutraflow.cmd docker up` uses the same compose file and makes `.env` (admin token and master key) on first use: steps 2 and 3 done for you. `bin\sutraflow.cmd docker cluster up` starts PostgreSQL with two engines (`compose.cluster.yml`).

## Offline sites

On a machine with internet: `bin\sutraflow.cmd image build` then `bin\sutraflow.cmd image save sutraflow-2.1.8.tar`. Copy the file, then on the offline machine `docker load -i sutraflow-2.1.8.tar` and set `SUTRA_IMAGE=sutraflow` in `.env`.

More: Admin Guide, "Docker, Kubernetes and the application lifecycle".
