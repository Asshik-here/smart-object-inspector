interface Props {
  projectName?: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /** The toggle is only offered once connected to Trimble Connect. */
  connected: boolean;
}

/** Branded header with the extension's On/Off switch. */
export function Header({ projectName, enabled, onEnabledChange, connected }: Props) {
  return (
    <header className="hero">
      {/* Cube with a magnifier: the same mark as the extension's icon in Trimble's side strip. */}
      <span className="hero-logo" aria-hidden>
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path d="M11 2.5 3.5 6.5v8.5l7.5 4 7.5-4V6.5z" />
          <path d="M3.5 6.5 11 10.5l7.5-4M11 10.5V19" />
          <circle cx="17.5" cy="17.5" r="3" fill="#0063a3" />
          <path d="m19.7 19.7 2 2" />
        </svg>
      </span>
      <div className="hero-title">
        <h1>Smart Object Inspector</h1>
        <span>{projectName ?? "Rebar dimensions in 3D"}</span>
      </div>
      {connected && (
        <label className="power" title={enabled ? "Turn off: hide the dimensions" : "Turn on: show the dimensions"}>
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            aria-label="Smart Object Inspector on or off"
          />
          <span className="power-track" aria-hidden>
            <span className="power-knob" />
          </span>
          <span className="power-label">{enabled ? "On" : "Off"}</span>
        </label>
      )}
    </header>
  );
}
