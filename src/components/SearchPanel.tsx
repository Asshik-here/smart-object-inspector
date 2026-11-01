import { MAX_ANNOTATED_OBJECTS } from "../trimble/annotations";
import { entryKey } from "../trimble/objectSearch";
import type { ObjectSearchState } from "../trimble/useObjectSearch";

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
  </svg>
);

interface Props {
  search: ObjectSearchState;
  showDimensions: boolean;
  onShowDimensionsChange: (show: boolean) => void;
}

/**
 * Find objects by name, bar mark, cast unit or any property value and tick them to select them.
 * Their dimensions are shown in 3D once "Show dimensions" is switched on.
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
              {results.map((r) => {
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
          )}
        </>
      )}

      {checked.size > 0 && (
        <div className="selection-bar">
          <span>
            <strong>{checked.size}</strong> selected
          </span>
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
            onClick={() => {
              search.clear();
              onShowDimensionsChange(false);
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
