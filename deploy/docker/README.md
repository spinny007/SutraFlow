# SutraFlow in Docker (2.1.6)

## The image

| Where it comes from | How |
| --- | --- |
| The official image | `docker pull ghcr.io/spinny007/sutraflow:2.1.6`. Signed with cosign (keyless) and with an SBOM and provenance. Check the signature with `cosign verify ghcr.io/spinny007/sutraflow:2.1.6 --certificate-identity-regexp 'https://github.com/spinny007/SutraFlow/' --certificate-oidc-issuer https://token.actions.githubusercontent.com` |
| Your own registry | Copy the official image (`docker pull`, `docker tag`, `docker push`), or build your own on top of it (`FROM ghcr.io/spinny007/sutraflow:2.1.6`) |
| Offline, from this release package | `sutraflow image build` (uses `Dockerfile.package`: no npm registry needed), then `sutraflow image save sutraflow-2.1.6.tar` and `docker load -i sutraflow-2.1.6.tar` on the machine without internet |

The image runs as the `node` user (uid 1000), keeps its data in `/data`, deploys `.sutra` packages found in `/deploy` on start, and answers `/health` (alive) and `/ready` (ready for work; not while draining) on port 4800. On `docker stop` it drains: running steps finish first, so give it a stop timeout (45 seconds here).

## Running it

One server, a studio and an engine, each with its own SQLite database:

```bash
cp deploy/docker/env.example .env
docker compose -f deploy/docker/compose.yml --env-file .env up -d
```

The ports published on the machine come from `.env` (`SUTRA_STUDIO_PORT` 4800, `SUTRA_STUDIO_GATEWAY_PORT` 8080, `SUTRA_ENGINE_PORT` 4801, `SUTRA_ENGINE_GATEWAY_PORT` 9080, `SUTRA_ENGINE_GATEWAY_TLS_PORT` 9443 by default); `COMPOSE_PROJECT_NAME` names the containers and volumes. The Admin Guide chapter "Docker in plain words" has the whole install step by step with screenshots.

A cluster: PostgreSQL, a studio and two engines that share the work:

```bash
docker compose -f deploy/docker/compose.cluster.yml --env-file .env up -d
```

From a release package, `sutraflow docker up` and `sutraflow docker cluster up` use these files and make the `.env` (admin token, master key, database password) on first use.

Without Compose:

```bash
# A studio
docker run -d --name sutra-studio -p 4800:4800 -v sutra-studio:/data -e SUTRA_ADMIN_TOKEN=change-me ghcr.io/spinny007/sutraflow:2.1.6
# A single engine with its own database
docker run -d --name sutra-engine -p 4801:4800 -p 9080:8080 -v sutra-engine:/data --stop-timeout 45 \
  -e SUTRA_MODE=engine -e SUTRA_ADMIN_TOKEN=change-me -e SUTRA_MASTER_KEY=<base64 key> ghcr.io/spinny007/sutraflow:2.1.6
# An engine joining a cluster: the same database and master key as the others
docker run -d --name sutra-engine-3 -p 9082:8080 --stop-timeout 45 -e SUTRA_MODE=engine -e SUTRA_ENGINE_ID=engine-3 \
  -e SUTRA_DB=postgres://sutra:password@db:5432/sutra -e SUTRA_ADMIN_TOKEN=change-me -e SUTRA_MASTER_KEY=<the cluster's key> ghcr.io/spinny007/sutraflow:2.1.6
```

## Configuring and deploying

Settings are not baked into the image. After it starts:

```bash
sutra config apply sutraflow.yaml --env env/prod.yaml --server http://localhost:4801   # creates what is missing
sutra check orders-1.4.0.zip --server http://localhost:4801                           # the plan and its id
sutra deploy orders-1.4.0.zip --approve <plan id> --server http://localhost:4801      # replaces only what was approved
```

Inside a container, `sutra` needs neither: `docker exec <container> sutra status` or `docker compose exec engine-1 sutra deploy /tmp/orders-1.4.0.zip` (after `docker compose cp`) use that container's own server and its `SUTRA_ADMIN_TOKEN`. Set `SUTRA_SERVER` to point it elsewhere, or to empty to work on the database directly.

Engines of different versions must not share a database: to upgrade SutraFlow, stop every engine, change `SUTRA_VERSION`, then start them (not one by one). Keep PostgreSQL near the engines (about 2 ms round trip or less).

The token comes from `SUTRA_ADMIN_TOKEN` or `--token`. In a pipeline, use a system account's token (`sutra token create`). See the Admin Guide, "Containers and Kubernetes", "Configuration as files" and "CI/CD pipelines".
