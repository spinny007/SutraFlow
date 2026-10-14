import { XMLBuilder } from 'fast-xml-parser';
import type { Field } from '../engine/types.js';
import { xmlParser } from '../security/outbound.js';
import { toNumber } from '../values.js';
import type { SNode } from '../schemas.js';
import { F, isObj } from './common.js';

/**
 * File content: encodings and formats shared by the file activities and triggers.
 * Structured formats give repeating rows (CSV, lines) or data (JSON, XML); a shared
 * schema names and types the CSV columns, and describes the rows for mapping.
 */
export const ENCODINGS = ['utf-8', 'utf-8 with BOM', 'utf-16le', 'iso-8859-1', 'windows-1252', 'ascii', 'shift_jis', 'gb18030', 'big5', 'euc-kr'];
const WRITE_ENCODINGS = ['utf-8', 'utf-8 with BOM', 'utf-16le', 'iso-8859-1', 'ascii'];
export const READ_FORMATS = ['text', 'CSV rows', 'lines', 'JSON', 'XML', 'base64 (binary)'];
export const WRITE_FORMATS = ['text', 'CSV from rows', 'lines from rows', 'JSON', 'XML', 'base64 (binary)'];

const sw = (k: string, ...v: string[]) => ({ showIf: { k, in: v } });

/** Fields for reading content. prefix lets a trigger offer "do not read" first. */
export function readFields(opts: { allowNone?: boolean; formatKey?: string } = {}): Field[] {
  const fk = opts.formatKey || 'format';
  const formats = opts.allowNone ? ['do not read', ...READ_FORMATS] : READ_FORMATS;
  const content = formats.filter(f => f !== 'do not read' && f !== 'base64 (binary)');
  return [
    F(fk, 'Read content as', 'select', opts.allowNone ? 'do not read' : 'text', { options: formats, help: 'CSV rows and lines give a repeating list to map; JSON and XML give data.' }),
    F('encoding', 'File encoding', 'select', 'utf-8', { options: ENCODINGS, ...sw(fk, ...content) }),
    F('delimiter', 'Column separator', 'select', ',', { options: [',', ';', '|', 'tab'], ...sw(fk, 'CSV rows') }),
    F('header', 'First row has column names', 'bool', true, sw(fk, 'CSV rows')),
    F('skipRows', 'Skip rows at the start', 'number', 0, sw(fk, 'CSV rows', 'lines')),
    F('trimValues', 'Trim spaces around values', 'bool', true, sw(fk, 'CSV rows')),
    F('decimal', 'Decimal separator', 'select', '.', { options: ['.', ','], help: 'Use , for European files such as 12,5.', ...sw(fk, 'CSV rows') }),
    F('schema', 'Row / data schema', 'schema', '', { help: 'Optional. CSV: column names and types (without a header row, columns are taken in schema order). JSON/XML: describes the data for mapping.', ...sw(fk, 'CSV rows', 'JSON', 'XML') }),
  ];
}

export function writeFormatFields(): Field[] {
  return [
    F('format', 'Write content as', 'select', 'text', { options: WRITE_FORMATS }),
    F('content', 'Content', 'textarea', '{{input.text}}', { tpl: true, ...sw('format', 'text', 'base64 (binary)') }),
    F('rows', 'Rows', 'text', '{{input.rows}}', { tpl: true, ...sw('format', 'CSV from rows', 'lines from rows'), help: 'A list of objects (CSV columns = their fields) or of text lines.' }),
    F('data', 'Data', 'text', '{{input}}', { tpl: true, ...sw('format', 'JSON', 'XML') }),
    F('xmlRoot', 'Root element', 'text', 'root', sw('format', 'XML')),
    F('delimiter', 'Column separator', 'select', ',', { options: [',', ';', '|', 'tab'], ...sw('format', 'CSV from rows') }),
    F('header', 'Write a header row', 'bool', true, sw('format', 'CSV from rows')),
    F('schema', 'Row schema', 'schema', '', { help: 'Optional: column order and names for CSV.', ...sw('format', 'CSV from rows') }),
    F('encoding', 'File encoding', 'select', 'utf-8', { options: WRITE_ENCODINGS, ...sw('format', 'text', 'CSV from rows', 'lines from rows', 'JSON', 'XML') }),
    F('lineEnding', 'Line ending', 'select', 'LF', { options: ['LF', 'CRLF'], ...sw('format', 'CSV from rows', 'lines from rows') }),
  ];
}

