/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 2.0.7
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { FlowDoc, FlowNode } from './engine/types.js';
import { listSchemas, saveSchema } from './schemas.js';
import { getProject, saveProject } from './projects.js';
import { setItemFolder } from './folders.js';

/** Executable, offline examples; importing never overwrites an edited shared contract. */
export function validationSamples(projectId: string, gateway: string): FlowDoc[] {
  const schemas = listSchemas(projectId);
  const contract = (name: string, kind: 'json' | 'xsd', text: string, root?: string) => {
    const previous = schemas.find(s => s.name === name && s.kind === kind);
    if (previous) return previous.id;
    const saved = saveSchema({ project_id: projectId, name, kind, text, root });
    setItemFolder('schemas', saved.id, 'Samples/Data and mapping'); schemas.push(saved);
    return saved.id;
  };
  const json = contract('Sample validation — Customer JSON', 'json', JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Customer contract', type: 'object', additionalProperties: false,
    required: ['id', 'email', 'amount', 'active', 'attempts', 'tags'],
    properties: {
      id: { type: 'string', pattern: '^A-[0-9]+$' }, email: { type: 'string', format: 'email' },
      amount: { type: 'number', minimum: 1, maximum: 100 }, active: { type: 'boolean' }, attempts: { type: 'integer', minimum: 0, maximum: 3 },
      tags: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { type: 'string', enum: ['retail', 'priority', 'export'] } },
    },
  }, null, 2));
  const xml = contract('Sample validation — Customer XML', 'xsd', `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:sutra:validation" xmlns:v="urn:sutra:validation" elementFormDefault="qualified">
  <xs:group name="Contact"><xs:choice><xs:element name="Email" type="xs:string"/><xs:element name="Phone" type="xs:string"/></xs:choice></xs:group>
  <xs:element name="User"><xs:complexType><xs:sequence>
    <xs:element name="Code"><xs:simpleType><xs:restriction base="xs:token"><xs:pattern value="[A-Z]{2}-[0-9]{2}"/></xs:restriction></xs:simpleType></xs:element>
    <xs:group ref="v:Contact" minOccurs="1" maxOccurs="2"/>
    <xs:element name="Amount"><xs:simpleType><xs:restriction base="xs:decimal"><xs:minInclusive value="1"/><xs:maxInclusive value="100"/></xs:restriction></xs:simpleType></xs:element>
    <xs:element name="Active" type="xs:boolean"/><xs:element name="Since" type="xs:date"/>
    <xs:element name="Age" minOccurs="0"><xs:simpleType><xs:restriction base="xs:integer"><xs:minInclusive value="18"/><xs:maxInclusive value="99"/></xs:restriction></xs:simpleType></xs:element>
  </xs:sequence><xs:attribute name="status" use="required"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="active"/><xs:enumeration value="inactive"/></xs:restriction></xs:simpleType></xs:attribute></xs:complexType></xs:element>
</xs:schema>`, 'User');
  const customer = { id: 'A-12', email: 'asha@example.com', amount: 12.5, active: true, attempts: 1, tags: ['retail', 'priority'] };
  const receipt = contract('Sample validation — Receipt XML mapping', 'xsd', '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="Receipt"><xs:complexType><xs:sequence><xs:element name="Id" type="xs:string"/><xs:element name="Amount"><xs:simpleType><xs:restriction base="xs:decimal"><xs:minInclusive value="1"/><xs:maxInclusive value="100"/></xs:restriction></xs:simpleType></xs:element></xs:sequence></xs:complexType></xs:element></xs:schema>', 'Receipt');
  const document = '<User xmlns="urn:sutra:validation" status="active"><Code>AB-12</Code><Email>asha@example.com</Email><Phone>555-0100</Phone><Amount>12.5</Amount><Active>true</Active><Since>2026-10-24</Since><Age>20</Age></User>';
  const p = getProject(projectId)!;
  if (!p.config.variables.some(v => v.name === 'VALIDATION_FOLDER')) saveProject({ ...p, config: { ...p.config, variables: [...p.config.variables, {
    name: 'VALIDATION_FOLDER', type: 'string', value: '${files}/validation-samples', description: 'Writable sample-only folder. Validation examples overwrite customer.json/customer.xml here; an administrator can change this per environment.',
  }] } });
  const n = (id: string, type: string, name: string, x: number, config: Record<string, any>, description: string, y = 180): FlowNode => ({ id, type, name, x, y, config, description });
  const edge = (from: string, to: string, port = 'out') => ({ id: `${from}-${port}-${to}`, from, to, port });
  const start = (payload: any, description: string) => n('s', 'start', 'Sample input', 40, { payload: JSON.stringify(payload) }, description);
  const reject = (name: string, schema: string, payload: any, source: string): FlowDoc => ({
    name, description: 'Expected rejection, not an infrastructure failure: Validate fields sends contract violations to invalid with problems/data. The log records them and the run completes normally. Edit the input to explore constraints.',
    nodes: [start(payload, 'Deliberately invalid input; this sample is expected to take the invalid branch.'),
      n('v', 'validate', 'Check contract', 350, { schema, required: [], source }, 'Schema-only validation. Invalid data is routed to invalid with a list of problems; valid passes the original value.'),
      n('bad', 'log', 'Expected rejection', 680, { level: 'info', message: 'Expected schema rejection: {{input.problems}}' }, 'Records the validation problems. This is the expected successful outcome of the rejection demonstration.'),
      n('unexpected', 'throw', 'Unexpected acceptance', 680, { message: 'Invalid sample unexpectedly passed its schema.' }, 'Fails visibly if deliberately invalid sample data is accepted.', 380)],
    edges: [edge('s', 'v'), edge('v', 'bad', 'invalid'), edge('v', 'unexpected', 'valid')],
  });
  const file = (format: 'JSON' | 'XML'): FlowDoc => {
    const isJson = format === 'JSON', schema = isJson ? json : xml;
    return { name: `Sample: Read ${format} file with schema validation`, description: `Writes a known valid ${format} fixture under project property VALIDATION_FOLDER, then reads it with Strict schema validation checked and the matching ${isJson ? 'JSON Schema' : 'XSD'}. Uncheck to use the schema for mapping only. Invalid reads take the red error output. Overwrites only customer.${isJson ? 'json' : 'xml'} in the sample folder.`,
      nodes: [start(isJson ? customer : { xml: document }, 'Known valid fixture; the write step creates this sample file without requiring a pre-existing file.'),
        n('w', 'fileWrite', 'Write sample fixture', 350, { folder: '{{gv.VALIDATION_FOLDER}}', path: isJson ? 'customer.json' : 'customer.xml', format: isJson ? 'JSON' : 'text', ...(isJson ? { data: '{{input}}', schema } : { content: '{{input.xml}}' }), encoding: 'utf-8', overwrite: true, append: false }, 'Creates the sample fixture in VALIDATION_FOLDER. XML is written as exact text to preserve its namespaces; the next read performs XSD validation.'),
        n('r', 'fileRead', 'Strict file read', 670, { folder: '{{gv.VALIDATION_FOLDER}}', path: isJson ? 'customer.json' : 'customer.xml', format, schema, strictValidation: true, encoding: 'utf-8', maxMb: 1 }, `Strict schema validation is checked. Valid ${format} is exposed under data; schema violations fail before downstream processing. Missing/wrong-kind schemas also fail.`),
        n('l', 'log', 'Validated file', 990, { level: 'info', message: 'Schema validation passed for {{input.name}}' }, 'Runs only after the strict file read has passed; inspect the preceding output data and XML tree.')],
      edges: [edge('s', 'w'), edge('w', 'r'), edge('r', 'l')] };
  };
  return [
    { name: 'Sample: XML schema-backed mapping', description: 'Map XML Data builds a Receipt against a selected XSD and validates decimal bounds before Render XML validates and serializes the same contract. See the separate XML pipeline for advanced groups, namespaces and facets.',
      nodes: [start(customer, 'Valid id and decimal amount for the Receipt mapping.'),
        n('m', 'mapperXml', 'Map and validate XML', 350, { schema: receipt, validateSchema: true, mapping: { rules: { 'Receipt/Id': { expr: '{input.id}' }, 'Receipt/Amount': { expr: '{input.amount}' } } } }, 'Selected XSD supplies required target elements. The finished Receipt must satisfy the decimal bounds before the out port is taken.'),
        n('r', 'renderXml', 'Render receipt XML', 670, { source: 'mapping', schema: receipt, validateSchema: true, mapping: { rules: { Receipt: { expr: '{input.Receipt}' } } }, declaration: true }, 'Copies the validated root, then validates the serialized XML against the same XSD.')], edges: [edge('s', 'm'), edge('m', 'r')] },
    { name: 'Sample: JSON schema validation pipeline', description: 'Valid JSON goes through Parse JSON, Map JSON Data, Validate fields and Render JSON with one shared contract. Demonstrates required fields, pattern, email format, numeric/integer bounds, booleans, enum lists, unique items and no additional properties.',
      nodes: [start({ text: JSON.stringify(customer) }, 'JSON text with every required field and valid constraint values.'),
        n('p', 'parseJson', 'Parse and validate JSON', 350, { text: '{{input.text}}', schema: json, validateSchema: true }, 'Parses text and checks the complete JSON Schema before exposing structured data.'),
        n('m', 'mapperJson', 'Map and validate JSON', 660, { schema: json, validateSchema: true, mapping: { rules: Object.fromEntries(Object.keys(customer).map(k => [k, { expr: `{input.${k}}` }])) } }, 'Maps every field to the shared target and validates the completed object; list and scalar types are preserved.'),
        n('v', 'validate', 'Check JSON contract', 970, { source: '{{input}}', schema: json, required: [] }, 'The valid port passes the object onward; invalid carries problems/data for a business rejection branch.'),
        n('r', 'renderJson', 'Render validated JSON', 1280, { source: 'value', value: '{{input}}', schema: json, validateSchema: true, pretty: true }, 'Validates value-mode content before JSON serialization; output.text is the wire representation.')], edges: [edge('s', 'p'), edge('p', 'm'), edge('m', 'v'), edge('v', 'r', 'valid')] },
    { name: 'Sample: XML schema validation pipeline', description: 'Parse XML and Render XML validate the original namespace-aware XSD 1.0 contract. Demonstrates a reusable repeating choice group, optional Age, required enum attribute, XSD pattern, decimal bounds, boolean and date types. Inspect Show XML tree on output.',
      nodes: [start({ xml: document }, 'Valid namespace-qualified XML with both allowed contact entries and optional Age.'),
        n('p', 'parseXml', 'Parse and validate XML', 350, { text: '{{input.xml}}', schema: xml, validateSchema: true }, 'Checks original XML before parsing removes element prefixes. XSD enforces namespace, sequence, group occurrences, facets and types.'),
        n('r', 'renderXml', 'Render validated XML', 670, { source: 'mapping', schema: xml, validateSchema: true, mapping: { rules: { User: { expr: '{input.User}' } } }, declaration: true }, 'Copies User and its status attribute. Parse XML normalizes namespace prefixes, so the schema-backed target restores the declared root namespace before validating serialization.'),
        n('v', 'validate', 'Check XML contract', 990, { source: '{{input.text}}', schema: xml, required: [] }, 'Validates the serialized XML text so namespace and ordering information is available. Invalid routes problems/data to the invalid port.')], edges: [edge('s', 'p'), edge('p', 'r'), edge('r', 'v')] },
    reject('Sample: JSON schema expected rejection', json, { ...customer, id: 'bad', email: 'not-an-email', amount: 101, tags: ['retail', 'retail'], extra: true }, '{{input}}'),
    reject('Sample: XML schema expected rejection', xml, { xml: document.replace('AB-12', 'bad').replace('>20<', '>17<') }, '{{input.xml}}'),
    file('JSON'), file('XML'),
    { name: 'Sample: Validated REST service', description: 'Deploy this sample before running the HTTP client example. POST /samples/validation/customer validates the JSON contract before a run starts and validates the reply before sending. Invalid input gets HTTP 400. No authentication: local demonstration only; select an API security policy before public deployment.',
      nodes: [n('s', 'restService', 'Validated customer API', 40, { method: 'POST', path: '/samples/validation/customer', bodySchema: json, validateBody: 'reject invalid', testRequest: JSON.stringify({ body: customer }) }, 'Gateway ingress validates before creating a run. Add an API security policy for any non-local deployment.'),
        n('r', 'httpResponse', 'Validated customer reply', 390, { status: '200', contentType: 'application/json', bodySource: 'template', body: '{{input.body}}', bodySchema: json }, 'Validates the reply against the shared JSON contract before sending it to the caller.')], edges: [edge('s', 'r')] },
    { name: 'Sample: Validated HTTP client', description: 'Deploy Sample: Validated REST service first. This client validates its outgoing JSON before transmission and validates the returned body before passing it onward. Change the URL if the gateway is on another host.',
      nodes: [start(customer, 'Known valid customer object, not text interpolation into a JSON string.'),
        n('h', 'httpRequest', 'Call validated customer API', 350, { method: 'POST', url: gateway + '/samples/validation/customer', bodyType: 'json', body: '{{input}}', bodySchema: json, responseSchema: json, parse: 'json', failOn: '4xx or 5xx' }, 'Both bodySchema and responseSchema are selected. Invalid outgoing data is rejected before the business HTTP request is sent; invalid responses fail this activity.')], edges: [edge('s', 'h')] },
    { name: 'Sample: Validated SOAP service', description: 'Deploy for a SOAP server example at /samples/validation/soap. The User operation must be in urn:sutra:validation, with qualified child elements and the required status attribute. Bad namespaces, ordering, types or facets get a SOAP Client fault before a run starts. No authentication: select a policy before public deployment.',
      nodes: [n('s', 'soapService', 'Validated XML operation', 40, { path: '/samples/validation/soap', serviceName: 'ValidationService', namespace: 'urn:sutra:validation', operations: 'User', soapVersion: '1.1', bodySchema: xml, validateBody: 'reject invalid', testRequest: JSON.stringify({ operation: 'User', body: { '@_xmlns': 'urn:sutra:validation', '@_status': 'active', Code: 'AB-12', Email: 'asha@example.com', Amount: 12.5, Active: true, Since: '2026-10-24' } }) }, 'Validates the namespace-preserved operation element, not a prefix-stripped approximation. Use the XML pipeline sample payload inside a SOAP Body.'),
        n('r', 'soapReply', 'Validation accepted', 390, { kind: 'response', body: '{"accepted":true}' }, 'Replies only after ingress validation passes. SOAP response envelope is generated by the gateway.')], edges: [edge('s', 'r', 'User')] },
  ];
}
