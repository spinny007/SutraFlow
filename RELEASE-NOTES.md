# SutraFlow 2.0.9 release notes

Prepared 2026-10-24. Copyright (c) 2026-27 Surya Partap Singh, [MixAgile.com](https://mixagile.com). AGPL-3.0-only; a commercial licence is available.

## Fixes

| Fix | What changes for users |
| --- | --- |
| Output trees hid actual fields when the schema differed from the payload. | Every activity's shared Output view now derives fields and types from actual emitted data after a test. Before testing it shows the design schema only. A schema-only zone no longer conceals an actual scores field. |
| Repeating scalars displayed only their first item. | Small arrays show item count and values, such as `2 items: [2,5]`. Object-list previews identify first-item children; raw output remains available. |
| Designer reused previous run values. | Opening a flow no longer fetches historical outputs as samples. Only an explicitly started Test/Debug session supplies previews. Flow edits, schema reloads, flow switching and Clear test data clear those values; server run history is not deleted. |
| Sample lookup could return production output. | The explicit sample API selects only test/debug runs, never production runs. |
| Mapping sources were labelled previous step. | Sources show activity name and type, including named earlier activities. Other branches carry an availability warning; browsing does not synchronize parallel execution. |
| Stopping a test was hard to discover and left values visible. | Stop test is visible for active Test/Debug, including paused and waiting runs. It confirms terminal cancellation before clearing previews, keeps controls on failure and retains cancellation handles after edits. Completed tests have Clear test data. Previously committed external side effects are not rolled back. |

## Samples and documentation

- Added **Sample: Renamed fields to XML**: JSON `zone:[2,5]` maps to XML User/Score elements 2 and 5. Payload, imported source schema, mapping and serialized result are regression-checked.
- Existing typed JSON/XML examples remain available. Imported or customized schemas and flows are not overwritten.
- The user guide explains schema versus actual values, different source/target field names, test-session lifetime and parallel-branch availability.
- Both shared-schema editors provide read-only change impact analysis: directly affected saved activities, structural changes and newly broken source references. No mappings are silently rewritten. Deployed snapshots and transitive dependencies require separate review; runtime tests remain necessary.
- Generated HTML/Markdown process, project, CLI and package documentation includes activity name (type), named schema kind/root, named connection kind and explicit missing references, without exporting connection credentials.
- `npm run test:samples` gates the complete catalogue's schema references/starter contracts and executes the existing connection-free mapping/validation suites. It caught and corrected a Queue/topic trigger design-shape omission; external service samples keep separate certification gates.
- Installation and deployment examples are version-neutral, keeping engine releases distinct from application package versions.

## Verification scope

Fresh 2.0.9 regression: **414 passed, 0 failed, 26 skipped** (440 total). Server, web and test typechecks, build, generated documentation and browser smoke checks pass. Separate live runs passed 13 database checks, 24 local ActiveMQ/RabbitMQ checks, 24 strict mutual-TLS proxy checks, 9 Kafka SASL/TLS checks and 4 REST checks including Kafka subscribe/commit/close. The dependency audit reports zero known vulnerabilities.

Kafka native client-certificate testing passed all nine functional scenario assertions, but the full process timed out during teardown; a focused listener/lifecycle rerun passed and exited cleanly. This caveat is retained, not counted as a clean full-suite exit. These are scoped internal functional checks, not third-party protocol certification or a soak/throughput benchmark. See the [verification record](docs/releases/2.0.9-verification.md) for evidence and limitations. Packaging and installation verification are recorded separately; no Git commit/tag or publication is performed.

Windows/Linux release archives and checksums were generated. On 2026-10-24, the packaged runtime was deployed to 4800 and Laragon 4810; both report 2.0.9 and ready, with persisted project/configuration inventories verified unchanged and recoverable backups retained. Fresh dependency installations audited with zero known vulnerabilities.

Previous release: [2.0.8](docs/releases/2.0.8.md).
