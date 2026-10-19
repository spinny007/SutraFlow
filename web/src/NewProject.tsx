/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { useEffect, useMemo, useState } from 'react';
import { get, post } from './api';
import { Modal, useCatalog, useToast } from './ui';

/** One choosable item: a sample, or a Sutra of a package or project. */
export interface Choice { id: string; title: string; sub?: string; group?: string; note?: string }

/**
 * A searchable list of checkboxes, grouped, nothing chosen until the person chooses. "Select shown"
 * takes what the search shows, so "AI" then "Select shown" picks the AI samples only.
 */
export function ChoiceList({ items, chosen, onChange, label }: { items: Choice[]; chosen: Set<string>; onChange(s: Set<string>): void; label: string }) {
  const [find, setFind] = useState('');
  // Every word typed must start a word of the item, so "AI" finds AI samples and not "failure".
  const terms = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const words = (i: Choice) => [i.title, i.sub, i.group, i.note].join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const shown = items.filter(i => { const w = words(i); return terms.every(t => w.some(x => x.startsWith(t))); });
  const groups = [...new Set(shown.map(i => i.group || ''))];
  const toggle = (id: string) => { const n = new Set(chosen); if (n.has(id)) n.delete(id); else n.add(id); onChange(n); };
  return (
    <div className="choices">
      <div className="row choicebar">
        <input className="search" type="search" placeholder={`Find ${label}`} aria-label={`Find ${label}`} value={find} onChange={e => setFind(e.target.value)} />
        <button type="button" className="btn small" onClick={() => onChange(new Set([...chosen, ...shown.map(i => i.id)]))}>Select shown</button>
        <button type="button" className="btn small" onClick={() => onChange(new Set([...chosen].filter(id => !shown.some(i => i.id === id))))}>Clear shown</button>
        <span className="muted xs">{chosen.size} of {items.length} chosen</span>
      </div>
      <div className="choicelist" role="group" aria-label={label}>
        {!shown.length && <p className="muted xs">Nothing matches.</p>}
        {groups.map(g => (
          <div key={g}>
            {g && <div className="choicegroup">{g}</div>}
            {shown.filter(i => (i.group || '') === g).map(i => (
              <label key={i.id} className="choice">
                <input type="checkbox" checked={chosen.has(i.id)} onChange={() => toggle(i.id)} />
                <span><strong>{i.title}</strong>{i.sub && <span className="muted xs"> {i.sub}</span>}{i.note && <span className="choicenote">{i.note}</span>}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface Sample { id: string; name: string; desc: string; palettes: string; needs?: string }
export const sampleChoices = (list: Sample[]): Choice[] =>
  list.map(s => ({ id: s.id, title: s.name, group: s.palettes.split(',')[0].trim(), sub: s.palettes.includes(',') ? `(${s.palettes})` : undefined, note: s.desc + (s.needs ? ` Needs ${s.needs}.` : '') }));

type Source = 'empty' | 'samples' | 'package' | 'copy';

/** New project: empty, with chosen samples, from chosen Sutras of a package file, or a copy of chosen Sutras of a project. */
export function NewProjectDialog({ onClose, onCreated }: { onClose(): void; onCreated(projectId: string): Promise<void> }) {
  const { projects } = useCatalog();
  const toast = useToast();
  const [source, setSource] = useState<Source>('empty');
  const [name, setNameRaw] = useState('');
  // A suggested name follows the choice until the person types their own.
  const [auto, setAuto] = useState(true);
  const setName = (v: string) => { setNameRaw(v); setAuto(false); };
  const suggest = (base: string) => {
    if (!auto && name.trim()) return;
    let n = base, i = 2;
    while (projects.some(p => p.name.toLowerCase() === n.toLowerCase())) n = `${base} ${i++}`;
    setNameRaw(n); setAuto(true);
  };
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [samples, setSamples] = useState<Sample[]>([]);
  const [pkg, setPkg] = useState<any | null>(null);
  const [zip, setZip] = useState<string | null>(null);
  const [zipFiles, setZipFiles] = useState<string[]>([]);
  const [samplesList, setSamplesList] = useState<{ file: string; name: string; description: string }[]>([]);
  useEffect(() => { get<any[]>('/api/sample-projects').then(setSamplesList).catch(() => setSamplesList([])); }, []);
  const [pkgErr, setPkgErr] = useState('');
  const [deploy, setDeploy] = useState(false);
  const [from, setFrom] = useState('');
  const [fromFlows, setFromFlows] = useState<{ id: string; name: string; deployed: any }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setChosen(new Set()); setErr('');
    if (source === 'samples') suggest('Samples');
    if (source === 'empty' && auto) setNameRaw('');
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (source === 'samples' && !samples.length) get<Sample[]>('/api/samples').then(setSamples).catch(e => setErr(e.message)); }, [source, samples.length]);
  useEffect(() => {
    if (source !== 'copy' || !from) { setFromFlows([]); return; }
    get<any[]>(`/api/flows?projectId=${encodeURIComponent(from)}`).then(setFromFlows).catch(e => setErr(e.message));
    const p = projects.find(x => x.id === from);
    if (p) suggest(`${p.name} copy`);
    setChosen(new Set());
  }, [source, from]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A release zip (with its files) or a .sutra package, from a file or a sample project. */
  const openBlob = async (blob: Blob, fileName: string) => {
    setPkg(null); setPkgErr(''); setChosen(new Set()); setZip(null); setZipFiles([]);
    try {
      if (/\.zip$/i.test(fileName)) {
        const b64 = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, '')); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
        const o = await post<any>('/api/packages/open', { zip: b64 });
        setZip(b64); setZipFiles(o.files || []); setPkg(o.package);
        suggest(String(o.package.project?.name || 'Imported'));
        return;
      }
      const p = JSON.parse(await blob.text());
      if (p?.format !== 'sutraflow-package') throw new Error('This is not a SutraFlow package (.sutra file)');
      setPkg(p);
      suggest(String(p.project?.name || 'Imported'));
    } catch (e: any) { setPkgErr(e.message.includes('JSON') ? 'This file is not a SutraFlow package or release zip' : e.message); }
  };
  const readFile = async (file?: File) => { if (file) await openBlob(file, file.name); else { setPkg(null); setZip(null); } };
  const readSample = async (fileName: string) => {
    if (!fileName) return;
    try {
      const r = await fetch(`/api/sample-projects/${encodeURIComponent(fileName)}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      await openBlob(await r.blob(), fileName);
    } catch (e: any) { setPkgErr(e.message); }
  };

  const items: Choice[] = useMemo(() => {
    if (source === 'samples') return sampleChoices(samples);
    if (source === 'package' && pkg) return pkg.sutras.map((s: any) => {
      const m = pkg.manifest?.sutras?.find((x: any) => x.name === s.name);
      return { id: s.name, title: s.name, sub: `v${s.version}${s.deployed ? ', deployed' : ''}`, note: (m?.triggers || []).join(', ') };
    });
    if (source === 'copy') return fromFlows.map(f => ({ id: f.name, title: f.name, sub: f.deployed ? `deployed v${f.deployed.version}` : 'draft' }));
    return [];
  }, [source, samples, pkg, fromFlows]);

  const exists = projects.some(p => p.name.toLowerCase() === name.trim().toLowerCase());
  const n = chosen.size;
  const ready = !!name.trim() && !exists && (source === 'empty' || n > 0);
  const why = !name.trim() ? 'Enter a name for the project.' : exists ? 'Choose a name no other project has.'
    : source === 'package' && !pkg ? 'Choose a package file.' : source === 'copy' && !from ? 'Choose the project to copy.'
      : source !== 'empty' && !n ? `Tick at least one ${source === 'samples' ? 'sample' : 'Sutra'}.` : '';
  const action = source === 'empty' ? 'Create project' : source === 'samples' ? `Create with ${n} sample${n === 1 ? '' : 's'}` : source === 'package' ? `Import ${n} Sutra${n === 1 ? '' : 's'}` : `Copy ${n} Sutra${n === 1 ? '' : 's'}`;

  const create = async () => {
    setBusy(true); setErr('');
    try {
      let id = '', note = '';
      if (source === 'package' || source === 'copy') {
        const r = source === 'package'
          ? await post('/api/projects/import', { ...(zip ? { zip } : { package: pkg }), project: name.trim(), sutras: [...chosen], asDrafts: !deploy })
          : await post(`/api/projects/${from}/copy`, { project: name.trim(), sutras: [...chosen] });
        id = r.project.id;
        if (r.missingSecrets?.length) note = ` Add these secrets before running them: ${r.missingSecrets.join(', ')}.`;
      } else {
        id = (await post('/api/projects', { name: name.trim() })).id;
        if (source === 'samples') await post(`/api/projects/${id}/samples`, { ids: [...chosen] });
      }
      await onCreated(id);
      toast(`Project ${name.trim()} created.${note}`, !!note);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="New project" onClose={onClose} actions={<>
      {why && <span className="muted xs" role="status" style={{ marginRight: 'auto', alignSelf: 'center' }}>{why}</span>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!ready || busy} onClick={create}>{busy ? 'Working' : action}</button>
    </>}>
      <p className="muted" style={{ marginTop: 0 }}>A project holds Sutras, shared resources, schemas, variables and its deployment config.</p>
      <div className="tabs" role="tablist" aria-label="Start from">
        {([['empty', 'Empty'], ['samples', 'Samples'], ['package', 'Package file'], ['copy', 'Copy a project']] as [Source, string][]).map(([k, l]) =>
          <button key={k} role="tab" aria-selected={source === k} className={source === k ? 'act' : ''} onClick={() => setSource(k)}>{l}</button>)}
      </div>
      {source === 'package' && (
        <div className="fld">
          <label htmlFor="np-file">Release zip or package file</label>
          <input id="np-file" type="file" accept=".zip,.sutra,.json" onChange={e => readFile(e.target.files?.[0])} />
          <div className="hint">Made with Releases or the sutra command on any SutraFlow server. Secret values never travel in a package; a zip's files go to the project's files folder.</div>
          {samplesList.length > 0 && <>
            <label htmlFor="np-sample" style={{ marginTop: 8 }}>Or a sample project</label>
            <select id="np-sample" defaultValue="" onChange={e => readSample(e.target.value)}>
              <option value="">Choose</option>
              {samplesList.map(s => <option key={s.file} value={s.file}>{s.name}</option>)}
            </select>
            {samplesList.map(s => <div key={s.file} className="hint">{s.name}: {s.description}</div>)}
          </>}
          {zipFiles.length > 0 && <div className="muted xs">With {zipFiles.length} files for the project files folder: {zipFiles.join(', ')}</div>}
          {pkgErr && <div className="errbox">{pkgErr}</div>}
          {pkg && <div className="muted xs">{pkg.name} {pkg.version} · {pkg.sutras.length} Sutras · made {String(pkg.createdAt || '').slice(0, 10)} with SutraFlow {pkg.createdWith}</div>}
        </div>
      )}
      {source === 'copy' && (
        <div className="fld">
          <label htmlFor="np-from">Copy from</label>
          <select id="np-from" value={from} onChange={e => setFrom(e.target.value)}>
            <option value="">Choose a project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="hint">The copies are drafts with the project's connections, schemas and variables. The original is not changed.</div>
        </div>
      )}
      <div className="fld">
        <label htmlFor="pn">Name</label>
        <input id="pn" type="text" value={name} autoFocus onChange={e => setName(e.target.value)} />
        {exists && <div className="hint" style={{ color: 'var(--err)' }}>A project with this name exists.</div>}
      </div>
      {items.length > 0 && <ChoiceList label={source === 'samples' ? 'samples' : 'Sutras'} items={items} chosen={chosen} onChange={setChosen} />}
      {source === 'package' && pkg && (
        <label className="check" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={deploy} onChange={e => setDeploy(e.target.checked)} />
          <span>Deploy the Sutras that are deployed in the package <span className="muted xs">(off: everything comes in as drafts, so nothing starts and no address clashes with the original)</span></span>
        </label>
      )}
      {err && <div className="errbox" style={{ marginTop: 8 }}>{err}</div>}
    </Modal>
  );
}
