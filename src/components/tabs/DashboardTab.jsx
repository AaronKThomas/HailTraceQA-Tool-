import { useEffect, useState } from "react";
import { DASHBOARD_ENDPOINTS } from "../../lib/constants";

export default function DashboardTab({ onRefresh, onCustomCheck }) {
  const [results, setResults] = useState([]);
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("");
  const [customResult, setCustomResult] = useState("");

  useEffect(() => {
    let active = true;
    onRefresh().then((nextResults) => {
      if (active) setResults(nextResults);
    });
    return () => {
      active = false;
    };
  }, [onRefresh]);

  async function refresh() {
    setResults(await onRefresh());
  }

  async function handleCustomCheck() {
    if (!path.trim()) return;
    const result = await onCustomCheck(path.trim(), method);
    setCustomResult(`${result.ok ? "✓" : "✗"} ${result.status || "Unreachable"} ${result.statusText || ""} — ${result.latency}ms`);
  }

  return (
    <>
      <div className="history-header stagger" style={{ animationDelay: "0ms" }}>
        <div><span className="history-title">API Health Dashboard</span></div>
        <button className="dashboard-refresh-btn" onClick={refresh}>↻ Refresh</button>
      </div>
      <div className="dashboard-grid stagger" style={{ animationDelay: "20ms" }}>
        {DASHBOARD_ENDPOINTS.map((endpoint, index) => {
          const result = results[index];
          const isOk = result?.ok;
          return (
            <div key={`${endpoint.method}-${endpoint.path}`} className="dashboard-card">
              <div className="dashboard-endpoint">{endpoint.method} {endpoint.path}</div>
              <div className="dashboard-status">
                <div className="dashboard-dot" style={{ background: result ? (isOk ? "var(--pass)" : "var(--fail)") : "var(--faint)", animation: result ? "none" : "blink 1.2s ease-in-out infinite" }} />
                <span className="dashboard-label" style={{ color: result ? (isOk ? "var(--pass)" : "var(--fail)") : "var(--muted)" }}>
                  {!result ? "Checking…" : isOk ? `Online (${result.status})` : result.status ? `Error (${result.status})` : "Unreachable"}
                </span>
                <span className="dashboard-latency">{result ? `${result.latency}ms` : ""}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="stagger" style={{ animationDelay: "60ms" }}>
        <div className="output-section-label" style={{ marginBottom: 8 }}>Custom Endpoint Check</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="settings-select" style={{ marginTop: 0, width: 90 }} value={method} onChange={(event) => setMethod(event.target.value)}>
            <option>GET</option>
            <option>POST</option>
          </select>
          <input className="settings-input" style={{ flex: 1, minWidth: 160, marginTop: 0 }} placeholder="/api/path" value={path} onChange={(event) => setPath(event.target.value)} />
          <button className="run-btn" style={{ fontSize: 13, padding: "8px 16px" }} onClick={handleCustomCheck}>Check</button>
        </div>
        <div style={{ marginTop: 10 }}>{customResult}</div>
      </div>
    </>
  );
}
