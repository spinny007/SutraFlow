# SutraFlow 2.0.7 functional verification

Verified on 2026-10-24 (Asia/Calcutta), Windows, against the uncommitted 2.0.7 working tree. This is an engineering regression record, not third-party certification, exhaustive W3C conformance, a throughput benchmark or a soak result.

## Gates

| Check | Result |
|---|---|
| Server, web and test TypeScript checks | Passed |
| Source copyright headers | Passed |
| Offline vendor integrity gate | Passed |
| npm audit | 0 vulnerabilities at verification time |
| New sample regression file | 5 passed, 0 failed |
| Full regression with local PostgreSQL and MySQL | 411 tests: 402 passed, 0 failed, 9 skipped; 301.364 seconds (including sample-import catalog correction) |

The full gate builds the runtime first and runs the normal suite with real PostgreSQL/MySQL integration enabled. PGlite is secondary compatibility coverage, not a substitute for those databases. Subsequent packaging and local deployment checks are recorded below. No commit/tag, hosted messaging retest or new long-duration soak is included.

An earlier full run caught missing entries in the legacy sample-folder migration catalogue. Those entries were corrected, the folder/sample-focused suites passed, and the full gate above was rerun successfully. PostgreSQL connection-reset messages during the deliberately injected outage tests are expected; recovery assertions passed.

The nine skips are seven optional installed/hosted broker and broker-REST checks (their explicit environment switches/credentials were not supplied to this run), the standalone password-protected PostgreSQL SSL/bin-folder fixture, and the Linux Docker image build. They are not counted as passing. The normal real PostgreSQL/MySQL integration checks did execute.

Full local transcript: `regression-2.0.7-import-refresh.log` in the Codex task workspace. SHA-256: `0913c98d3973ab4c38316bda55585ca7a05495228a5c1b992e6b040efde8b77b`.

## Bundled examples executed

Choose **New Sutra → Samples → JSON/XML schema validation and strict file reads**. Ten examples are supplied, in addition to the two typed/manual mapping examples:

| Example | Contract and expected result |
|---|---|
| XML schema-backed mapping | Map XML Data checks required Receipt elements and decimal bounds; Render XML checks serialization. |
| JSON schema validation pipeline | Parse JSON → Map JSON Data → Validate fields → Render JSON. Required fields, id pattern, email format, number/integer bounds, boolean, enum list, unique items, no extra properties. |
| XML schema validation pipeline | Parse original qualified XML, restore the schema namespace when rendering, then validate serialized text. Reusable repeating choice, optional Age, required enum attribute, pattern, decimal bounds, boolean and date. |
| JSON schema expected rejection | Deliberately invalid data takes invalid, logs problems and completes normally; unexpected acceptance throws. |
| XML schema expected rejection | Deliberately invalid XSD pattern/range is handled on invalid, not silently accepted. |
| Read JSON file with schema validation | Writes a fixture then performs an explicitly checked strict JSON file read. Parsed data is exposed only after the contract passes. |
| Read XML file with schema validation | Writes exact namespace-qualified XML then performs an explicitly checked strict XSD file read. |
| Validated REST service | Real local POST endpoint validates before run creation and checks the reply contract before sending. |
| Validated HTTP client | Real local HTTP call checks outgoing body and received response against the same contract. |
| Validated SOAP service | Real local SOAP 1.1 endpoint validates the namespace-preserved User operation and rejects bad requests with Client faults. |

All nine connection-free examples (including the two older typed/manual examples) are executed by the sample regression. The remaining three are exercised together using actual local REST/SOAP listeners and the HTTP client. Every example/node description and deployment validation is checked. Reimport must reuse schemas without overwriting an administrator's edit. Newly imported relevant Parse/Render/typed-map samples explicitly enable selected-schema validation; existing user drafts are not rewritten.

The file samples overwrite only `customer.json`/`customer.xml` in the administrator-editable `VALIDATION_FOLDER`, default `${files}/validation-samples`. Regression uses an isolated temporary folder. Do not point the examples at a production inbox. Demonstration services have no authentication; select an API security policy before exposing them publicly.

## Positive and negative regression coverage

`test/validation-samples.test.ts`:

- All sample flow/schema references and meaningful activity descriptions; catalogue contains the new mapping, parse/render, Validate fields, file, HTTP and service activities.
- Actual JSON/XML file reads: valid strict read; invalid strict read; unchecked read accepting schema-invalid but parseable data; checked read with no schema; checked read with wrong-kind schema. Both formats are exercised through the engine, not just helper functions.
- REST rejection of bad email, duplicate list items, numeric range and extra properties. The durable run counter proves no workflow starts for invalid ingress.
- SOAP rejection of incorrect namespace, bad pattern/range, invalid boolean and excessive repeating contact entries; valid qualified SOAP operation succeeds.
- Outgoing invalid HTTP data fails in the client activity and does not create a server run.
- JWT-protected REST and SOAP endpoints: missing credentials return 401, insufficient scopes return 403, and neither response exposes schema diagnostics. Authorized invalid callers receive REST 400 with field-level errors or a SOAP Client fault explaining the pattern/element failure. The durable run counter stays unchanged for all these requests.

`test/mapping207.test.ts`, `test/mapping-fields.test.ts` and the gateway validation suite also cover immutable typed rename/delete, required targets, formula/static checks, stale mappings, shared schema inference and read-only preview authorization/limits, manual runtime types/cardinality, JSON drafts 07/2019-09/2020-12, XSD optional fields/reusable groups/choice/enums/patterns/bounds, project-local includes, namespace-preserved SOAP, bounded concurrent XML validation, and rejection before HTTP replies/business requests or file writes.

