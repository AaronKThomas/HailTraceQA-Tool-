import { STATUS_CONFIG } from "../../lib/constants";

export default function HistoryTab({
  currentUser,
  history,
  filter,
  search,
  setFilter,
  setSearch,
  onClear,
  onRerun,
}) {
  const filtered = history.filter((entry) => {
    const matchesFilter = filter === "all" || entry.status === filter;
    const normalizedSearch = search.toLowerCase();
    const matchesSearch = !search || entry.description.toLowerCase().includes(normalizedSearch) || (entry.jiraKey || "").toLowerCase().includes(normalizedSearch);
    return matchesFilter && matchesSearch;
  });

  return (
    <>
      <div className="history-header stagger" style={{ animationDelay: "0ms" }}>
        <div>
          <span className="history-title">{currentUser.displayName}'s History</span>
          <span className="history-meta">{history.length} total runs</span>
        </div>
        {history.length > 0 ? <button className="ghost-btn" onClick={onClear}>Clear</button> : null}
      </div>
      <div className="history-search-wrap stagger" style={{ animationDelay: "20ms" }}>
        <label className="sr-only" htmlFor="history-search">Search test history</label>
        <span className="history-search-icon" aria-hidden="true">⌕</span>
        <input id="history-search" placeholder="Search history…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className="history-filter-row stagger" style={{ animationDelay: "30ms" }} role="group" aria-label="Filter history by result">
        {["all", "pass", "fail", "manual"].map((value) => (
          <button key={value} type="button" className={`filter-btn ${filter === value ? "active" : ""}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === "all" ? "All" : STATUS_CONFIG[value]?.label || value}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state stagger" style={{ animationDelay: "40ms" }}>
          <h2>{history.length === 0 ? "No history yet" : "No results"}</h2>
          <p>{history.length === 0 ? "Completed tests will appear here" : "Try a different search or filter"}</p>
        </div>
      ) : (
        <div className="tests-list" aria-label="History results">
          {filtered.map((entry, index) => {
            const config = STATUS_CONFIG[entry.status];
            const icon = entry.status === "pass" ? "✓" : entry.status === "manual" ? "⚠" : "✗";
            const date = new Date(entry.timestamp);
            return (
              <article key={entry.id} className="history-item stagger" style={{ animationDelay: `${index * 10}ms`, background: config.bg, borderColor: config.border, borderLeftColor: config.dot }}>
                <span className="history-icon" style={{ color: config.dot }} aria-hidden="true">{icon}</span>
                <div className="history-body">
                  {entry.jiraKey ? <span className="history-jira">{entry.jiraKey}</span> : null}
                  <div className="history-desc" style={{ color: "var(--text)" }}>{entry.description}{entry.description.length >= 120 ? "…" : ""}</div>
                  <div className="history-footer">
                    <span className="tag" style={{ background: config.bg, borderColor: config.border, color: config.text }}>
                      <span className="tag-dot" style={{ background: config.dot }} />
                      {config.label}
                    </span>
                    <span className="history-time">{date.toLocaleDateString([], { month: "short", day: "numeric" })} · {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <button type="button" className="rerun-btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => onRerun(entry)}>↺ Re-run</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
