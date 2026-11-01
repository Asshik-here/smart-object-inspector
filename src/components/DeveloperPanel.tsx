import type { ProbeState } from "../trimble/useSelectionProbe";
import type { WorkspaceState } from "../trimble/useWorkspace";
import { ConnectionStatus } from "./ConnectionStatus";
import { JsonView } from "./JsonView";
import { KeyValue } from "./KeyValue";
import { Section } from "./Section";

/** Connection details, the selected object's raw data and the event log. Shown under `npm run dev` only. */
export function DeveloperPanel({ ws, probe }: { ws: WorkspaceState; probe: ProbeState }) {
  const object = probe.result;
  return (
    <>
      <ConnectionStatus status={ws.status} error={ws.error} onReconnect={ws.reconnect} />
      <KeyValue
        rows={[
          ["Project", ws.project?.name],
          ["Project ID", ws.project?.id],
          ["Models", ws.models.map((m) => m.name).join(", ") || "—"],
          ["Object", object?.properties?.product?.name],
          ["Class", object?.properties?.class],
          ["IFC GUID", object?.externalId],
          ["Runtime ID", object?.runtimeId],
          ["File", object?.fileName],
        ]}
      />
      {object?.errors.map((e) => (
        <p className="status-error" key={e}>
          {e}
        </p>
      ))}
      <Section title="Raw getObjectProperties response" defaultOpen={false}>
        {object ? <JsonView value={object.properties} /> : <p className="muted">Nothing selected.</p>}
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
    </>
  );
}
