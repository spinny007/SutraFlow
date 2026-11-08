# SutraFlow on Kubernetes (2.1.8)

Plain manifests with Kustomize (built into `kubectl`). A Helm chart is planned.

| Folder | What it holds |
| --- | --- |
| `base/` | Engines (a Deployment: readiness on `/ready`, liveness on `/health`, 60 seconds to drain, non-root), their Service, a PodDisruptionBudget, a NetworkPolicy (gateway ports open; the admin API only from pods labelled `sutraflow-admin: "true"`), and the ConfigMap |
| `components/studio/` | The studio, optional; usually only in test. It shares the database and runs no steps |
| `overlays/test/` | Namespace `sutraflow-test`: one engine plus the studio |
| `overlays/prod/` | Namespace `sutraflow-prod`: three engines, an autoscaler (2 to 10), and an Ingress for the gateway |
| `jobs/config-and-deploy.yaml` | The Job a pipeline runs after approval: `sutra config apply`, then `sutra deploy --approve <plan id>` |

## Before the first apply

1. **A PostgreSQL database.** Engines in a cluster share one, either managed or run by an operator. SQLite only works for a single pod with a persistent volume.
2. **The Secret `sutraflow`**: the admin token, the master key (back it up: the vault cannot be read without it) and the database address:
   ```bash
   kubectl create namespace sutraflow-test
   kubectl -n sutraflow-test create secret generic sutraflow \
     --from-literal=SUTRA_ADMIN_TOKEN=$(openssl rand -hex 24) \
     --from-literal=SUTRA_MASTER_KEY=$(openssl rand -base64 32) \
     --from-literal=SUTRA_DB=postgres://sutra:password@db.example.internal:5432/sutra
   ```
3. **The image.** Set the tag in the overlay's `images:`. For a private registry, add a pull secret (commented out in `overlays/prod`).

```bash
kubectl apply -k deploy/kubernetes/overlays/test
kubectl -n sutraflow-test port-forward svc/sutraflow-studio 4800:4800    # the studio
```

## Configuration and releases

Server settings (gateway options, firewall, trusted proxies, roles, system accounts, alerts) and project connections come from a config file, applied with `sutra config apply`. Apply only creates what is missing; anything already there is listed in a checklist for a person to verify.

A release replaces Sutras only after a person approves its plan:

1. The pipeline runs `sutra check release.zip --server ...`, which prints the plan and its id.
2. A person approves it at the manual approval gate.
3. The Job runs with `PLAN_ID` set to that id.

If someone changed the server in between, the id no longer matches and the Job fails without changing anything.

In the Job, a config file can read secrets two ways:
- `${env:NAME}`, from the Secret `sutraflow-env-secrets`;
- `file:/run/secrets/<name>`, from the Secret `sutraflow-secret-files`.

## Project files

Logs and work files are in each pod's `/data` (an emptyDir). If Sutras read or write project files (`${files}`) that every engine must see, mount a ReadWriteMany volume (NFS, Azure Files, EFS) at `/data/files` in `base/engine.yaml`.

## Behind the Ingress

The ingress controller ends TLS and forwards to port 8080. For callers' addresses to be read from `X-Forwarded-For` (firewall, request log), add the controller's address range to `server.gateway.trustedProxies` in the config file.

## The Admin Console and the sutra command

Every engine serves the Admin Console and shows the whole cluster; the leader is not special for it. From your machine:

```bash
kubectl -n sutraflow-prod port-forward svc/sutraflow-engine 4800:4800    # then http://localhost:4800/admin
kubectl -n sutraflow-prod exec deploy/sutraflow-engine -- sutra status    # sutra inside a pod uses that pod's engine and token
```

For a permanent internal address, add an internal Ingress to the `sutraflow-engine` Service's admin port and allow the ingress controller's namespace to reach port 4800 in `base/network.yaml`.

## Upgrading SutraFlow

Engines of different versions must not share a database, so a version upgrade is not a rolling update:

1. Back up the database and keep the master key.
2. `kubectl -n sutraflow-prod scale deploy/sutraflow-engine --replicas=0` (and `deploy/sutraflow-studio`, if used).
3. Set the new `newTag` in the overlay's `kustomization.yaml`.
4. `kubectl apply -k deploy/kubernetes/overlays/prod`. The first engine makes the database changes; the others wait.

Restarts with the same version (`kubectl rollout restart`, changed settings) are rolling and lose nothing.

## Where the database is

Keep PostgreSQL in the engines' region: a round trip of about 2 ms or less. Measured with this image: 0.4 ms gave 120 simultaneous calls answered in 3.9 s; 75 ms (a database over the internet) gave 3 to 8 s per call.
