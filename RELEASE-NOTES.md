# SutraFlow 2.0.7 release notes

Prepared 2026-10-24. Copyright (c) 2026-27 Surya Partap Singh, [MixAgile.com](https://mixagile.com). AGPL-3.0-only; a commercial licence is available, see `COMMERCIAL-LICENSE.md`.

## What is new

- **Map JSON Data and Map XML Data** share the established mapping evaluator. Both produce structured data; Render JSON/XML produces text. Generic Map data remains available for existing workflows.
- **Typed manual targets** include scalar/object types, required/repeating flags, item-count bounds, descriptions and XML object-element namespaces. XML exposes a root and @_attribute paths explicitly.
- **Input-tab schema tools** select/create/edit shared schemas without leaving mapping. Sample JSON/XML can generate a proposed schema; shared-schema edits show affected saved Sutras.
- **Safe target editing** supports double-click/pencil rename and confirmed subtree deletion while preserving other mappings, with designer undo/redo and normal persistence.
- **Validation and whole-result preview** catch invalid formulas, unmapped required targets and malformed XML targets; warn about stale mappings and uncertain source fields. Preview is project-authorized, bounded, read-only and labelled with its sample source.
- **Shared contract validation** applies JSON Schema (AJV) and XSD 1.0 (isolated libxml2 WebAssembly) to typed maps, parse/render, Validate fields, structured local/FTP/SFTP files and HTTP boundaries. REST/SOAP retain opt-in request rejection; SOAP checks operation namespaces. XML output and previews have a read-only tree view.
- **Opt-in strict file reads**: JSON/XML readers validate only when Strict schema validation is checked (default off) and a matching JSON Schema/XSD is selected. Otherwise the schema describes mapping fields without enforcing its constraints.
- **Executable described samples** include typed JSON and manual XML with attributes, namespace and repeated elements. Other relevant bundled mapping and parse/render samples carry shared schema contracts. Existing imported drafts are not rewritten on upgrade.
- **Ten validation examples** cover schema-backed XML mapping, JSON/XML pipelines, expected rejection branches, strict JSON/XML file reads, an HTTP client and REST/SOAP services. New regression tests execute the samples and check strict-read modes and no-run-on-invalid gateway boundaries.
- **Documentation** defines each new activity, configuration, output versus serialization, schema ownership and the limits of mapping checks. Functional verification is not full JSON Schema/XSD standards certification.

## Fixes

| What you would have seen | Cause | Now |
|---|---|---|
| Default orderId could not be renamed in Input. | Target labels had no editing action. | Manual targets support double-click/pencil rename without losing formulas or child definitions. |
| A manually added target could not be deleted cleanly. | No subtree editing operation existed. | Confirmed deletion removes the selected target, children and their rules/definitions; Undo restores them. |
| Schema allOf could hide properties declared beside it. | The shape builder returned only allOf branches. | Own and reusable object properties and required flags are combined. |
| Sample mapping targets looked inconsistent. | Samples relied on implicit rule-derived targets. | Relevant new imports include browsable shared schemas and explicit manual-target demonstrations. |
| A schema change left unused target formulas without an explanation. | Stale target paths were not checked. | Designer warnings and confirmed stale-rule cleanup identify and remove unused rules. |
| Selecting a schema described fields but did not enforce all constraints at related data boundaries. | Shape inference and instance validation were separate, inconsistently used paths. | Related structured activities share JSON Schema/XSD validation; outgoing invalid content is rejected before file writes or business HTTP requests. |

## Upgrade and verification

No database migration is required; mapping configuration is stored in workflow JSON. Install 2.0.7 on all engines before deploying workflows using its new activity identifiers. Existing published workflows retain their identifiers.

Exact results and limitations: [2.0.7 verification record](docs/benchmarks/release-2.0.7-verification.md). Packages and deployment must follow the passing verification gate. This source change does not publish an npm package, Git commit/tag or GitHub release.

Previous release: [2.0.6 notes](docs/releases/2.0.6.md).