// ---------- decoding / encoding ----------
export function decode(buf: Buffer, encoding = 'utf-8'): string {
  const e = encoding.toLowerCase();
  if (e === 'utf-8' || e === 'utf8' || e === 'utf-8 with bom') return buf.toString('utf8').replace(/^﻿/, '');
  if (e === 'utf-16le') return buf.toString('utf16le').replace(/^﻿/, '');
  if (e === 'iso-8859-1' || e === 'latin1') return buf.toString('latin1');
  if (e === 'ascii') return buf.toString('ascii');
  try { return new TextDecoder(e).decode(buf); } catch { throw new Error(`Encoding "${encoding}" is not supported`); }
}
export function encode(text: string, encoding = 'utf-8'): Buffer {
  const e = encoding.toLowerCase();
  if (e === 'utf-8' || e === 'utf8') return Buffer.from(text, 'utf8');
  if (e === 'utf-8 with bom') return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  if (e === 'utf-16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  if (e === 'iso-8859-1' || e === 'latin1') return Buffer.from(text, 'latin1');
  if (e === 'ascii') return Buffer.from(text, 'ascii');
  throw new Error(`Writing in "${encoding}" is not supported; use UTF-8, UTF-16LE, ISO-8859-1 or ASCII`);
}

// ---------- CSV ----------
export function parseCsvRows(text: string, d: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], f = '', q = false, quotedField = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
      continue;
    }
    if (ch === '"' && f === '' && !quotedField) { q = true; quotedField = true; continue; }
    if (ch === d) { row.push(f); f = ''; quotedField = false; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = ''; quotedField = false;
      continue;
    }
    f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

/** Column definitions from a schema: a repeating node's children, or the root's children. */
export function columnsOf(tree: SNode | null): SNode[] | null {
  if (!tree) return null;
  const rep = tree.repeats ? tree : tree.children?.find(c => c.repeats);
  const cols = (rep || tree).children?.filter(c => !c.children?.length);
  return cols?.length ? cols : null;
}

const autoType = (v: string) => { const t = v.trim(); return t !== '' && /^-?\d*\.?\d+$/.test(t) && !/^0\d/.test(t) ? Number(t) : t === 'true' ? true : t === 'false' ? false : v; };
function typed(v: string, type: string | undefined, decimal = '.') {
  if (v === '') return type && type !== 'string' ? null : '';
  switch (type) {
    case 'integer': case 'number': {
      const norm = decimal === ',' ? v.replace(/[.\s]/g, '').replace(',', '.') : v;
      const n = toNumber(norm);
      if (!isFinite(n)) throw new Error(`"${v}" is not a number`);
      return type === 'integer' ? Math.trunc(n) : n;
    }
    case 'boolean': return ['true', '1', 'yes', 'y'].includes(v.trim().toLowerCase());
    case 'string': case 'date': return v;
    default: return autoType(v);
  }
}

export function csvToRows(text: string, o: { delimiter?: string; header?: boolean; skipRows?: number; trim?: boolean; schema?: SNode | null; decimal?: string }) {
  const d = o.delimiter === 'tab' ? '\t' : o.delimiter || ',';
  let raw = parseCsvRows(text, d).slice(Math.max(0, Number(o.skipRows) || 0));
  const cols = columnsOf(o.schema ?? null);
  let names: string[];
  if (o.header !== false && raw.length) { names = raw[0].map(h => h.trim()); raw = raw.slice(1); }
  else names = cols ? cols.map(c => c.name) : (raw[0] || []).map((_, i) => `col${i + 1}`);
  const types = new Map(cols?.map(c => [c.name, c.type]));
  return raw.map((r, ri) => Object.fromEntries(names.map((n, i) => {
    let v = r[i] ?? '';
    if (o.trim !== false) v = v.trim();
    try { return [n, cols ? typed(v, types.get(n), o.decimal) : o.decimal === ',' && /^-?\d+,\d+$/.test(v) ? Number(v.replace(',', '.')) : autoType(v)]; } catch (e: any) { throw new Error(`Row ${ri + 1}, column ${n}: ${e.message}`); }
  })));
}

