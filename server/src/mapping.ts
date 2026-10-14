import { evalExpression, truthy } from './expr.js';
import { toNumber } from './values.js';
import type { SNode } from './schemas.js';

/**
 * Structured mapping ("Activity Input"). A target tree comes from a shared
 * schema, or from the field paths the user adds ("customer/name", "lines[]/sku").
 * Each target path can carry:
 *   expr       formula producing the value (for objects/lists: copy the whole value)
 *   forEach    on a repeating node: one element per item of this list; inside, {item.x}
 *              is the current item, {index} its position (1-based), {outer} the enclosing item
 *   where      keep only items for which this is true (bare names are the item's fields)
 *   groupBy    one element per distinct key; {group.key}, {group.items}, {group.count};
 *              {item} is the first item of the group
 *   sortBy     order the items (or groups) by this value; sortDesc for descending
 *   ifCond     include the node only when true
 *   choose     [{when, expr}] first true branch wins, else otherwise
 */
export interface MapRule {
  expr?: string;
  forEach?: string;
  /** For-Each options: keep items where true; one element per group of equal keys; order by. */
  where?: string;
  groupBy?: string;
  sortBy?: string;
  sortDesc?: boolean;
  ifCond?: string;
  choose?: { when: string; expr: string }[];
  otherwise?: string;
}
export interface MappingValue {
  rules: Record<string, MapRule>;
  /** Target fields added by hand when there is no schema ("a/b", "lines[]/sku"). */
  fields?: string[];
}

export class MappingError extends Error {
  constructor(public path: string, message: string) { super(`${path || 'mapping'}: ${message}`); }
}

/** Tree for a mapping without a schema, from the paths of its fields and rules. */
export function adhocTree(m: MappingValue | undefined, name = 'root'): SNode {
  const root: SNode = { name, type: 'object', children: [] };
  const paths = new Set<string>([...(m?.fields || []), ...Object.keys(m?.rules || {})]);
  for (const p of paths) {
    let cur = root;
    p.split('/').filter(Boolean).forEach((rawSeg, i, all) => {
      const repeats = rawSeg.endsWith('[]');
      const seg = repeats ? rawSeg.slice(0, -2) : rawSeg;
      cur.children ||= [];
      let next = cur.children.find(c => c.name === seg);
      if (!next) { next = { name: seg, type: i === all.length - 1 ? 'any' : 'object' }; cur.children.push(next); }
      if (repeats) next.repeats = true;
      if (i < all.length - 1) { next.type = 'object'; next.children ||= []; }
      cur = next;
    });
  }
  return root;
}

/** Rule keys use plain names; ad-hoc fields may mark lists with []. */
export const normPath = (p: string) => p.split('/').filter(Boolean).map(s => s.replace(/\[\]$/, '')).join('/');

export function evaluateMapping(tree: SNode, m: MappingValue | undefined, scope: Record<string, any>): any {
  const rules: Record<string, MapRule> = {};
  for (const [k, v] of Object.entries(m?.rules || {})) rules[normPath(k)] = v;
  const ev = (path: string, src: string, sc: Record<string, any>, itemFields = false) => {
    try { return evalExpression(src, sc, itemFields); } catch (e: any) { throw new MappingError(path, e.message); }
  };

  const coerce = (node: SNode, v: any) => {
    if (v == null || typeof v === 'object') return v;
    if ((node.type === 'number' || node.type === 'integer') && typeof v === 'string' && v.trim() !== '' && isFinite(toNumber(v))) return toNumber(v);
    if (node.type === 'boolean' && typeof v === 'string') return truthy(v);
    if (node.type === 'string' && (typeof v === 'number' || typeof v === 'boolean')) return String(v);
    return v;
  };

  const single = (node: SNode, path: string, sc: Record<string, any>): any => {
    const r = rules[path];
    if (node.children?.length) {
      if (r?.expr && !r.forEach) return ev(path, r.expr, sc);
      const o: Record<string, any> = {};
      for (const c of node.children) {
        const v = build(c, path ? `${path}/${c.name}` : c.name, sc);
        if (v !== undefined) o[c.name] = v;
      }
      return Object.keys(o).length ? o : undefined;
    }
    if (r?.choose?.length) {
      for (const b of r.choose) if (truthy(ev(path, b.when, sc))) return coerce(node, ev(path, b.expr, sc));
      return r.otherwise ? coerce(node, ev(path, r.otherwise, sc)) : undefined;
    }
    return r?.expr ? coerce(node, ev(path, r.expr, sc)) : undefined;
  };

  const build = (node: SNode, path: string, sc: Record<string, any>): any => {
    const r = rules[path];
    if (r?.ifCond && !truthy(ev(path, r.ifCond, sc))) return undefined;
    if (node.repeats) {
      if (r?.forEach) {
        const v = ev(path, r.forEach, sc);
        let items = v == null ? [] : Array.isArray(v) ? v : [v];
        const each = (item: any, i: number, n: number, extra: Record<string, any> = {}) => ({ ...sc, outer: sc.item, item, index: i + 1, __size: n, ...extra });
        if (r.where) items = items.filter((item, i) => truthy(ev(path, r.where!, each(item, i, items.length), true)));
        let units: { item: any; group?: { key: any; items: any[]; count: number } }[] = items.map(item => ({ item }));
        if (r.groupBy) {
          const m = new Map<string, { key: any; items: any[] }>();
          items.forEach((item, i) => {
            const key = ev(path, r.groupBy!, each(item, i, items.length), true);
            const k = typeof key === 'object' ? JSON.stringify(key) : String(key);
            (m.get(k) || m.set(k, { key, items: [] }).get(k)!).items.push(item);
          });
          units = [...m.values()].map(g => ({ item: g.items[0], group: { ...g, count: g.items.length } }));
        }
        if (r.sortBy) {
          const keyed = units.map((u, i) => ({ u, k: ev(path, r.sortBy!, each(u.item, i, units.length, u.group ? { group: u.group } : {}), true) }));
          keyed.sort((a, b) => {
            const x = toNumber(a.k), y = toNumber(b.k);
            const c = isFinite(x) && isFinite(y) ? x - y : String(a.k ?? '').localeCompare(String(b.k ?? ''));
            return r.sortDesc ? -c : c;
          });
          units = keyed.map(k => k.u);
        }
        return units.map((u, i) => single(node, path, each(u.item, i, units.length, u.group ? { group: u.group } : {}))).filter(x => x !== undefined);
      }
      if (r?.expr) {
        const v = ev(path, r.expr, sc);
        return v == null ? undefined : (Array.isArray(v) ? v : [v]).map(x => coerce(node, x));
      }
      const one = single(node, path, sc);
      return one === undefined ? undefined : [one];
    }
    return single(node, path, sc);
  };

  return single(tree, '', scope) ?? {};
}

/** Required target fields with no mapping, inside parts of the tree that are mapped (shown as warnings). */
export function unmappedRequired(tree: SNode, m: MappingValue | undefined): string[] {
  const keys = Object.keys(m?.rules || {}).map(normPath);
  const touched = (p: string) => !p || keys.some(k => k === p || k.startsWith(p + '/'));
  const out: string[] = [];
  const walk = (n: SNode, p: string, parent: string) => {
    if (m?.rules?.[p]?.expr && n.children?.length) return; // copied as a whole
    if (n.children?.length) {
      for (const c of n.children) walk(c, p ? `${p}/${c.name}` : c.name, p);
      return;
    }
    if (n.required && p && !keys.includes(p) && touched(parent)) out.push(p);
  };
  walk(tree, '', '');
  return out;
}
