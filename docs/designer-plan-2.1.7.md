# 2.1.7 plan: designer correctness

Status: planned 7 November 2026, questions settled the same day; built 7 November 2026 (all five phases), with tests and documentation. The soak is deferred again (see the release gate).

The aim of this release is that a person building a Sutra can trust what the designer shows them:
- a step sees only the data it can really receive;
- every line on the canvas shows clearly where it comes from and where it goes;
- the input a called Sutra needs is stated once and checked;
- every run says whether it was a test run while designing or real work.

The backlog items this release closes are listed in each phase. When an item ships, it is removed from [backlog.md](backlog.md) in the same change.

## What exists today (2.1.6)

| Area | Today | Where |
| --- | --- | --- |
| Data a step may use | The mapper's data list shows steps before this one *and* steps in other lanes ("other branch; available only after completion"). The condition picker already shows steps before this one only. The engine does not refuse a reference to a step in another lane. | `web/src/mapping-sources.ts`, `ConditionDataBrowser` in `web/src/Mapper.tsx` |
| Trigger data | Reachable as `{{trigger…}}` in any field. The Input tab lists it only as the first step's "current input", so `input.params…` and `trigger.params…` look unrelated. | `server/src/engine/executor.ts`, `transitions.ts` |
| Lines on the canvas | Error lines are red and dashed, *otherwise* lines are dotted, and conditions are shown as labels. Selecting a line shows "*from* (port) to *to*" in the side panel only. There is no highlighting and no colour choice. | `web/src/Designer.tsx` (edges), `web/src/Inspector.tsx`, `web/src/styles.css` |
| Manual start | JSON schema only, with optional strict validation and a test payload. | `server/src/palettes/core.ts` (`start`) |
| Call Sutra | Its own *Input schema*, copied by hand from the called Sutra. | `server/src/palettes/process.ts` (`callProcess`) |
| XML schemas | XSD validation already exists in Parse XML and Render XML. It is reused here. | `server/src/palettes/core.ts`, `server/src/contracts.ts` |
| Design or runtime run | `runs.source` (`test`, `debug`, `manual`, a trigger) and `runs.started_by`. Some figures already leave out `test` and `debug`, but each one does it in its own way. | `server/src/db.ts`, `server/src/trace.ts` |

## Phase 1: data from connected steps only (lanes)

Closes the backlog item *Data from connected steps only (lanes)*.

1. **One rule, used everywhere.** A step may use:
   - the trigger;
   - project and engine properties;
   - Sutra variables;
   - the outputs of steps that come before it on a connected path.

   After a join (two lanes into one step), both lanes count as before it. A loop back does not make later steps count as before. The rule is written once (shared by the server and the web) and replaces the separate walks in `mapping-sources.ts` and `ConditionDataBrowser`.
2. **Designer.** Every data list and formula picker shows only what the rule allows: the Input tab, the condition picker and template fields. The "other branch" entries are removed.
3. **Trigger data entry.** Sutra Data on every step gets **Trigger data (`trigger`)**, so dragging a field writes `{{trigger.params.region}}`. The first step's "current input" stays as it is. Pointing at a `{{…}}` in a text field (SQL, templates) shows where it comes from, for example *trigger → Sales on MySQL (Dashboard page) → params.region, sent as a bound parameter*.
4. **Design check.** A reference to a step that is not before this one is a problem (not a warning). It names the step that uses it, the field and the step referred to, for example *"Latest orders: field Rows uses Regions, which is not on its path"*. These references count:
   - `{{nodes.<name>…}}` in mappings, templates and conditions;
   - JSONata `$nodes`;
   - Code steps' `nodes`.
5. **Engine.** At run time such a reference fails the step with the same message, instead of reading an output that may or may not exist yet.
6. **Samples.** Run the check over every sample and fix what it reports, starting with:
   - Sales dashboard;
   - Sales dashboard on a database;
   - Orders from JSON.

   Add a comment above the filter SQL of *Sales dashboard on a database*: an empty filter (`''`, sent for *All*) matches every row, and each value is a bound parameter. The sample tests fail if any sample has a design problem.
7. **Older Sutras.** No special handling (decided): the rule applies to every Sutra from 2.1.7. The release notes say so in one line and how to fix one (connect the lanes, or move the step after the Merge).

Tests:
- the two- and three-lane example (c sees a, not b);
- a join, a loop back, a step inside For each;
- each reference form refused in the designer, by the design check and at run time;
- every sample passes.

## Phase 2: clearer connections, with colours

Closes the backlog item *Clearer connections on the canvas*.

1. **Pointing at a line** shows a label *from step (port) → to step* and highlights the line and both ends.
2. **Selecting a step** highlights its incoming and outgoing lines and the steps at their other ends, and dims the rest. A **Path** toggle highlights everything before and after it, using the Phase 1 rule, so it shows exactly the steps whose data it can use.
3. **Colours for lines.**
   - **Automatic.** When several lines go into one step, each one gets a different colour from a fixed palette of 8. The palette is checked for contrast in light and dark themes, and colour-blind safe as far as 8 colours allow. A line keeps its colour when steps move. The colour follows the line's source step, so all lines leaving one step share its colour unless changed.
   - **By hand.** A line can be given a colour in its side panel (the palette, plus *Automatic*). The colour is saved in the Sutra (`edge.color`) and travels with exports, packages and Git.
   - **Colouring a whole step's lines.** A step's lines can be coloured in one go: right-click a step, then *Colour its lines*.
   - **Port looks stay.** Error lines stay red and dashed, and empty and *otherwise* lines stay dotted with a short port label at the start. The colour is added on top of the dash, never instead of it, so the meaning does not depend on colour alone.
   - **A small key.** When lines meet at a step, its *Input* tab lists them with their colours: *Merge "All charts" receives: Orders (blue), Revenue by month (green), …*.