Existing FTP/SFTP regressions use local protocol fixtures for authentication, path confinement, CSV write/read/list/copy/move/delete, file-trigger processing and streaming. They remain part of the full suite; the newly added sample certification specifically exercises strict file contracts on local files and the shared content validator, not every remote-server/version/TLS combination.

## Implementation limits and operational notes

- JSON Schema validation uses AJV and format checks. XML instance validation uses `xmllint-wasm` / libxml2 for XSD 1.0; XSD 1.1 is unsupported. The designer shape can approximate alternatives, wildcards and repeated groups even when runtime validation enforces the complete selected contract.
- Parse XML normalizes namespace prefixes. Do not assume a prefix-stripped parsed object preserves the original namespace bindings; validate original XML text or render with explicit/schema-backed namespace declarations before validating again.
- Strict file-read validation is **off by default** and requires `strictValidation === true`. Selecting a schema alone describes mapping fields. Basic parsing still occurs when strict validation is off. CSV typing/streaming is a separate unchanged feature.
- XML validation rejects DTD/entities and URL/host-filesystem schema dependencies. Dependencies must resolve to same-project XSD resources. Limits are 4 MB XML, 32 schema files/1 MB schema text, four active validators and 64 waiting, with a 32 MB WASM linear-memory ceiling per validator (excluding worker JavaScript overhead). Split large XML into records; these limits do not alter large CSV streaming.
- Ordinary activities fail through their error path; Validate fields returns invalid with problems/data; REST/SOAP reject before run creation. File triggers retain their existing readError payload contract, which workflows must handle explicitly.
- Dependency remediation retains Azure Identity 4.13.0 and overrides its MSAL UUID dependency to patched 11.1.1. The application build/typecheck/regression and audit gates are checked; no real Azure interactive login is certified here.

## Reproduce

Run with Node.js and the development dependencies installed:

```powershell
npm run typecheck
node tools/add-headers.mjs --check
npm run vendor:check
npm audit
node --import tsx --test test/validation-samples.test.ts
# Set SUTRA_TEST_PG_URL and SUTRA_TEST_MYSQL_URL to local test databases before:
npm test
npm run guide
npm run architecture
```

Do not place database credentials, tokens, private keys or live connector passwords in this record. Release packaging/deployment requires the completed passing gate and remains a separate step.

## Subsequent package and local deployment verification

After the passing gate, the Windows ZIP and Linux tarball were built with 212 runtime/guide files each; source tests, soak tools/reports and node_modules are excluded. Dependencies install from the supplied lockfile.

| Archive | SHA-256 |
|---|---|
| sutraflow-2.0.7-windows.zip | d0aef55483ca226d8eb40a1276eb93e13610f7087238725e9493d7de29ab6023 |
| sutraflow-2.0.7-linux.tar.gz | 686beaa2ce3a119200dee361e4a058f222dab3ea624089a9852090deaafd10b9 |

A clean Windows archive extraction installed production dependencies with Node 22.23.2, passed npm audit with zero findings, and accepted valid/rejected invalid XSD data using the packaged WASM validator. The Linux archive checksum and readable file manifest were checked; no Linux-host execution is claimed by this Windows deployment check.

Both existing local installations were gracefully drained and upgraded from that Windows archive:

- **4800, development checkout:** package runtime files installed; development package manifest/scripts retained with matching runtime dependencies. Full locked dependency installation and audit passed (zero findings). SQLite state/configuration backed up and preserved.
- **4810, Laragon:** package runtime manifest/files installed, then a clean production-only dependency installation and audit passed (zero findings). PostgreSQL custom-format backup completed; data location/configuration preserved.

Both report version 2.0.7 and readiness true. Designer, Admin Console, user guide and architecture routes returned HTTP 200. Authenticated catalog checks confirmed the new mappers, default-off strict file-read fields and validation sample set. Each installation's actual XSD dependency accepted valid/rejected invalid XML under Node 22.23.2; vendor resolution stays inside its installation. All shipped file hashes match the archive (except the intentionally retained development package.json on 4800), and environment/token/key hashes are unchanged.

Previous runtime/dependency directories, configuration snapshots and database backups are retained in the private local upgrade workspace `upgrade-2.0.7-260bdd28`. No user workflow/sample drafts were overwritten and no Git commit/push was made.

### Sample-import catalog correction

A reported missing-schema view was traced to Designer refreshing only its flow list after importing samples. The server had created schema records, but the browser's shared catalog was stale. `web/src/sample-import.ts` now waits for both flow and catalog reload before publishing the import result. Two additional regressions check completion ordering and failure propagation.

Browser verification used a new empty project in the isolated 4827 instance: import of the typed sample set immediately displayed three schemas, and Map JSON Data selected its target schema without a page reload. Evidence: `sample-import-schema-refresh.png` in the Codex workspace. No schema recovery/reimport or edits to the user's existing drafts were performed.

The corrected archives above supersede the initial 2.0.7 archives, which are retained privately under `import-refresh/previous-archives`. Package differences were applied to 4800 and 4810 after the passing full regression. Checks required byte-identical backend files and dependency manifests before the no-restart UI correction; both live web entry points then matched the corrected archive and readiness remained true. Existing pages must be refreshed once to load the new JavaScript; future sample imports refresh the catalog automatically.
