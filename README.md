# Smart Object Inspector

A Trimble Connect for Browser **3D Viewer extension** that turns a selected rebar mesh into a
drawing-style annotation inside the 3D view: bar labels in reinforcement notation, overall
dimensions, and Tekla-style spacing chains (`305 · 110 · 8*200`), all read from the real model.

Built with React, TypeScript, Vite and the
[Trimble Connect Workspace API](https://components.connect.trimble.com/trimble-connect-workspace-api/index.html)
(`trimble-connect-workspace-api` 0.3.38).

## What it draws

| In the 3D view | Source |
|---|---|
| Labels such as `10-H10-73-B1 PF` (`QTY-GRADE+DIA-MARK-CENTRES-ID FIXING`) | Object properties (`MSS_TEST_BBS_PS`) |
| Bar mark tags such as `73`, `149` | `REBAR BARMARK` property |
| Overall dimensions (`2320`, `850`) and height (`120`), to bar centrelines | Bounding boxes |
| Spacing chains with ticks and extension lines (`35 · 2*200 · 130`) | Bar positions from the model's IFC file, a spacing property, or picked points |

Everything is drawn as Trimble markups and removed again when the selection changes or the
extension closes. Your own markups are never touched.

## Requirements

- **Node.js 18 or newer** (developed with Node 24) and npm.
- A **Trimble Connect** project where you are a **Project Administrator** (needed to add a custom extension).
- For automatic spacing chains: the **IFC file** of the model you open in the viewer.

## Setup

```sh
git clone <this repository URL>
cd smart-object-inspector
npm install
npm run dev
```

The dev server runs at `http://localhost:5173` and must keep running while you use the extension.

## Add the extension to Trimble Connect

1. Open your project in [Trimble Connect for Browser](https://web.connect.trimble.com).
2. Go to **Settings → Apps & Capabilities → + Add Custom**.
3. Enter the manifest URL `http://localhost:5173/manifest.json` and click **Add**.
4. Make sure **Smart Object Inspector** is **Enabled**.
5. Open a model in the **3D Viewer** and click the extension's icon (cube with a magnifier) in the
   left-hand panel strip.

The panel header shows the project name once the extension is connected. Opening
`http://localhost:5173` directly in a browser tab shows "Not inside Trimble Connect"; that is expected.

## Using it

1. **Select** a rebar mesh (for example `B1 PF` + `B2 PF`). Labels, bar mark tags, overall
   dimensions and height appear.
2. **Spacing chains**, using one of three sources:
   - **Bar positions from IFC** (automatic, recommended): download the model's IFC from Trimble
     Connect (**Data → file → ⋮ → Download**) and load it once in this section. It is remembered in
     the browser. Each bar's position is read from the file, so every selection gets its chains.
   - **Spacing property** (automatic): if the model has a property such as `BAR CENTRES = 110 8*200`,
     it is detected and used.
   - **Dimension by picking** (manual fallback): click each bar once.
3. Adjust under **3D annotations**:
   - **Style**: drawing style (lines, 45° ticks, values) or Trimble measurements.
   - **Value text**: follows the camera live (Trimble text, underlined) or no underline (redrawn
     to face the camera after you stop rotating).
   - **Spacing values**: exact, or merged within ±5 / ±10 mm like a Tekla drawing (`8*200`).
   - **Layers** and the **label template** (`{NUMBER OF BARS IN GROUP}-{GRADE}{SIZE}-…`).

## Production hosting

`localhost` only works on the computer running `npm run dev`. To share the extension:

1. `npm run build`, then host the `dist/` folder on any **HTTPS** static host (GitHub Pages,
   Netlify, Azure Static Web Apps, …). The host must allow cross-origin requests (CORS) for
   `manifest.json`.
2. In `public/manifest.json`, change `url` and `icon` to the hosted address, then rebuild.
3. In Trimble Connect, add the extension again with the hosted manifest URL.

Development helpers (the `debug/` dumps and the `soi` console helper) are only active under
`npm run dev` and are not included in the production build.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with hot reload on port 5173 |
| `npm run build` | Type-check and build to `dist/` |
| `npm run typecheck` | Type-check only |
| `npm test` | Run the unit tests (Vitest) |
| `npm run test:watch` | Run the tests on every change |
| `npm run preview` | Serve the production build on port 5173 |

## Project structure

```
public/manifest.json              Extension manifest (title, URL, icon, 3D Viewer placement)
src/App.tsx                       Panel layout and settings
src/components/                   Panel sections (annotations, IFC loader, picking, …)

src/trimble/connection.ts         Connects to Trimble Connect once and fans out events
src/trimble/useWorkspace.ts       Connection, project, models, selection
src/trimble/objectData.ts         Cached, batched viewer data (properties, boxes, IFC GUIDs) per object

src/trimble/annotations.ts        Selection annotations: bar groups, labels, tags, overall dimensions
src/trimble/pickedChain.ts        Dimension by picking
src/trimble/chain.ts              Tekla-style spacing chains (runs, leading edge, ticks, extension lines)
src/trimble/markups.ts            Markup building blocks, styles and colours
src/trimble/ownedMarkups.ts       MarkupLayer: serialized redraws and clean removal of our markups
src/trimble/geometry.ts           Vectors, boxes, plan axes
src/trimble/barProperties.ts      Bar length / count / diameter from properties

src/trimble/ifcBars.ts            Reads per-bar positions from an IFC file
src/trimble/ifcWorker.ts          Runs the IFC reader in a Web Worker
src/trimble/labelTemplate.ts      Label notation and property tokens
src/trimble/spacing.ts            Spacing-property parsing and detection
src/trimble/strokeFont.ts         Line-drawn digits for underline-free values
src/trimble/valueLabels.ts        Stroke-drawn values that face the camera
src/trimble/debugDump.ts          Dev-only API dumps to debug/*.json and the `soi` console helper
src/trimble/*.test.ts             Unit tests; testFixtures.ts holds synthetic test data (no real model data)
```

## Performance notes

- Viewer data is cached per object and fetched in one call per model, so annotations, picking and the
  inspector share it (cleared when models are loaded, unloaded or reset).
- The IFC is parsed in a Web Worker, and only the parsed bar positions are stored in the browser, so a
  reload doesn't parse again. Roughly 1.5 s per 60 MB of rebar-heavy IFC, without freezing the panel.
- Markups are replaced as one serialized layer per feature; selection changes are debounced.

## Debugging

While `npm run dev` runs, each selection is printed as JSON in the browser console and saved to
`debug/selection.json`. In DevTools, switch the console context from `top` to `localhost:5173`, then:

```js
soi.show()          // print the current selection again
copy(soi.json())    // copy all properties of the selection as JSON
```

`debug/` is git-ignored because it contains real model data.

## Known limitations

These are limits of the public Workspace API, not of the extension:

- **No hover.** The API has no mouse-over or cursor event; everything updates on selection or click.
- **Rebar groups are single objects.** The viewer only exposes one bounding box per group, so
  individual bar positions need the IFC file, a spacing property, or picking.
- **Text markups are always underlined.** Choose *No underline* to draw values as strokes instead.
- The loaded IFC must be the same version as the model open in the viewer (matched by IFC GlobalId).
