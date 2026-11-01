import { useState } from "react";
import { AnnotationPanel } from "./components/AnnotationPanel";
import { IfcPanel } from "./components/IfcPanel";
import { PickChainPanel } from "./components/PickChainPanel";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { JsonView } from "./components/JsonView";
import { KeyValue } from "./components/KeyValue";
import { Section } from "./components/Section";
import type { AnnotationOptions } from "./trimble/annotations";
import { DEFAULT_TEMPLATE, LEGACY_TEMPLATES } from "./trimble/labelTemplate";
import { useAnnotations } from "./trimble/useAnnotations";
import { useDebugDump } from "./trimble/debugDump";
import { useIfcBars } from "./trimble/useIfcBars";
import { usePickChain } from "./trimble/usePickChain";
import { PICK_LABELS, SELECTION_LABELS } from "./trimble/ownedMarkups";
import { useStrokeLabels } from "./trimble/useStrokeLabels";
import type { StrokeLabel } from "./trimble/valueLabels";
import { useSelectionProbe } from "./trimble/useSelectionProbe";
import { useWorkspace } from "./trimble/useWorkspace";

const OPTIONS_KEY = "soi.annotationOptions";
/** Stable empty list, so "no labels" doesn't look like a change on every render. */
const NO_LABELS: StrokeLabel[] = [];

const DEFAULT_OPTIONS: AnnotationOptions = {
  labelTemplate: DEFAULT_TEMPLATE,
  spacingToken: "",
  countToken: "",
  tagTokens: [],
  tagLayout: "stacked",
  labels: true,
  marks: true,
  mergeTolerance: 0,
  dimensionStyle: "drawing",
  valueText: "markup",
  spacing: true,
  overall: true,
  height: true,
};

function loadOptions(): AnnotationOptions {
  try {
    const stored = localStorage.getItem(OPTIONS_KEY);
    const options: AnnotationOptions = stored ? { ...DEFAULT_OPTIONS, ...JSON.parse(stored) } : DEFAULT_OPTIONS;
    return LEGACY_TEMPLATES.includes(options.labelTemplate) ? { ...options, labelTemplate: DEFAULT_TEMPLATE } : options;
  } catch {
    return DEFAULT_OPTIONS;
  }
}

export default function App() {
  const ws = useWorkspace();
  const probe = useSelectionProbe(ws.api, ws.selection);
  const [annotate, setAnnotate] = useState(true);
  const [annotationOptions, setAnnotationOptions] = useState(loadOptions);
  const ifc = useIfcBars();
  const annotations = useAnnotations(ws.api, ws.selection, annotate, annotationOptions, ifc.index);
  const pickChain = usePickChain(ws.api, ws.selection, {
    labelTemplate: annotationOptions.labelTemplate,
    style: annotationOptions.dimensionStyle,
    valueText: annotationOptions.valueText,
  });
  useDebugDump(ws.api, ws.selection);
  useStrokeLabels(ws.api, annotations.result?.labels ?? NO_LABELS, SELECTION_LABELS);
  useStrokeLabels(ws.api, pickChain.result?.labels ?? NO_LABELS, PICK_LABELS);

  const updateAnnotationOptions = (next: AnnotationOptions) => {
    setAnnotationOptions(next);
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable in sandboxed frames; settings then last for this session only.
    }
  };
  const selectedCount = ws.selection.reduce((n, m) => n + (m.objectRuntimeIds?.length ?? 0), 0);
  const connected = ws.status === "connected";

  return (
    <div className="app">
      <header className="app-header">
        <h1>Smart Object Inspector</h1>
        {connected && ws.project?.name && <span className="phase-tag">{ws.project.name}</span>}
      </header>

      {!connected && <ConnectionStatus status={ws.status} error={ws.error} onReconnect={ws.reconnect} />}

      {connected && (
        <>
          <Section title="3D annotations" badge={selectedCount || undefined}>
            <AnnotationPanel
              enabled={annotate}
              onEnabledChange={setAnnotate}
              options={annotationOptions}
              onOptionsChange={updateAnnotationOptions}
              state={annotations}
              sample={probe.result?.properties ?? null}
              onStartPicking={pickChain.start}
              picking={pickChain.active}
            />
          </Section>

          <Section title="Bar positions from IFC" badge={ifc.index ? "✓" : undefined} defaultOpen={!ifc.index}>
            <IfcPanel ifc={ifc} />
          </Section>

          <Section title="Dimension by picking" defaultOpen={false}>
            <PickChainPanel chain={pickChain} hasSelection={selectedCount > 0} />
          </Section>

          <Section title="Selected object" defaultOpen={false}>
            {selectedCount === 0 ? (
              <p className="muted">Click an object in the 3D Viewer.</p>
            ) : (
              <>
                {probe.loading && <p className="muted">Loading properties…</p>}
                {probe.result && (
                  <>
                    <KeyValue
                      rows={[
                        ["Name", probe.result.properties?.product?.name],
                        ["Class", probe.result.properties?.class],
                        ["IFC GUID", probe.result.externalId],
                        ["File", probe.result.fileName],
                      ]}
                    />
                    {probe.result.errors.map((e) => (
                      <p className="status-error" key={e}>
                        {e}
                      </p>
                    ))}
                  </>
                )}
              </>
            )}
          </Section>

          <Section title="Developer" defaultOpen={false}>
            <ConnectionStatus status={ws.status} error={ws.error} onReconnect={ws.reconnect} />
            <KeyValue
              rows={[
                ["Project", ws.project?.name],
                ["Project ID", ws.project?.id],
                ["Models", ws.models.map((m) => m.name).join(", ") || "—"],
                ["Runtime ID", probe.result?.runtimeId],
              ]}
            />
            <Section title="Raw getObjectProperties response" defaultOpen={false}>
              {probe.result ? <JsonView value={probe.result.properties} /> : <p className="muted">Nothing selected.</p>}
            </Section>
            <Section title="Last pick (viewer.onPicked)" defaultOpen={false}>
              {ws.lastPick ? <JsonView value={ws.lastPick} /> : <p className="muted">No pick event received yet.</p>}
            </Section>
            <Section title="Event log" badge={ws.events.length} defaultOpen={false}>
              {ws.events.length === 0 ? (
                <p className="muted">No events yet.</p>
              ) : (
                <ol className="event-log">
                  {ws.events.map((e) => (
                    <li key={e.id}>
                      <time>{e.time.toLocaleTimeString()}</time>
                      <code>{e.event}</code>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </Section>
        </>
      )}
    </div>
  );
}
