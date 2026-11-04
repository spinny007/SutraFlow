# 2.1.6 plan: containers, Kubernetes, configuration as files, CI/CD

Status: all phases built 4 November 2026, not committed: Phase 0 (review fixes), 1 (image, release workflow, `sutraflow image build | save`), 2 (`sutra config export | check | apply`, the deploy plan and approval in the command line, API, Admin Console and designer), 3 (`deploy/docker`, `deploy/kubernetes`), 4 (`deploy/ci`), 5 (four Administration Guide chapters, release notes, tests). Live checks on Kubernetes wait for Kubernetes to be enabled in Docker Desktop. Builds on 2.1.5.

The aim: a team takes SutraFlow from a developer's studio to test and production without clicking
in an Admin Console. The server and its projects are described by files kept in Git. Each
environment gets its own values, and pipelines on the team's own CI system and container registry
do the deploying.

## Decisions already made

| Question | Decision |
| --- | --- |
| Registry | The user's choice: any OCI registry (GHCR, Docker Hub, Azure Container Registry, Amazon ECR, Google Artifact Registry, Harbor, GitLab, Nexus, a private one). Nothing hard-codes a registry; templates take registry, image name and credentials as parameters. |
| Official image | Published to GHCR (`ghcr.io/<owner>/sutraflow:<version>`) by the release workflow. `sutraflow image build` builds the same image locally for sites without internet, from the offline package. |
| Orchestration | Kubernetes manifests and standalone Docker (`docker run` and Compose) in 2.1.6. Helm later. |
| Config export | Server settings **and** connections. Deployment teams supply one config file per environment with the connection values, through CI/CD. |
| Secrets in files | Allowed: a value written directly, `${env:NAME}` (environment variable) or `file:/path` (a mounted file, as Kubernetes and Docker secrets are). |
| CI templates | GitHub Actions, GitLab CI, Azure DevOps and Jenkins. |
| Version | 2.1.6, with the Phase 0 review fixes; 2.1.5 stays untagged (4 November 2026). |
| Export scope | Everything but people: users and their roles stay in the Admin Console or the identity provider. System accounts are exported without tokens; tokens are made per environment (`sutra token create`). |
| Apply | **Create what is missing, never change or remove.** An item in the file and not on the server is created; if it cannot be created, apply stops with an error. An item already on the server is left as it is and reported as a warning with its name and type (for a connection: name, kind, the host or address it points to), as a checklist for the DevOps or admin team to verify by hand. No update, no prune. |
| Redeploying Sutras | A release may replace Sutras already on the server, **never without a warning and a person's explicit OK** (see *Redeployment needs approval* below). Sutras that are unchanged need no approval. |
| Kubernetes studio | Optional: engines always; the studio in its own overlay for test environments, left out of production by default. |
| Image signing | Keyless cosign signing from the release workflow, with an SBOM and build provenance. |
| Live checks | Docker Desktop on the development machine (WSL 2), with its Kubernetes, and on GitHub's Linux runners. |

## What exists today (2.1.5)

- `Dockerfile` (Node 24 slim, tini, health check, `/data` volume), `docker-compose.yml` (studio + engine), `docker-compose.cluster.yml`, `sutraflow docker [cluster] up|down|status|logs|build`.
- Project releases: `sutra package --zip` makes a release zip with a deployment config of connections, project variables and logging (`${env:NAME}` supported; secrets by vault name only); `sutra package --from-git` builds it in a pipeline with no server; `sutra check`, `sutra test`, `sutra deploy --config`.
- `.github/workflows/release.yml` builds the zips on Windows and Linux; no image.
- The backlog item *Build the real Docker image* (never built on the release machine) is done by Phase 1.
- Gaps found while planning: both compose files tag the image `sutraflow:1.0.0`; the image carries only the user guide (not the Admin and Design guides); server settings (gateway, firewall, trusted proxies, engines tuning, policies, knowledge admin, audit retention) can only be changed by hand or one command at a time.

## Phase 0: review fixes to 2.1.5 features (done 4 November 2026, not committed)

Five findings from a review of the 2.1.5 code, each reproduced by a new test that fails on the 2.1.5 code and passes with the fix.

