import { useEffect, useMemo, useState } from "react";
import type { ObjectProperties } from "trimble-connect-workspace-api";
import { MAX_ANNOTATED_OBJECTS, type AnnotationOptions } from "../trimble/annotations";
import {
  applyCentres,
  applyCount,
  availableTokens,
  CENTRES_TOKEN,
  COUNT_TOKEN,
  renderLabel,
  tokenDisplayName,
} from "../trimble/labelTemplate";
import { parseSpacing } from "../trimble/spacing";
import type { AnnotationState } from "../trimble/useAnnotations";
import { KeyValue } from "./KeyValue";

type LayerKey = "labels" | "marks" | "spacing" | "overall" | "height";
type TextKey = "labelTemplate" | "spacingToken" | "countToken";

const TEXT_FIELDS: { key: TextKey; label: string; placeholder: string; hint: string }[] = [
  { key: "labelTemplate", label: "Label template", placeholder: "{name}", hint: "Text and {property} tokens." },
  {
    key: "spacingToken",
    label: "Spacing property",
    placeholder: "auto-detect",
    hint: "Leave empty to auto-detect. Used when a whole rebar group is one object (values like 110 8*200).",
  },
  {
    key: "countToken",
    label: "Bar count property (optional)",
    placeholder: "e.g. {Set.Number}",
    hint: "Only needed when the spacing is a single value such as 200.",
  },
];

const LAYERS: [LayerKey, string][] = [
  ["labels", "Bar labels"],
  ["marks", "Bar mark tags (sections)"],
  ["spacing", "Spacing chains (e.g. 8*200)"],
  ["overall", "Overall dimensions"],
  ["height", "Height"],
];

interface Props {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  options: AnnotationOptions;
  onOptionsChange: (options: AnnotationOptions) => void;
  state: AnnotationState;
  /** Properties of the first selected object, used to offer label tokens. */
  sample: ObjectProperties | null;
  /** Starts "Dimension by picking", offered when the model has no spacing data. */
  onStartPicking: () => void;
  picking: boolean;
}

