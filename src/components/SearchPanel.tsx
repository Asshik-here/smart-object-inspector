import { MAX_ANNOTATED_OBJECTS } from "../trimble/annotations";
import { entryKey, groupByCastUnit } from "../trimble/objectSearch";
import type { ObjectSearchState } from "../trimble/useObjectSearch";

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
  </svg>
);

/**
 * A cast unit's row: one tick for all of its bar groups (the whole mesh), partly ticked when only
 * some are. A mesh is several bar groups, and dimensioning only one of them misses the others.
 */
function UnitRow({ search, castUnit }: { search: ObjectSearchState; castUnit: string }) {
  const bars = search.unitBars(castUnit);
  const ticked = bars.filter((b) => search.checked.has(entryKey(b))).length;
  const all = bars.length > 0 && ticked === bars.length;
  return (
    <label className={`unit-row${all ? " active" : ""}`}>
      <input
        type="checkbox"
        checked={all}
        ref={(el) => {
          if (el) el.indeterminate = ticked > 0 && !all;
        }}
        onChange={() => search.toggleUnit(castUnit)}
        disabled={!bars.length}
      />
      <span className={`check${ticked > 0 && !all ? " partial" : ""}`} aria-hidden />
      <strong>{castUnit}</strong>
      <span className="muted">
        {bars.length} bar group{bars.length === 1 ? "" : "s"}
      </span>
    </label>
  );
}

interface Props {
  search: ObjectSearchState;
  showDimensions: boolean;
  onShowDimensionsChange: (show: boolean) => void;
}

/**
 * Find objects by name, bar mark, cast unit or any property value and tick them to select them.
 * Ticks and the 3D selection are the same: objects clicked in 3D appear ticked. Everything selected
 * is dimensioned once "Show dimensions" is switched on.
 */
export function SearchPanel({ search, showDimensions, onShowDimensionsChange }: Props) {
  const { query, results, total, progress, ready, checked } = search;
  const hasQuery = query.trim().length > 0;
  // Up to the annotation limit, "Select all" can tick every match.
  const canSelectMore = search.checkedMatches < Math.min(total, MAX_ANNOTATED_OBJECTS);

  return (
    <div className="search">
      <label className="search-field">
        <SearchIcon />
        <input
          type="search"
          placeholder="Search bar mark, name, cast unit…"
          value={query}
          onFocus={search.prepare}
          onChange={(e) => {
            search.prepare();
            search.setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0] && !checked.has(entryKey(results[0]))) search.toggle(results[0]);
            if (e.key === "Escape") search.setQuery("");
          }}
          aria-label="Search objects in the model"
        />
      </label>

      {progress && (
        <div className="search-progress" aria-live="polite">
          <span>Reading model… {progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%</span>
          <span className="progress-bar">
            <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </span>
        </div>
      )}

      {search.error && <p className="status-error">{search.error}</p>}

      {hasQuery && ready && (
        <>
          <div className="search-summary">
            <span className="muted">
              {total === 0 ? "No matches" : `${total} match${total === 1 ? "" : "es"}`}
              {total > results.length && ` · showing ${results.length}`}
            </span>
            {total > 0 && (
              <span className="bulk-actions">
                {canSelectMore && total > 1 && (
                  <button className="text-button" onClick={search.checkAllMatches}>
                    Select all
                  </button>
                )}
                {search.checkedMatches > 0 && (
                  <button className="text-button subtle" onClick={search.uncheckAllMatches}>
                    Unselect all
                  </button>
                )}
              </span>
            )}
          </div>
          {results.length > 0 && (
            <ul className="results" role="listbox" aria-label="Search results" aria-multiselectable>
              {groupByCastUnit(results).map((group) => (
                <li
                  key={group.castUnit || "—"}
                  className="result-group"
                  role="group"
                  aria-label={group.castUnit || "Other results"}
                >
                  {group.castUnit && <UnitRow search={search} castUnit={group.castUnit} />}
                  <ul className={group.castUnit ? "unit-members" : undefined}>
                    {group.results.map((r) => {
                      const on = checked.has(entryKey(r));
                      return (
                        <li key={entryKey(r)}>
                          <label className={`result${on ? " active" : ""}`} role="option" aria-selected={on}>
                            <input type="checkbox" checked={on} onChange={() => search.toggle(r)} />
                            <span className="check" aria-hidden />
                            <span className="result-text">
                              <strong>{r.title}</strong>
                              {r.subtitle && <span className="muted">{r.subtitle}</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Always shown: it reflects any selection, also objects clicked in the 3D view. */}
      <div className={`selection-bar${checked.size ? "" : " empty"}`} aria-live="polite">
        <span>{checked.size ? <><strong>{checked.size}</strong> selected</> : "Nothing selected"}</span>
        <label className="mini-switch">
          <input
            type="checkbox"
            role="switch"
            checked={showDimensions}
            onChange={(e) => onShowDimensionsChange(e.target.checked)}
          />
          <span className="mini-track" aria-hidden>
            <span className="mini-knob" />
          </span>
          Show dimensions
        </label>
        <button
          className="text-button"
          disabled={!checked.size}
          onClick={() => {
            search.clear();
            onShowDimensionsChange(false);
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
