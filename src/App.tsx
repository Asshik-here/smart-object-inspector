import { useState } from "react";
import { ConnectionStatus } from "./components/ConnectionStatus";
// DEVELOPER CARD: uncomment to enable (see the note at the bottom of the panel markup).
// import { DeveloperPanel } from "./components/DeveloperPanel";
import { Header } from "./components/Header";
import { IfcPanel } from "./components/IfcPanel";
import { SearchPanel } from "./components/SearchPanel";
import { StatusLine } from "./components/StatusLine";
// DEVELOPER CARD: uncomment to enable.
// import { Section } from "./components/Section";
import type { AnnotationOptions } from "./trimble/annotations";
import { DEFAULT_TEMPLATE } from "./trimble/labelTemplate";
import { useAnnotations } from "./trimble/useAnnotations";
import { useDebugDump } from "./trimble/debugDump";
import { useIfcBars } from "./trimble/useIfcBars";
import { useObjectSearch } from "./trimble/useObjectSearch";
import { SELECTION_LABELS } from "./trimble/ownedMarkups";
import { useStrokeLabels } from "./trimble/useStrokeLabels";
import type { StrokeLabel } from "./trimble/valueLabels";
// DEVELOPER CARD: uncomment to enable.
// import { useSelectionProbe } from "./trimble/useSelectionProbe";
import { useWorkspace } from "./trimble/useWorkspace";

/** Stable empty list, so "no labels" doesn't look like a change on every render. */
const NO_LABELS: StrokeLabel[] = [];

/**
 * Fixed annotation settings, chosen to match the BBS drawings: drawing style, values that follow the
 * camera, every layer, the reinforcement notation label, auto-detected spacing, and gaps within ±10 mm
 * merged into runs as Tekla does (`8*200`).
 */
const OPTIONS: AnnotationOptions = {
  labelTemplate: DEFAULT_TEMPLATE,
  spacingToken: "",
  countToken: "",
  tagTokens: [],
  tagLayout: "stacked",
  labels: true,
  marks: true,
  spacing: true,
  overall: true,
  height: true,
  dimensionStyle: "drawing",
  valueText: "markup",
  mergeTolerance: 10,
};

const ENABLED_KEY = "soi.enabled";

/** The On/Off choice survives a reload; storage can be unavailable in sandboxed frames. */
function storedEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

export default function App() {
  const ws = useWorkspace();
  // DEVELOPER CARD: uncomment to enable. Only the developer card uses this; it fetches the first
  // selected object's properties, IFC GUID and file name.
  // const probe = useSelectionProbe(ws.api, ws.selection);
  const ifc = useIfcBars();
  const [enabled, setEnabled] = useState(storedEnabled);
  // Whatever is selected (clicked in 3D or ticked in the search; they're the same selection) gets its
  // dimensions once "Show dimensions" is switched on. The header switch turns everything off.
  const search = useObjectSearch(ws.api, ws.models, ws.selection, ws.refreshSelection);
  const [showDimensions, setShowDimensions] = useState(false);
  const annotations = useAnnotations(ws.api, ws.selection, enabled && showDimensions, OPTIONS, ifc.index);
  useDebugDump(ws.api, ws.selection);
  useStrokeLabels(ws.api, annotations.result?.labels ?? NO_LABELS, SELECTION_LABELS);

  const connected = ws.status === "connected";
  const toggle = (next: boolean) => {
    setEnabled(next);
    try {
      localStorage.setItem(ENABLED_KEY, String(next));
    } catch {
      // Not remembered across reloads; harmless.
    }
  };

  return (
    <div className="app">
      <Header
        projectName={connected ? ws.project?.name : undefined}
        enabled={enabled}
        onEnabledChange={toggle}
        connected={connected}
      />

      {!connected && <ConnectionStatus status={ws.status} error={ws.error} onReconnect={ws.reconnect} />}

      {connected && (
        <>
          <section className="block">
            <h2 className="block-title">Find</h2>
            <SearchPanel search={search} showDimensions={showDimensions} onShowDimensionsChange={setShowDimensions} />
          </section>

          <section className="block">
            <h2 className="block-title">Activity</h2>
            <StatusLine
              state={annotations}
              enabled={enabled}
              showDimensions={showDimensions}
              selected={search.checked.size}
              hasIfc={!!ifc.index}
            />
          </section>

          <section className="block">
            <h2 className="block-title">Model</h2>
            <IfcPanel ifc={ifc} />
          </section>

          {/*
            DEVELOPER CARD (disabled). Shows the connection, the selected object's IFC GUID / runtime id /
            file, its raw getObjectProperties JSON, the last pick and the event log. Useful while developing;
            it only ever renders under `npm run dev`, never in a production build.
            To enable it, uncomment this block and every line marked "DEVELOPER CARD" above (the
            DeveloperPanel, Section and useSelectionProbe imports, and the `const probe = …` line).

          {import.meta.env.DEV && (
            <Section title="Developer" defaultOpen={false}>
              <DeveloperPanel ws={ws} probe={probe} />
            </Section>
          )}
          */}
        </>
      )}
    </div>
  );
}