export function AnnotationPanel({
  enabled,
  onEnabledChange,
  options,
  onOptionsChange,
  state,
  sample,
  onStartPicking,
  picking,
}: Props) {
  const [drafts, setDrafts] = useState<Record<TextKey, string>>({
    labelTemplate: options.labelTemplate,
    spacingToken: options.spacingToken,
    countToken: options.countToken,
  });
  const [active, setActive] = useState<TextKey>("labelTemplate");
  const [filter, setFilter] = useState("");
  useEffect(
    () =>
      setDrafts({
        labelTemplate: options.labelTemplate,
        spacingToken: options.spacingToken,
        countToken: options.countToken,
      }),
    [options.labelTemplate, options.spacingToken, options.countToken],
  );
  const tokens = useMemo(() => availableTokens(sample), [sample]);
  const visibleTokens = tokens.filter(
    (t) => !filter || `${t.token} ${t.sample}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const previews: Record<TextKey, string | null> = {
    labelTemplate: sample ? applyCentres(applyCount(renderLabel(drafts.labelTemplate, sample), 1), null) : null,
    spacingToken:
      sample && drafts.spacingToken.trim()
        ? (() => {
            const value = renderLabel(drafts.spacingToken, sample);
            return parseSpacing(value) ? value : `${value} (not a spacing)`;
          })()
        : null,
    countToken: sample && drafts.countToken.trim() ? renderLabel(drafts.countToken, sample) : null,
  };

  const set = (patch: Partial<AnnotationOptions>) => onOptionsChange({ ...options, ...patch });
  const commit = (key: TextKey, value: string) => {
    setDrafts((d) => ({ ...d, [key]: value }));
    set({ [key]: value });
  };
  const toggleTag = (token: string, on: boolean) =>
    set({ tagTokens: on ? [...options.tagTokens, token] : options.tagTokens.filter((t) => t !== token) });
  // The label template is free text; spacing and count hold a single token.
  const insert = (token: string) =>
    commit(active, active === "labelTemplate" ? `${drafts.labelTemplate}${token}` : token);

  return (
    <>
      <label className="toggle">
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
        <strong>Show annotations in the 3D view</strong>
      </label>

      {enabled && (
        <>
          <div className="segmented" role="radiogroup" aria-label="Dimension style">
            {(["drawing", "measure"] as const).map((style) => (
              <label key={style}>
                <input
                  type="radio"
                  name="dimension-style"
                  checked={options.dimensionStyle === style}
                  onChange={() => set({ dimensionStyle: style })}
                />
                {style === "drawing" ? "Drawing style (Tekla-like)" : "Trimble measurements"}
              </label>
            ))}
          </div>

          {options.dimensionStyle === "drawing" && (
            <label className="toggle">
              Value text
              <select
                value={options.valueText}
                onChange={(e) => set({ valueText: e.target.value as AnnotationOptions["valueText"] })}
              >
                <option value="markup">Follows camera live (underlined)</option>
                <option value="stroke">No underline (turns after rotating)</option>
              </select>
            </label>
          )}

          <label className="toggle">
            Spacing values
            <select
              value={options.mergeTolerance}
              onChange={(e) => set({ mergeTolerance: Number(e.target.value) })}
            >
              <option value={0}>exact (show every deviation)</option>
              <option value={5}>merge within ±5 mm</option>
              <option value={10}>merge within ±10 mm (Tekla-like)</option>
            </select>
          </label>

          <div className="layer-toggles">
            {LAYERS.map(([key, label]) => (
              <label className="toggle" key={key}>
                <input type="checkbox" checked={options[key]} onChange={(e) => set({ [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>

          {TEXT_FIELDS.map((f) => (
            <div className={`field${active === f.key ? " active" : ""}`} key={f.key}>
              <label htmlFor={f.key}>{f.label}</label>
              <input
                id={f.key}
                className="text-input"
                value={drafts[f.key]}
                placeholder={f.placeholder}
                onFocus={() => setActive(f.key)}
                onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                onBlur={() => commit(f.key, drafts[f.key])}
                onKeyDown={(e) => e.key === "Enter" && commit(f.key, drafts[f.key])}
                spellCheck={false}
              />
              <p className="muted">
                {previews[f.key] ? (
                  <>
                    Value: <code>{previews[f.key]}</code>
                  </>
                ) : (
                  f.hint
                )}
              </p>
            </div>
          ))}

          <div className="field">
            <label>3D property tag</label>
            {options.tagTokens.length === 0 ? (
              <p className="muted">Tick properties in the list below to show them under each label in 3D.</p>
            ) : (
              <ul className="tag-list">
                {options.tagTokens.map((t) => (
                  <li key={t}>
                    <span>
                      {tokenDisplayName(t)}
                      {sample && <span className="muted">: {renderLabel(t, sample)}</span>}
                    </span>
                    <button className="link-button" onClick={() => toggleTag(t, false)} aria-label={`Remove ${t}`}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="segmented" role="radiogroup" aria-label="Tag layout">
              {(["stacked", "inline"] as const).map((layout) => (
                <label key={layout}>
                  <input
                    type="radio"
                    name="tag-layout"
                    checked={options.tagLayout === layout}
                    onChange={() => set({ tagLayout: layout })}
                  />
                  {layout === "stacked" ? "One line per property" : "Single line"}
                </label>
              ))}
            </div>
          </div>

          <details className="token-picker" open={!!sample}>
            <summary>
              Properties ({tokens.length}): tick = show in 3D tag, click = insert into “{TEXT_FIELDS.find((f) => f.key === active)?.label}”
            </summary>
            {!sample ? (
              <p className="muted">Select an object to list its properties.</p>
            ) : (
              <>
                <input
                  className="text-input"
                  placeholder="Filter properties…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <ul className="token-list">
                  <li>
                    <button className="token" onClick={() => insert(COUNT_TOKEN)}>
                      <code>{COUNT_TOKEN}</code>
                      <span className="muted">bars in group</span>
                    </button>
                  </li>
                  <li>
                    <button className="token" onClick={() => insert(CENTRES_TOKEN)}>
                      <code>{CENTRES_TOKEN}</code>
                      <span className="muted">bar centres, when even</span>
                    </button>
                  </li>
                  {visibleTokens.map((t) => (
                    <li key={t.token} className="token-row">
                      <input
                        type="checkbox"
                        title="Show in 3D property tag"
                        checked={options.tagTokens.includes(t.token)}
                        onChange={(e) => toggleTag(t.token, e.target.checked)}
                      />
                      <button className="token" onClick={() => insert(t.token)} title="Insert into the active field">
                        <code>{t.token}</code>
                        <span className="muted">{t.sample}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </details>

          {state.busy && <p className="muted">Drawing…</p>}
          {state.error && <p className="status-error">{state.error}</p>}
          {!state.busy && !state.result && !state.error && <p className="muted">Select objects to annotate them.</p>}
          {state.result && (
            <>
              <KeyValue
                rows={[
                  ["Objects", state.result.objectCount],
                  ["Markups drawn", state.result.markupIds.length],
                  ["Extent X (mm)", state.result.extents && Math.round(state.result.extents.x)],
                  ["Extent Y (mm)", state.result.extents && Math.round(state.result.extents.y)],
                  ["Extent Z (mm)", state.result.extents && Math.round(state.result.extents.z)],
                ]}
              />
              {state.result.groups.length > 0 && (
                <table className="group-table">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Spacing</th>
                      <th>From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.result.groups.map((g) => (
                      <tr key={g.label + g.spacing}>
                        <td>{g.label}</td>
                        <td>{g.spacing}</td>
                        <td className="muted">
                          {g.source === "ifc" || g.source === "property"
                            ? g.spacingFrom
                            : g.source === "measured"
                              ? "measured"
                              : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {state.result.groups.some((g) => g.source === "none") && (
                <p className="notice">
                  No spacing data in the model for{" "}
                  {state.result.groups
                    .filter((g) => g.source === "none")
                    .map((g) => g.label)
                    .join(", ")}
. Each is one object for the whole bar group and its properties hold no bar positions or spacing,
                  so the small dimensions (like <code>110 · 8*200</code>) can't be drawn from the selection alone.
                  Load the model's IFC file under <em>Bar positions from IFC</em> to draw them automatically, or
                  click each bar once.
                  <span className="button-row">
                    <button className="button primary" onClick={onStartPicking} disabled={picking}>
                      {picking ? "Picking… click the bars in 3D" : "Pick bars to add spacing"}
                    </button>
                  </span>
                </p>
              )}
            </>
          )}
          {state.result?.truncated && (
            <p className="muted">Only the first {MAX_ANNOTATED_OBJECTS} objects are annotated.</p>
          )}
        </>
      )}
    </>
  );
}
