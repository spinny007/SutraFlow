# SutraFlow 2.0.8 local package deployment

24 October 2026, following the user's explicit request to build release packages and update port 4800 and Laragon port 4810. This is a local candidate deployment, not a Git tag, public release or replacement for the deferred release gates.

## Archives

Both standard online-install archives contain 213 identical runtime/guide files. Node modules, source trees, tests, benchmark reports, test databases and credentials are excluded. Linux launcher/shell executable modes are correct. SHA-256 sidecars verify; every file matches across the Windows and Linux archives.

| Artifact | SHA-256 |
|---|---|
| sutraflow-2.0.8-windows.zip | 76aefc0ac341c0b61961cba32a4bae2bb739f32b7ef57af2dbcd3676f45806b1 |
| sutraflow-2.0.8-linux.tar.gz | 71054d154273d48eda2350b246547578610365dca7b00173a8b4f6b755673c58 |

The Windows archive was extracted into a new stage, installed with `npm ci --omit=dev` (332 packages), and started against an isolated temporary database. Designer, Admin, Approvals, guide, architecture, four REST samples, schema-backed JSON/XML sample import and a deployed REST version reply passed. Linux archive parity/permissions are verified, but a native Linux runtime/Docker build was not run on this Windows host.

## Local installations

| Endpoint | Runtime / database | Result |
|---|---|---|
| 4800 | Source checkout runtime / SQLite | 2.0.8, ready; fresh locked full dependency install retains development scripts/tools |
| 4810 | Laragon / PostgreSQL | 2.0.8, ready; production dependencies installed from the validated Windows stage |

Both previous processes were absent at preflight. Persisted-state snapshots were therefore read directly without changing the databases before backup/replacement. This does not establish why those processes had exited. The new processes start through the existing hidden/background launchers. Previously stopped engine roles at 4801/4811 remain stopped.

Before/after hashes match for projects, workflows, deployments, schemas, resources, vault entries, settings, users and `sutraflow.env`. Port 4800 retains 4 projects, 53 flows and 4 deployments; Laragon retains 3 projects, 2 flows and no deployments. No new business workflow was created in either installation by deployment checks.

Backups are retained under the Codex task workspace's `upgrade-2.0.8-20261024/source` and `.../laragon`: configuration, data and replaced runtime/dependency files. The Laragon PostgreSQL custom-format dump is present and passes `pg_restore --list`. These private backups and the user-requested ignored database test settings are not part of the release archives. No database restore was performed.

All 213 Laragon runtime/guide files match the Windows archive. Port 4800 uses the same packaged runtime files while retaining its source `package.json` with development scripts/dependencies. The production dependency tree is self-contained, without links back to staging. Current user guide/architecture pages are served on both ports and their internal anchors verify.

## Post-install checks

- Both `/health` endpoints report version 2.0.8 and `/ready` is true.
- Native publish/receive metadata exposes XML alongside JSON/text/map/bytes on both installations.
- Source server/web/test typechecks pass after dependency reinstall.
- Strict-contract regression rerun: 6 passed, 0 failed.
- Laragon production dependency audit: 0 vulnerabilities.
- Saved remote database credentials are checked against archive entries and are absent.

The previous 447-test regression and 66 native messaging plus four REST scenario results remain in [the certification record](release-2.0.8-verification.md). No Git commit, push, tag, GitHub release, new soak, Linux Docker certification or public ACME staging certification was performed.
