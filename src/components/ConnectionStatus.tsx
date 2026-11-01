import type { ConnectionStatus as Status } from "../trimble/useWorkspace";

const LABELS: Record<Status, string> = {
  standalone: "Not inside Trimble Connect",
  connecting: "Connecting…",
  connected: "Connected",
  error: "Connection failed",
};

interface Props {
  status: Status;
  error: string | null;
  onReconnect: () => void;
}

export function ConnectionStatus({ status, error, onReconnect }: Props) {
  return (
    <div className={`status status-${status}`}>
      <span className="status-dot" aria-hidden />
      <span className="status-label">{LABELS[status]}</span>
      {status === "error" && (
        <button className="link-button" onClick={onReconnect}>
          Retry
        </button>
      )}
      {error && <p className="status-error">{error}</p>}
      {status === "standalone" && (
        <p className="status-hint">
          This page is running on its own. Add <code>manifest.json</code> as a custom extension in a Trimble Connect
          project and open it from the 3D Viewer.
        </p>
      )}
    </div>
  );
}
