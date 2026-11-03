# 2.1.6 plan: containers, Kubernetes, configuration as files, CI/CD

Status: plan, not started (3 November 2026). Builds on 2.1.5.

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

## What exists today (2.1.5)

- `Dockerfile` (Node 24 slim, tini, health check, `/data` volume), `docker-compose.yml` (studio + engine), `docker-compose.cluster.yml`, `sutraflow docker [cluster] up|down|status|logs|build`.
- Project releases: `sutra package --zip` makes a release zip with a deployment config of connections, project variables and logging (`${env:NAME}` supported; secrets by vault name only); `sutra package --from-git` builds it in a pipeline with no server; `sutra check`, `sutra test`, `sutra deploy --config`.
- `.github/workflows/release.yml` builds the zips on Windows and Linux; no image.
- The backlog item *Build the real Docker image* (never built on the release machine) is done by Phase 1.
- Gaps found while planning: both compose files tag the image `sutraflow:1.0.0`; the image carries only the user guide (not the Admin and Design guides); server settings (gateway, firewall, trusted proxies, engines tuning, policies, knowledge admin, audit retention) can only be changed by hand or one command at a time.

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

- `sutra config export --server [--out file]` and `sutra config export --project <name> [--out file]`: what is set now; secrets exported as `${env:NAME}` placeholders, never as values.
- `sutra config check <file> [--env <file>]`: reports what would change, unresolved references and missing secrets, without changing anything (for pull requests).
- `sutra config apply <file> [--env <file>] [--yes]`: applies; audited per change; refuses a partial apply (all or nothing).
- `sutra deploy <release.zip> --config <file> --env <file>`: as today, plus the environment file.

Environment files (`env/test.yaml`, `env/prod.yaml`) hold only what differs: hosts, users, folders, secret values. Values may be:

| Form | Example | Use |
| --- | --- | --- |
| Written directly | `password: s3cret` | Small teams, files kept outside Git |
| Environment variable | `password: ${env:ERP_DB_PASSWORD}` | CI/CD secret variables |
| Mounted file | `password: file:/run/secrets/erp-db-password` | Kubernetes and Docker secrets |

Secret values from any form go into the target server's vault (encrypted with its master key) at apply time; the file is never stored on the server. Check and apply print only secret names. A file holding direct secret values gets a warning in `config check`, unless `--allow-plain-secrets` is given.

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

## Questions to settle before building

1. Server config scope: is anything to stay out of the export, for example users and their roles (kept in the identity provider), or system accounts?
2. Apply behaviour for things in the server but not in the file: leave them (safer), or remove them (the file is the whole truth)? A `--prune` option either way?
3. Image signing with cosign, or SBOM and provenance only?
4. Kubernetes: the studio in the cluster as well, or only engines (studio stays on a developer or build machine)?
5. Is the 2.1.6 version number right, or is this large enough to be 2.2?
6. This development machine has no Docker. Live image and Kubernetes checks need Docker Desktop (with its Kubernetes, or kind) installed here, or they run only on GitHub's Linux runners: which?