export function rowsToCsv(rows: any[], o: { delimiter?: string; header?: boolean; schema?: SNode | null; eol?: string }) {
  const d = o.delimiter === 'tab' ? '\t' : o.delimiter || ',';
  const eol = o.eol || '\n';
  const cols = columnsOf(o.schema ?? null)?.map(c => c.name) || [...new Set(rows.flatMap(r => (isObj(r) ? Object.keys(r) : ['value'])))];
  const cell = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(d) || /["\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = rows.map(r => cols.map(c => cell(isObj(r) ? r[c] : r)).join(d));
  return (o.header === false ? lines : [cols.map(cell).join(d), ...lines]).join(eol);
}

// ---------- read / write ----------
export function parseContent(buf: Buffer, cfg: Record<string, any>, schema: SNode | null, formatKey = 'format') {
  const fmt = cfg[formatKey] || 'text';
  const encoding = cfg.encoding || 'utf-8';
  if (fmt === 'do not read') return {};
  if (fmt === 'base64 (binary)') return { content: buf.toString('base64'), encoding: 'base64' };
  // Older steps: readContent 'text' / 'base64'.
  const text = decode(buf, encoding);
  if (fmt === 'text') return { content: text, encoding };
  if (fmt === 'lines') {
    const rows = text.split(/\r?\n/).slice(Math.max(0, Number(cfg.skipRows) || 0)).filter((l, i, a) => l !== '' || i < a.length - 1).map((line, i) => ({ number: i + 1, line }));
    return { rows, count: rows.length, encoding };
  }
  if (fmt === 'CSV rows') {
    const rows = csvToRows(text, { delimiter: cfg.delimiter, header: cfg.header !== false, skipRows: cfg.skipRows, trim: cfg.trimValues !== false, schema, decimal: cfg.decimal });
    return { rows, count: rows.length, encoding };
  }
  if (fmt === 'JSON') {
    try { return { data: JSON.parse(text.replace(/^﻿/, '')), encoding }; } catch (e: any) { throw new Error(`The file is not valid JSON: ${e.message}`); }
  }
  if (fmt === 'XML') {
    if (!text.trim().startsWith('<')) throw new Error('The file is not XML');
    return { data: xmlParser.parse(text), encoding };
  }
  throw new Error(`Unknown format ${fmt}`);
}

/** Output shape of read content, for mapping before a run. */
export function contentShape(cfg: Record<string, any>, schema: SNode | null, formatKey = 'format'): SNode[] {
  const fmt = cfg[formatKey] || 'text';
  if (fmt === 'do not read') return [];
  if (fmt === 'CSV rows') {
    const cols = columnsOf(schema);
    return [{ name: 'rows', type: 'object', repeats: true, children: cols ? cols.map(c => ({ name: c.name, type: c.type })) : [{ name: '(columns)', type: 'any' }] }, { name: 'count', type: 'integer' }, { name: 'encoding', type: 'string' }];
  }
  if (fmt === 'lines') return [{ name: 'rows', type: 'object', repeats: true, children: [{ name: 'number', type: 'integer' }, { name: 'line', type: 'string' }] }, { name: 'count', type: 'integer' }];
  if (fmt === 'JSON' || fmt === 'XML') return [schema ? { ...schema, name: 'data' } : { name: 'data', type: 'any' }, { name: 'encoding', type: 'string' }];
  return [{ name: 'content', type: 'string' }, { name: 'encoding', type: 'string' }];
}

const xmlOut = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true, suppressEmptyNode: true });
export function buildContent(c: { raw(k: string): any; v(k: string): any }, schema: SNode | null): Buffer {
  const fmt = c.raw('format') || 'text';
  const enc = c.raw('encoding') || 'utf-8';
  const eol = c.raw('lineEnding') === 'CRLF' ? '\r\n' : '\n';
  if (fmt === 'base64 (binary)') return Buffer.from(String(c.v('content') ?? ''), 'base64');
  if (fmt === 'text') { const v = c.v('content'); return encode(typeof v === 'string' ? v : JSON.stringify(v, null, 2), enc); }
  if (fmt === 'JSON') return encode(JSON.stringify(c.v('data'), null, 2), enc);
  if (fmt === 'XML') {
    const d = c.v('data');
    const doc = isObj(d) && Object.keys(d).length === 1 && !c.raw('xmlRoot') ? d : { [c.raw('xmlRoot') || 'root']: d };
    return encode('<?xml version="1.0" encoding="' + (enc.startsWith('utf-8') ? 'UTF-8' : enc.toUpperCase()) + '"?>\n' + xmlOut.build(doc), enc);
  }
  const rows = c.v('rows');
  if (!Array.isArray(rows)) throw new Error('Rows must be a list. Map a repeating field such as {{input.rows}}.');
  if (fmt === 'lines from rows') return encode(rows.map(r => (isObj(r) ? String(r.line ?? JSON.stringify(r)) : String(r ?? ''))).join(eol), enc);
  return encode(rowsToCsv(rows, { delimiter: c.raw('delimiter'), header: c.raw('header') !== false, schema, eol }), enc);
}
