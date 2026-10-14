import type { DragEvent } from 'react';
import { REF_MIME } from './Fields';

export interface TreeRoot { label: string; path: string; value: unknown; note?: string }

const seg = (k: string) => (/^[^.[\]{}|"'\s][^.[\]{}|"']*$/.test(k) && !/\s$/.test(k) ? '.' + k : `["${k.replace(/"/g, '\\"')}"]`);

function preview(v: unknown) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `list(${v.length})`;
  if (typeof v === 'object') return '{…}';
  const s = typeof v === 'string' ? JSON.stringify(v) : String(v);
  return s.length > 38 ? s.slice(0, 38) + '…' : s;
}

/**
 * The mapper's source side: data available to the selected step (trigger, earlier
 * steps, variables), from the last test run or from each step's output shape.
 * Drag any field onto an input, or click it to insert at the cursor.
 */
export function DataTree({ roots, onPick }: { roots: TreeRoot[]; onPick(ref: string): void }) {
  const drag = (path: string) => (e: DragEvent) => {
    e.dataTransfer.setData(REF_MIME, `{{${path}}}`);
    e.dataTransfer.setData('text/plain', `{{${path}}}`);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const Node = ({ k, path, v, depth }: { k: string; path: string; v: unknown; depth: number }) => {
    const label = <span className="k" draggable onDragStart={drag(path)} onClick={e => { e.preventDefault(); onPick(`{{${path}}}`); }} title={`{{${path}}}`}>{k}</span>;
    if (v && typeof v === 'object' && depth < 8) {
      const entries: [string, unknown, string][] = Array.isArray(v)
        ? v.slice(0, 1).map((x, i) => [`[${i}]`, x, `${path}[${i}]`])
        : Object.entries(v).slice(0, 200).map(([ck, cv]) => [ck, cv, path + seg(ck)]);
      return (
        <li>
          <details open={depth < 2}>
            <summary>{label}<span className="val">{preview(v)}</span></summary>
            <ul>{entries.map(([ck, cv, cp]) => <Node key={cp} k={ck} path={cp} v={cv} depth={depth + 1} />)}</ul>
          </details>
        </li>
      );
    }
    return <li><span className="leaf" draggable onDragStart={drag(path)} onClick={() => onPick(`{{${path}}}`)} title={`{{${path}}}`}>{k}</span><span className="val">{preview(v)}</span></li>;
  };
  return (
    <div className="tree" aria-label="Available data">
      <ul style={{ paddingLeft: 0 }}>
        {roots.map(r => <Node key={r.path} k={r.label} path={r.path} v={r.value} depth={0} />)}
      </ul>
    </div>
  );
}