4. **Tidy** lays the Sutra out left to right by lanes so lines cross less. It is one undo step.
5. **Read-only views.** Opening a run in the designer (Runs, Open in designer) shows the same colours and highlighting; there is no separate canvas in the Admin Console.

Tests:
- label on hover;
- highlight on selection;
- Path with a join;
- automatic colours distinct for 2 to 8 lines into one step, and stable after moving steps;
- a colour set by hand saved, exported and imported;
- error and empty lines keep their look with a colour;
- Tidy undone;
- contrast check of the palette in both themes.

## Phase 3: Manual start inputs for called Sutras (JSON or XML)

Closes the backlog item *Manual start inputs for called Sutras (JSON or XML schema)*.

1. **Manual start.** The *Payload schema* accepts an XSD as well as a JSON Schema, with an XML test payload.
   - An XML input is checked against the XSD (the Parse XML check, reused) and turned into structured data the same way Parse XML does. Later steps map from it like JSON.
   - Strict validation works as today.
2. **Call Sutra.** When a Sutra is picked, its Manual start schema becomes the input contract.
   - The input mapping shows the called Sutra's fields as targets, with required fields marked.
   - *Input schema* shows the contract read only. A note appears when the called Sutra has changed it since the step was last saved.
   - *Version* (draft or deployed) uses that version's schema.
   - Existing Call Sutra steps with their own *Input schema* keep it until the designer picks the contract (one click, shown as a suggestion).
3. **Validation.** The called Sutra checks its input at its Manual start. An invalid input fails the Call Sutra step with the problem fields, before any step of the called Sutra runs.
4. **The same check everywhere.** Starting it by hand in the studio, with the Run API, and with `sutra` uses the same schema and check.

Tests:
- JSON and XML contracts;
- a missing required field, a wrong type, an XML with the wrong root;
- a schema change in the called Sutra shown in the caller;
- draft and deployed versions;
- an old Call Sutra step kept as it was;
- Run API and studio refuse the same bad input.

## Phase 4: design-time and runtime runs told apart

Closes the backlog item *Design-time and runtime runs told apart*.

1. **A stage on every run.** A new column `runs.stage` holds `design` or `runtime`:
   - `design`: a test or debug run of a draft, from the studio (later also VS Code and generated Sutras);
   - `runtime`: a deployed version, from any trigger or the Run API.

   A Call Sutra child takes its parent's stage. The run also records the client (`studio`, `api`, `cli`), next to `started_by` and the version or draft.
2. **One place decides.** A single function sets the stage when a run starts. Every figure that today leaves out `test` and `debug` uses the stage instead:
   - Overview, dashboards and metrics;
   - alerts, connection usage and gateway statistics;
   - traces.
3. **Filters.** Runs and the Admin Console get a *Design / Runtime / All* filter, defaulting to Runtime in the Admin Console and to All in the designer.
4. **Retention.** Each stage can keep its runs for its own length of time (design runs default to 7 days, runtime runs as now).
5. **Upgrade.** Existing runs get their stage from their source and version: `test`/`debug` or version 0 is design, anything else is runtime. This is done in batches on PostgreSQL so a large `runs` table does not lock.

Tests:
- each source maps to the right stage;
- a child takes its parent's stage;
- figures leave out design runs;
- the upgrade fills the stage on SQLite and PostgreSQL;
- retention removes only design runs;
- the filter in both places.

## Phase 5: small designer fixes

1. **Page link.** A Dashboard page trigger shows a link to `/dash/<name>` once deployed, and says *not deployed* before that.
2. **Missing database hint.** When a sample's query fails with an unknown database or table, the error adds *"Run 'Sample: Sales orders install' first."* (the install Sutra named by the sample).
3. **Documentation.**
   - The user guide and design guide gain a section on what a step can see (lanes, joins, `trigger`).
   - Line colours are described.
   - Manual start with XML is described.
   - The admin guide explains run stages and retention.

   README, the architecture page and the release notes are kept in step, with a Fixes table (seen / cause / now).

## Release gate

The 24-hour remote-PostgreSQL soak (the backlog's only Must have) blocks the release. For 2.1.7 it is deferred again (decided); the receipt records that and why.

## Questions settled (7 November 2026)

| Question | Decision |
| --- | --- |
| Lanes at run time | **Refuse in 2.1.7.** The engine fails a step that uses a step on another lane, with the design check's message. The samples are changed to follow the rule. Existing Sutras are not handled specially: no transition release, no setting to allow them. |
| Automatic colours on or off | On only where two or more lines go into one step. Other lines keep the normal colour unless coloured by hand. |
| What gets the colour | The source step: all lines leaving a step share its colour. |
| XML input shape | The Parse XML structured shape, plus the original text as `xml`. |
| The soak | **Deferred again, recorded.** The 2.1.7 receipt states it and why. It stays the Must have in the backlog. |
| Design-run retention default | 7 days, changeable by an administrator. |
