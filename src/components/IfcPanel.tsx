import { useRef, useState } from "react";
import type { IfcBarsState } from "../trimble/useIfcBars";

/** Loads the model's IFC file so spacing chains can be drawn from the exact bar positions. */
export function IfcPanel({ ifc }: { ifc: IfcBarsState }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) ifc.load(file);
  };

  return (
    <>
      {ifc.index ? (
        <p className="notice ok">
          <strong>{ifc.fileName}</strong> loaded: {ifc.groupCount} bar groups with exact bar positions. Select bars to
          see their spacing chains automatically.
        </p>
      ) : (
        <p className="muted">
          Load the same IFC file that is open in the viewer (Data → file → ⋮ → Download). The spacing between every
          bar is then drawn automatically when you select a bar group. The file stays in this browser.
        </p>
      )}

      <div
        className={`drop-zone${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files);
        }}
      >
        <span className="muted">Drop the .ifc file here, or</span>
        <button className="button primary" onClick={() => input.current?.click()} disabled={ifc.loading}>
          {ifc.loading ? "Reading…" : ifc.index ? "Load another IFC" : "Choose IFC file"}
        </button>
        {ifc.index && (
          <button className="button" onClick={ifc.clear}>
            Remove
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept=".ifc"
          hidden
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {ifc.error && <p className="status-error">{ifc.error}</p>}
    </>
  );
}
