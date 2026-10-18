import { q, tx } from './db.js';

/**
 * Folders in the Project explorer. Each area has its own tree: Sutras, Resources, Schemas and
 * Service descriptors (WSDLs). An item's folder is a path such as "Samples/SQL" in its own row
 * ('' = the top); a folder with nothing in it is kept in the folders table. Folders only arrange
 * the explorer: names stay unique per project, and nothing else reads them.
 */
export type FolderArea = 'sutras' | 'resources' | 'schemas' | 'wsdl';
const AREAS: Record<FolderArea, { table: string; where: string; what: string }> = {
  sutras: { table: 'flows', where: '', what: 'Sutra' },
  resources: { table: 'resources', where: '', what: 'Resource' },
  schemas: { table: 'schemas', where: " and kind != 'wsdl'", what: 'Schema' },
  wsdl: { table: 'schemas', where: " and kind = 'wsdl'", what: 'Service descriptor' },
};
export const areaOf = (v: unknown): FolderArea => {
  const a = String(v || 'sutras') as FolderArea;
  if (!AREAS[a]) throw new Error(`Unknown folder area "${a}": use sutras, resources, schemas or wsdl`);
  return a;
};

/** Cleans a folder path: "/a//b/ " -> "a/b". */
export function normFolder(v: unknown) {
  const parts = String(v ?? '').split(/[\\/]+/).map(p => p.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim()).filter(Boolean);
  if (parts.length > 8) throw new Error('Folders go at most 8 levels deep');
  if (parts.some(p => p.length > 60)) throw new Error('A folder name has at most 60 characters');
  return parts.join('/');
}
const parentsOf = (p: string) => p.split('/').map((_x, i, a) => a.slice(0, i + 1).join('/'));
const inside = (p: string, folder: string) => p === folder || p.startsWith(folder + '/');
const items = (projectId: string, area: FolderArea) => {
  const a = AREAS[area];
  return q.all<{ id: string; folder: string | null }>(`select id, folder from ${a.table} where project_id = ?${a.where}`, projectId).map(r => ({ id: r.id, folder: r.folder || '' }));
};
const saved = (projectId: string, area: FolderArea) => q.all<{ path: string }>('select path from folders where project_id = ? and area = ?', projectId, area).map(r => r.path);
const keep = (projectId: string, area: FolderArea, path: string) => q.run('insert into folders(project_id, area, path) values(?, ?, ?) on conflict do nothing', projectId, area, path);
const forget = (projectId: string, area: FolderArea, path: string) => q.run('delete from folders where project_id = ? and area = ? and path = ?', projectId, area, path);
const setFolder = (area: FolderArea, id: string, folder: string) => q.run(`update ${AREAS[area].table} set folder = ? where id = ?`, folder, id);

/** Every folder of an area (with their parents), sorted. */
export function listFolders(projectId: string, area: FolderArea = 'sutras') {
  const all = new Set<string>();
  for (const p of saved(projectId, area)) parentsOf(p).forEach(x => all.add(x));
  for (const r of items(projectId, area)) if (r.folder) parentsOf(r.folder).forEach(x => all.add(x));
  return [...all].sort((a, b) => a.localeCompare(b));
}

export function createFolder(projectId: string, path: unknown, area: FolderArea = 'sutras') {
  const p = normFolder(path);
  if (!p) throw new Error('Give the folder a name');
  keep(projectId, area, p);
  return listFolders(projectId, area);
}

/** Puts one item in a folder ('' = the top); the folder is made when missing. */
export function setItemFolder(area: FolderArea, id: string, folder: unknown) {
  const a = AREAS[area];
  if (!q.get(`select 1 from ${a.table} where id = ?${a.where}`, id)) throw new Error(`${a.what} not found`);
  setFolder(area, id, normFolder(folder));
}

/** Renames or moves a folder with everything in it: "Samples/SQL" -> "Database/SQL". */
export function moveFolder(projectId: string, from: unknown, to: unknown, area: FolderArea = 'sutras') {
  const a = normFolder(from), b = normFolder(to);
  if (!a) throw new Error('Choose a folder');
  if (!b) throw new Error('Give the folder a name');
  if (inside(b, a) && a !== b) throw new Error('A folder cannot go inside itself');
  const swap = (p: string) => (inside(p, a) ? b + p.slice(a.length) : p);
  tx(() => {
    for (const r of items(projectId, area)) if (inside(r.folder, a)) setFolder(area, r.id, swap(r.folder));
    for (const p of saved(projectId, area)) if (inside(p, a)) { forget(projectId, area, p); keep(projectId, area, swap(p)); }
    keep(projectId, area, b);
  });
  return listFolders(projectId, area);
}

/** Removes a folder; its items and sub-folders move up to the folder above. Nothing is deleted. */
export function removeFolder(projectId: string, path: unknown, area: FolderArea = 'sutras') {
  const a = normFolder(path);
  if (!a) throw new Error('Choose a folder');
  const up = a.split('/').slice(0, -1).join('/');
  const lift = (p: string) => (p === a ? up : [up, p.slice(a.length + 1)].filter(Boolean).join('/'));
  tx(() => {
    for (const r of items(projectId, area)) if (inside(r.folder, a)) setFolder(area, r.id, lift(r.folder));
    for (const p of saved(projectId, area)) {
      if (!inside(p, a)) continue;
      forget(projectId, area, p);
      if (p !== a && lift(p)) keep(projectId, area, lift(p));
    }
  });
  return listFolders(projectId, area);
}
