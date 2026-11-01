import type { PickChainState } from "../trimble/usePickChain";

const ROUNDING = [0, 1, 5, 10];

export function PickChainPanel({ chain, hasSelection }: { chain: PickChainState; hasSelection: boolean }) {
  return (
    <>
      <p className="muted">
        Works even when a whole bar group is one object. Click each bar once; the chain is drawn as you go.
        {hasSelection
          ? " The current selection is used for the outer edges and the overall dimension."
          : " Select the mesh first to also get the edge distances and overall dimension."}
      </p>

      <div className="button-row">
        {!chain.active ? (
          <button className="button primary" onClick={chain.start}>
            {chain.picks.length ? "Start again" : "Start picking"}
          </button>
        ) : (
          <button className="button primary" onClick={chain.finish}>
            Finish
          </button>
        )}
        <button className="button" onClick={chain.undo} disabled={!chain.picks.length}>
          Undo last
        </button>
        <button className="button" onClick={chain.clear} disabled={!chain.picks.length && !chain.result}>
          Clear
        </button>
      </div>

      {chain.active && (
        <p className="notice">
          Picking is on: click the bars in the 3D view ({chain.picks.length} picked).
        </p>
      )}
      {chain.error && <p className="status-error">{chain.error}</p>}

      <label className="toggle">
        Round gaps to
        <select value={chain.roundTo} onChange={(e) => chain.setRoundTo(Number(e.target.value))}>
          {ROUNDING.map((r) => (
            <option key={r} value={r}>
              {r === 0 ? "off (raw)" : `${r} mm`}
            </option>
          ))}
        </select>
      </label>

      {chain.result && chain.result.groups.length > 0 && (
        <table className="group-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Picked</th>
              <th>Spacing</th>
            </tr>
          </thead>
          <tbody>
            {chain.result.groups.map((g) => (
              <tr key={g.label}>
                <td>{g.label}</td>
                <td className={g.expected !== null && g.picked < g.expected ? "warn-text" : undefined}>
                  {g.picked}
                  {g.expected !== null && ` of ${g.expected}`}
                </td>
                <td>{g.spacing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {chain.result?.groups.some((g) => g.expected !== null && g.picked < g.expected) && (
        <p className="muted">Pick every bar of a group to complete its chain; each bar once is enough.</p>
      )}
    </>
  );
}
