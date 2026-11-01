import { useState, type DragEvent } from "react";
import type { IfcBarsState } from "../trimble/useIfcBars";

const FileIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

/**
 * The model's IFC file: dropped or chosen once, read for exact per-bar positions so spacing chains are
 * drawn automatically. Remembered in the browser between sessions.
 */
export function IfcPanel({ ifc }: { ifc: IfcBarsState }) {
  const [dragging, setDragging] = useState(false);
  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) ifc.load(file);
  };

  const dropHandlers = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      pick(e.dataTransfer.files);
    },
  };

  const input = (
    <input
      type="file"
      accept=".ifc"
      hidden
      onChange={(e) => {
        pick(e.target.files);
        e.target.value = "";
      }}
    />
  );

  if (ifc.loading) {
    return (
      <div className="ifc-card busy" aria-live="polite">
        <span className="spinner" aria-hidden />
        <div className="ifc-text">
          <strong>Reading IFC…</strong>
          <span className="muted">Large models can take a few seconds.</span>
        </div>
      </div>
    );
  }

  if (ifc.index) {
    return (
      <div className={`ifc-card loaded${dragging ? " dragging" : ""}`} {...dropHandlers}>
        <span className="ifc-icon">
          <FileIcon />
        </span>
        <div className="ifc-text">
          <strong title={ifc.fileName ?? undefined}>{ifc.fileName}</strong>
          <span className="muted">
            <span className="chip">{ifc.groupCount} bar groups</span>
          </span>
        </div>
        <div className="ifc-actions">
          <label className="text-button">
            Replace
            {input}
          </label>
          <button className="text-button subtle" onClick={ifc.clear}>
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <label className={`drop-area${dragging ? " dragging" : ""}`} {...dropHandlers}>
        <span className="drop-icon">
          <UploadIcon />
        </span>
        <strong>Load IFC model</strong>
        <span className="muted">
          Drop the <code>.ifc</code> file here or <span className="link">browse</span>
        </span>
        <span className="hint">Used to dimension the bar spacing. The file stays in this browser.</span>
        {input}
      </label>
      {ifc.error && <p className="status-error">{ifc.error}</p>}
    </>
  );
}
