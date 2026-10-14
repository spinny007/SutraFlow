/** Value and path helpers shared by {{ }} templates and = expressions. */
export const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parsePath(path: string): string[] {
  const parts: string[] = [];
  const re = /\[\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(-?\d+))\s*\]|([^.[\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) {
    const seg = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (seg === undefined) continue;
    const t = m[4] !== undefined ? seg.trim() : seg;
    if (t !== '') parts.push(t);
  }
  return parts;
}

export function getPath(obj: any, path: string | string[]): any {
  const parts = Array.isArray(path) ? path : parsePath(path);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && /^-\d+$/.test(p)) cur = cur[cur.length + Number(p)];
    else cur = cur[p];
  }
  return cur;
}

export function setPath(obj: Record<string, any>, path: string, val: unknown) {
  const parts = parsePath(path);
  let cur: any = obj;
  parts.forEach((p, i) => {
    const last = i === parts.length - 1;
    if (last) { cur[p] = val; return; }
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = nextIsIndex ? [] : {};
    cur = cur[p];
  });
}

export const asText = (v: unknown): string =>
  v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

export function toNumber(x: unknown): number {
  if (typeof x === 'number') return x;
  if (x === '' || x == null || typeof x === 'object') return NaN;
  return Number(String(x).replace(/[,\s₹$€£]/g, ''));
}