| Priority | Seen | Cause | Now | Test |
| --- | --- | --- | --- | --- |
| P1 | Clearing the policy of an MCP server that offers a knowledge tool opened the knowledge base to anyone: the same anonymous request went from 401 to 200 with a private passage | Knowledge admin asked for a policy only when the tool was set up; the request handler served anonymously when the server had none | A knowledge tool answers only behind its own MCP server's policy; without one, `tools/list` and `tools/call` answer 503 and show nothing (`gateway/mcp-handler.ts`) | `knowledge-admin`: MCP search tool |
| P1 | A dashboard cached *for each caller* gave one caller's result to another: two tokens with the same subject from different issuers shared a cache entry | The cache key held the method, subject and app only, while the Sutra also sees the issuer, roles, scopes and other claims | The key is a hash of everything the Sutra receives about the caller (claims except the token's own times and id, so a renewed token keeps its cache) (`gateway/dashboards.ts`) | `dashboards`: keeps callers apart |
| P1 | A project granted `products` could delete `Products/private` on SQLite | Access checks compare areas with their case; the delete used SQLite's `LIKE`, which ignores case | The built-in store matches a folder exactly with `substr(source, 1, n) = 'folder/'` on SQLite and PostgreSQL (`ai/knowledge.ts`) | `knowledge-admin`: removing an area |
| P1 | Removing the samples could delete connections, schemas and properties someone had added to the Samples project, which the preview did not list | The project went whenever no other Sutras were left in it, and deleting a project takes all its connections, schemas and folders | The project goes only when nothing but the listed sample items is in it; otherwise it stays, listed under *kept* with what it holds (`sample-data.ts`) | `sample-data`: the Samples project stays |
| P2 | Choosing *Every project may search* took away a project's explicit write grant | The access check returned search-only before reading the project's grants | Every project searches the whole base, and write grants still apply in their areas; Knowledge admin shows the grants in both modes (`ai/knowledge-access.ts`, `web/admin/KnowledgeAdmin.tsx`, Admin guide access table) | `knowledge-admin`: access and grants |

The related tests (agents, agent channels, gateway, gateway apps, MCP, RAG, dashboards, knowledge admin, sample data): 67 tests, 65 passed, 0 failed, 2 skipped (MySQL and an outside service). Type checks pass. These rows go into the 2.1.6 release notes' Fixes table.

## Phase 1: the image

1. Dockerfile: version label from `package.json` (OCI labels: version, source, licence, revision), all three guides, non-root user kept, `SUTRA_*` settings documented in the image.
2. Multi-architecture build (linux/amd64 and linux/arm64) with `docker buildx`.
3. Release workflow: build, test the image (start it, `/health`, version answers), push to GHCR as `<version>`, `<major>.<minor>` and `latest`; an SBOM and build provenance attached. Registry and owner are workflow inputs with GHCR as default.
4. `sutraflow image build [--tag name:version] [--platform ...]`: builds the image from the unpacked offline package (no npm registry needed); `sutraflow image save <file.tar>` for carrying it to a site with no internet (`docker load`).
5. Compose files: `image: ${SUTRA_IMAGE:-ghcr.io/<owner>/sutraflow}:${SUTRA_VERSION}`; the version tag fixed.

## Phase 2: configuration as files

One file format, YAML or JSON (both read already: the yaml package came in 2.1.5), in two kinds:

- **Server config** (`sutraflow-server.yaml`): gateway (ports, TLS, trusted proxies, firewall), engines (workers, limits, retention, memory, leaders), policies and security (inbound policies, CORS, system accounts without their tokens), audit retention, knowledge admin (sharing, grants, sources), logging and tracing.
- **Project config** (the existing deployment config, extended): connections, project variables, logging, and now secret values.

Commands:

- `sutra config export --server-settings [--out file]` and `sutra config export --project "A,B" [--out file]` (`--server` already names the server to talk to): what is set now; secrets exported as `${env:NAME}` placeholders, never as values.
- `sutra config check <file> [--env <file>]`: reports what would be created, what already exists (the checklist), unresolved references and missing secrets, without changing anything (for pull requests).
- `sutra config apply <file> [--env <file>] [--yes]`: creates what is missing; audited per item. Every item to create is checked first (all or nothing): one that cannot be created stops the apply with an error and nothing is created. Items already there are warnings in a checklist (`--checklist <file>` writes it as Markdown for the team).
- `sutra deploy <release.zip> --config <file> --env <file>`: as today, plus the environment file.

Environment files (`env/test.yaml`, `env/prod.yaml`) hold only what differs: hosts, users, folders, secret values. Values may be:

