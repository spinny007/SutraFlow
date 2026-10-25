# Schema-boundary audit — 2.0.11

The schema-field inventory in `test/schema-contract-inventory.test.ts` is the exhaustive field list. This review classifies each use; it does not mistake a descriptor or CSV column hint for runtime validation. New schema fields require review and negative engine tests. Shared references are project-scoped at execution, including descriptive targets. Strict JSON checks do not coerce, drop fields or insert defaults. XSD is 1.0, project-local and network-disabled.

| Activity / schema fields | Role and enforcement |
| --- | --- |
| Manual start / schema | Payload contract; validateSchema On checks before run admission and at execution. Off is descriptive. |
| REST, SOAP, WebSocket starters / bodySchema | Body contract; reject-invalid mode applies to gateway and direct/Test/Debug admission. SOAP validates operation XML, not the transport envelope. |
| Generic Map / schema | Target shape for transformations. New validateSchema On validates the completed merged target. Field names may change; Off preserves legacy mapping behavior. |
| Map JSON/XML / schema | Typed target checks remain active independently; validateSchema additionally enforces the full selected target contract. |
| Parse JSON/XML, Render JSON/XML / schema | validateSchema On requires the appropriate JSON/XSD contract. Parse checks received data/XML; Render checks the completed value or exact rendered XML. Off is descriptive. |
| Validate fields / schema | Selected schema is actively evaluated; invalid data routes to invalid rather than successful valid output. |
| Call Sutra / inputSchema, resultSchema | Independent validateInput/validateResult checks, including resumed child results. Result validation requires waiting for the child. |
| Return, channel publish/trigger / schema | Explicit strict controls validate actual result/message, including engine-only and resumed paths. |
| HTTP request / bodySchema, responseSchema; HTTP response / bodySchema | A selected contract is enforced without a separate toggle, before outbound request/reply or before exposing a received response. Project-local enforcement now uses the shared contract boundary. |
| SOAP invoke / wsdlRef | WSDL is a service descriptor, not a substitute for an explicit strict message contract. |
| SOAP invoke / argsSchema, responseSchema | New validateRequest/validateResponse controls default Off. WSDL arguments use a JSON contract; raw requests and received operation XML may use XSD. Response checks run before out. SOAP faults are distinct from success contracts. |
| SOAP reply / bodySchema | New validateSchema On checks the completed body: JSON body value or the actual OperationResponse XML in the starter's service namespace. Fault replies are distinct. |
| Local/remote trigger, read and list / schema | CSV uses column names/types, not a JSON contract. strictValidation On enforces JSON/XML content and rejects incompatible formats/read failures; removed-file notifications do not claim to contain a document. |
| Local/remote write / schema | CSV schema is column order/type metadata; selected JSON/XSD validates completed content before writing. |
| MongoDB insert/list/find/update/delete/aggregate / schema | Explicit validateSchema control. Insert: every document before writes. List: metadata rows. Find: each returned document/value or count. Update: update/replacement request, not a guarantee about stored rows. Delete: filter request. Aggregate: result rows, not pipeline input or written collections. Empty results do not bypass contract-definition checks. |
| AI Guard / jsonSchema | Selecting JSON shape activates full JSON validation, not only required-name checks. Wrong types/ranges/extras route blocked. Missing/invalid/foreign contract fails closed; no silent pass. Input must be JSON, not prose containing an extracted fragment. |
| AI tool / inputSchema, outputSchema | Descriptors by default; full JSON Schema constraints are preserved in advertised tool definitions, and descriptor lookups are project-scoped. validateInput On checks arguments at admission and execution for every transport. validateOutput On checks successful replies/Return results before completion, including non-MCP reply activities. Explicit isError results are not success values. |
| Reply to AI / schema | validateSchema On independently checks completed result in value or mapping mode, including explicit error results. |

## Regression evidence and limits

Existing strict JSON/XSD, file, mapping, HTTP, gateway and process tests cover earlier boundaries. `test/release211.test.ts` adds negative engine tests for the previously incomplete generic Map, MCP input/result, AI Guard and SOAP request/response/reply boundaries, including no downstream successful reply and no HTTP request on invalid raw SOAP input.

Off remains deliberately descriptive where listed. Invalid schema configuration is not a valid payload. An input/result validator does not roll back an earlier external write, validate remote server state, make a bulk operation atomic or certify an untested connector/service. Transport error/fault contracts must be designed separately from successful result contracts.
