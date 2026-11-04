# Deploying SutraFlow

| Folder | What it holds |
| --- | --- |
| `docker/` | Compose files for one server or a cluster, run from the published image, plus `env.example` and `Dockerfile.package` (`sutraflow image build` from a release package, offline) |
| `kubernetes/` | Kustomize base, test and prod overlays, an optional studio, and the Job that applies config and deploys an approved release |
| `ci/` | Release pipelines for GitHub Actions, GitLab CI, Azure DevOps and Jenkins: build → test → check → a person approves the plan → deploy |
| `laragon/` | Running behind Apache on Laragon (Windows) |

`.sutra` packages put directly in this folder are deployed on start by the engine in the source folder's `docker-compose.yml`, which mounts it as `/deploy`.