| Form | Example | Use |
| --- | --- | --- |
| Written directly | `password: s3cret` | Small teams, files kept outside Git |
| Environment variable | `password: ${env:ERP_DB_PASSWORD}` | CI/CD secret variables |
| Mounted file | `password: file:/run/secrets/erp-db-password` | Kubernetes and Docker secrets |

Secret values from any form go into the target server's vault (encrypted with its master key) at apply time; the file is never stored on the server. Check and apply print only secret names. A file holding direct secret values gets a warning in `config check`, unless `--allow-plain-secrets` is given.

### Redeployment needs approval

Applying configuration only creates what is missing; deploying a release is different, because a newer version of a Sutra is the point of a release. So replacing is allowed, but only after someone has seen what will be replaced and said yes.

- `sutra check <release.zip> [--project <name>]` lists, per Sutra: **new** (not on the server), **unchanged** (same content), **replaces** (on the server, with the version and deploy time now there and the version coming), and **undeploys** (on the server, not in the release, unless `--keep-others`). It ends with a **plan id**: a hash of the release and of what is on the server now.
- `sutra deploy` with nothing replaced or undeployed goes ahead as today.
- With something to replace or undeploy:
  - in a terminal, it shows the list and asks to type `yes`; anything else stops it;
  - without a terminal (a pipeline), it stops with exit code 3 and the list, unless `--approve <plan id>` is given. The id must match the plan as it is now: if someone changed a Sutra on the server after the approval, the id differs and the deploy is refused, so a person approves exactly what is replaced.
- The approval, who gave it (the token's account, the CI user when given) and the list go into the audit log.
- Admin Console, Releases: the same list in the deploy dialog; replacing needs the project's name typed to confirm.
- CI templates: **check** prints the list and the plan id; a **manual approval** gate shows them to a person (GitHub environment reviewers, GitLab `when: manual`, Azure DevOps environment approvals, Jenkins `input` asking for the plan id); **deploy** runs with `--approve <plan id>`.

## Phase 3: Kubernetes and Docker templates

Shipped in `deploy/` and in the release packages:

- `deploy/docker/`: `docker run` examples (studio, single engine, engine joining a cluster), Compose for one server and for a cluster with PostgreSQL, a `.env` example.
- `deploy/kubernetes/`: namespace, ConfigMap (server config), Secret (master key, admin token, environment secrets), studio Deployment and Service, engine StatefulSet or Deployment with readiness and liveness on `/health`, `terminationGracePeriodSeconds` matching drain, PodDisruptionBudget, HorizontalPodAutoscaler (optional), Ingress for the gateway (trusted proxy set to the ingress), NetworkPolicy, and a Job that runs `sutra config apply` and `sutra deploy`. A kustomization with `overlays/test` and `overlays/prod`.
- Cluster engines require PostgreSQL (outside the cluster or an operator's); SQLite only for a single pod with a volume.
- Image, registry, pull secret and versions are parameters everywhere.

## Phase 4: CI/CD templates

In `deploy/ci/`, each doing the same four stages: **build** (`sutra package --from-git`), **check** (`sutra check`, `sutra config check` against the target), **test** (`sutra test` with the environment's secrets), **deploy** (`sutra config apply`, `sutra deploy`), with a manual approval before production.

- GitHub Actions (`.github/workflows/sutraflow-deploy.yml`), GitLab CI (`.gitlab-ci.yml`), Azure DevOps (`azure-pipelines.yml`), Jenkins (`Jenkinsfile`).
- The pipeline reaches the server with an API token of a system account (`sutra token create`), from the CI system's secret store; never in the file.
- Optional stage for teams running their own image: build on the official image, push to their registry, roll the Kubernetes Deployment.

## Phase 5: documentation and tests

- Admin guide: chapters *Containers and Kubernetes*, *Configuration as files* and *CI/CD pipelines*, plus the new commands in *The command line by task*. User guide, Deploy: pointers to them.
- Tests: export then apply gives the same server (round trip), each secret form, check reports without changing, apply all-or-nothing, the image starts and answers (where Docker is present), manifests pass `kubectl apply --dry-run=client` (where kubectl is present), CI files parse.
- Live checks: the image on Docker Desktop; the manifests on a local Kubernetes (kind or Docker Desktop's); one pipeline run end to end on GitHub.

## Questions settled

All six were answered on 3 and 4 November 2026: see *Decisions already made*.
