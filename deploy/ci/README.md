# SutraFlow CI/CD templates (2.1.7)

One pipeline in four dialects, for the repository that holds your project files (the studio's Git tab):

| File | Copy to | The approval |
| --- | --- | --- |
| `github-actions.yml` | `.github/workflows/sutraflow-deploy.yml` | The `production` environment's required reviewers |
| `gitlab-ci.yml` | `.gitlab-ci.yml` | A manual deploy job on a protected environment |
| `azure-pipelines.yml` | `azure-pipelines.yml` | The `sutraflow-prod` environment's approvals and checks |
| `Jenkinsfile` | `Jenkinsfile` | An `input` step where a person types the plan id |

Every template runs the same stages, in the SutraFlow image, so the `sutra` command matches the server's version:

1. **Build**: `sutra package --from-git . --version <tag> --out release.zip`
2. **Test**: `sutra test release.zip --secrets-from-env`, which runs every Sutra with its test data in a throw-away server.
3. **Check** against the target, changing nothing:
   - `sutra config check config/sutraflow.yaml --env config/env/prod.yaml`: what the config would create, and the checklist of what is already there;
   - `sutra check release.zip`: the plan (Sutras new, unchanged or replacing what is deployed, and those undeployed) and its **plan id**.
4. **Approve**: a person reads the plan and the checklist and approves.
5. **Deploy**:
   - `sutra config apply ... --yes` creates only what is missing, all or nothing;
   - `sutra deploy release.zip --approve <plan id>` replaces exactly what was approved. If someone changed the server after the approval, the id no longer matches: the deploy stops with exit code 3 and nothing changes.

## What the pipeline needs

- `SUTRA_SERVER`: the target engine's admin address.
- `SUTRA_TOKEN`: the token of a system account with Deploy on the projects, made with `sutra token create <account> <name>`. Never use the admin token. Add Users (for roles and system accounts in the config file) or Server settings only if the file sets those.
- Every `${env:NAME}` your environment file names, in the CI system's secret store. Secrets never go in the repository.

Suggested repository layout:

```
config/sutraflow.yaml      what every environment has (connections, properties, server settings)
config/env/test.yaml       only what differs in test: hosts, users, ${env:} secret names
config/env/prod.yaml       only what differs in production
```

Start from what a server has now: `sutra config export --server-settings --project "Orders" --out config/sutraflow.yaml --server <url>`. Secrets come out as `${env:SUTRA_<PROJECT>_<NAME>}` placeholders.
