import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DASHBOARD_ENDPOINTS, INTEGRATION_LABELS } from "../../lib/constants";

const AUTO_REFRESH_MS = 15000;

function statusFor(endpoint, result) {
  if (!result) return { tone: "checking", label: "Checking…" };
  const okStatuses = endpoint.okStatuses || null;
  const isOk = okStatuses ? okStatuses.includes(result.status) : result.ok;

  if (isOk) {
    const note = endpoint.okStatuses && result.status !== 200 ? ` (validated)` : "";
    return { tone: "ok", label: `Online (${result.status})${note}` };
  }
  if (result.status) return { tone: "fail", label: `Error (${result.status})` };
  return { tone: "fail", label: "Unreachable" };
}

function integrationDetail(name, health) {
  const details = health?.details || {};
  if (name === "openai" && details.openaiModel) return `Model: ${details.openaiModel}`;
  if (name === "hailtrace" && details.hailtraceHost) {
    return `${details.hailtraceHost}${details.hailtraceQaPath || ""}`;
  }
  if (name === "jira" && details.jiraHost) return details.jiraHost;
  if (name === "slack") return details.slackConfigured ? "Webhook configured" : "Webhook not set";
  return "";
}

export default function DashboardTab({ onRefresh, onCustomCheck, onFetchHealth }) {
  const [results, setResults] = useState([]);
  const [health, setHealth] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("");
  const [customResult, setCustomResult] = useState("");

  const onRefreshRef = useRef(onRefresh);
  const onFetchHealthRef = useRef(onFetchHealth);
  onRefreshRef.current = onRefresh;
  onFetchHealthRef.current = onFetchHealth;

  const refresh = useCallback(async () => {
    const [endpointResults, healthData] = await Promise.all([
      onRefreshRef.current(),
      onFetchHealthRef.current ? onFetchHealthRef.current() : Promise.resolve(null),
    ]);
    setResults(endpointResults);
    setHealth(healthData);
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    let active = true;
    refresh().catch(() => {
      if (active) setLastUpdated(new Date());
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = window.setInterval(() => {
      refresh().catch(() => {});
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, refresh]);

  async function handleCustomCheck() {
    if (!path.trim()) return;
    const result = await onCustomCheck(path.trim(), method);
    setCustomResult(`${result.ok ? "✓" : "✗"} ${result.status || "Unreachable"} ${result.statusText || ""} — ${result.latency}ms`);
  }

  const integrations = useMemo(() => {
    if (!health?.integrations) return [];
    return Object.entries(health.integrations).map(([key, status]) => ({
      key,
      label: INTEGRATION_LABELS[key] || key,
      status,
      detail: integrationDetail(key, health),
    }));
  }, [health]);

  const lastUpdatedLabel = lastUpdated
    ? `Last updated ${lastUpdated.toLocaleTimeString()}`
    : "Loading…";

  return (
    <>
      <div className="history-header stagger" style={{ animationDelay: "0ms" }}>
        <div>
          <span className="history-title">API Health Dashboard</span>
          <div className="dashboard-subtle">{lastUpdatedLabel}</div>
        </div>
        <div className="dashboard-controls">
          <label className="dashboard-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            <span>Auto-refresh (15s)</span>
          </label>
          <button className="dashboard-refresh-btn" onClick={refresh}>↻ Refresh</button>
        </div>
      </div>

      <div className="dashboard-section stagger" style={{ animationDelay: "10ms" }}>
        <div className="output-section-label" style={{ marginBottom: 10 }}>Integrations</div>
        {integrations.length === 0 ? (
          <div className="dashboard-subtle">Connect to the backend to see integration status.</div>
        ) : (
          <div className="dashboard-grid">
            {integrations.map((integration) => {
              const isLive = integration.status === "live";
              return (
                <div key={integration.key} className="dashboard-card">
                  <div className="dashboard-endpoint">{integration.label}</div>
                  <div className="dashboard-status">
                    <div
                      className="dashboard-dot"
                      style={{ background: isLive ? "var(--pass)" : "var(--warn)" }}
                    />
                    <span
                      className="dashboard-label"
                      style={{ color: isLive ? "var(--pass)" : "var(--warn)" }}
                    >
                      {isLive ? "Live" : "Demo"}
                    </span>
                  </div>
                  {integration.detail ? (
                    <div className="dashboard-detail">{integration.detail}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="dashboard-section stagger" style={{ animationDelay: "20ms" }}>
        <div className="output-section-label" style={{ marginBottom: 10 }}>Backend Endpoints</div>
        <div className="dashboard-grid">
          {DASHBOARD_ENDPOINTS.map((endpoint, index) => {
            const status = statusFor(endpoint, results[index]);
            const result = results[index];
            const dotColor =
              status.tone === "ok" ? "var(--pass)"
                : status.tone === "fail" ? "var(--fail)"
                  : "var(--faint)";
            return (
              <div key={`${endpoint.method}-${endpoint.path}`} className="dashboard-card">
                <div className="dashboard-endpoint">{endpoint.method} {endpoint.path}</div>
                <div className="dashboard-status">
                  <div
                    className="dashboard-dot"
                    style={{
                      background: dotColor,
                      animation: status.tone === "checking" ? "blink 1.2s ease-in-out infinite" : "none",
                    }}
                  />
                  <span
                    className="dashboard-label"
                    style={{ color: dotColor === "var(--faint)" ? "var(--muted)" : dotColor }}
                  >
                    {status.label}
                  </span>
                  <span className="dashboard-latency">{result ? `${result.latency}ms` : ""}</span>
                </div>
              </div>
            );
          })}
        </div>
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
