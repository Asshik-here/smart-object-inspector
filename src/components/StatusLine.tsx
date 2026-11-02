import type { AnnotationState } from "../trimble/useAnnotations";

interface Props {
  state: AnnotationState;
  enabled: boolean;
  showDimensions: boolean;
  /** Objects ticked in the search. */
  selected: number;
  hasIfc: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What the extension is doing in the 3D view right now, in one line. */
export function StatusLine({ state, enabled, showDimensions, selected, hasIfc }: Props) {
  const groups = state.result?.groups ?? [];
  const missing = groups.filter((g) => g.source === "none").length;

  let tone: "off" | "idle" | "busy" | "ok" | "warn" | "error";
  let title: string;
  let detail: string;
  if (!enabled) {
    tone = "off";
    title = "Off";
    detail = "Dimensions are hidden. Switch on to show them again.";
  } else if (state.error) {
    tone = "error";
    title = "Something went wrong";
    detail = state.error;
  } else if (!selected) {
    tone = "idle";
    title = "Active";
    detail = "Select objects in the 3D view or search above.";
  } else if (!showDimensions) {
    tone = "idle";
    title = `${plural(selected, "object")} selected`;
    detail = "Switch on Show dimensions to see them in 3D.";
  } else if (state.busy) {
    tone = "busy";
    title = "Dimensioning…";
    detail = "Reading the selected bars.";
  } else if (!groups.length) {
    tone = "warn";
    title = "Nothing to dimension";
    detail = "The selected objects have no geometry to dimension.";
  } else if (missing) {
    tone = "warn";
    title = `${plural(groups.length - missing, "bar group")} dimensioned`;
    detail = `${missing} without spacing — ${hasIfc ? "not in the loaded IFC." : "load the model's IFC."}`;
  } else {
    tone = "ok";
    title = `${plural(groups.length, "bar group")} dimensioned`;
    detail = "Shown in the 3D view.";
  }

  return (
    <div className={`activity ${tone}`} role="status">
      <span className="activity-dot" aria-hidden />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}
