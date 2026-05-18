import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DASHBOARD_ENDPOINTS, INTEGRATIONS } from "../../lib/constants";

const AUTO_REFRESH_MS = 15000;

const STATE_CONFIG = {
  connected: {
    label: "Connected",
    tone: "ok",
    description: "Working correctly.",
  },
  configured: {
    label: "Set up",
    tone: "info",
    description: "Configured. Will run when needed.",
  },
  warning: {
    label: "Check settings",
    tone: "warn",
    description: "Configured, but something looks off.",
  },
  demo: {
    label: "Demo mode",
    tone: "warn",
    description: "Not connected. The tool will use a stand-in.",
  },
  error: {
    label: "Connection error",
    tone: "fail",
    description: "Tried to connect and failed.",
  },
  checking: {
    label: "Checking…",
    tone: "muted",
    description: "Testing the connection.",
  },
};

const TONE_COLORS = {
  ok: "var(--pass)",
  info: "var(--accent)",
  warn: "var(--warn)",
  fail: "var(--fail)",
  muted: "var(--faint)",
};

function endpointStatus(endpoint, result) {
  if (!result) return { tone: "muted", label: "Checking…" };
  const okStatuses = endpoint.okStatuses || null;
  const isOk = okStatuses ? okStatuses.includes(result.status) : result.ok;
  if (isOk) return { tone: "ok", label: "Working" };
  if (result.status) return { tone: "fail", label: "Not responding" };
  return { tone: "fail", label: "Offline" };
}

export default function DashboardTab({
  onRefresh,
  onCustomCheck,
  onFetchHealth,
  onFetchIntegrationsHealth,
}) {
  const [results, setResults] = useState([]);
  const [health, setHealth] = useState(null);
  const [integrationsData, setIntegrationsData] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [checking, setChecking] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("");
  const [customResult, setCustomResult] = useState("");

  const onRefreshRef = useRef(onRefresh);
  const onFetchHealthRef = useRef(onFetchHealth);
  const onFetchIntegrationsRef = useRef(onFetchIntegrationsHealth);
  onRefreshRef.current = onRefresh;
  onFetchHealthRef.current = onFetchHealth;
  onFetchIntegrationsRef.current = onFetchIntegrationsHealth;

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const [endpointResults, healthData, integrations] = await Promise.all([
        onRefreshRef.current(),
        onFetchHealthRef.current ? onFetchHealthRef.current() : Promise.resolve(null),
        onFetchIntegrationsRef.current ? onFetchIntegrationsRef.current() : Promise.resolve(null),
      ]);
      setResults(endpointResults);
      setHealth(healthData);
      setIntegrationsData(integrations);
      setLastUpdated(new Date());
    } finally {
      setChecking(false);
    }
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

  const integrationCards = useMemo(() => {
    const liveStatuses = integrationsData?.integrations || null;
    const fallbackStatuses = health?.integrations || null;

    return INTEGRATIONS.map((integration) => {
      const live = liveStatuses?.[integration.key];
      const fallback = fallbackStatuses?.[integration.key];

      let state;
      let message;

      if (live?.state) {
        state = live.state;
        message = live.message;
      } else if (fallback === "live") {
        state = "configured";
        message = "Configured.";
      } else if (fallback === "demo") {
        state = "demo";
        message = "Using demo stand-in.";
      } else {
        state = "checking";
        message = "Testing connection…";
      }

      return {
        ...integration,
        state,
        message,
      };
    });
  }, [integrationsData, health]);

  const overall = useMemo(() => {
    const states = integrationCards.map((card) => card.state);
    const errors = states.filter((state) => state === "error").length;
    const demos = states.filter((state) => state === "demo").length;
    const connected = states.filter((state) => state === "connected" || state === "configured").length;
    return { errors, demos, connected, total: integrationCards.length };
  }, [integrationCards]);

  const lastUpdatedLabel = lastUpdated
    ? `Last checked ${lastUpdated.toLocaleTimeString()}`
    : "Loading…";

  return (
    <>
      <div className="history-header stagger" style={{ animationDelay: "0ms" }}>
        <div>
          <span className="history-title">Tool Status</span>
          <div className="dashboard-subtle">{lastUpdatedLabel}</div>
        </div>
        <div className="dashboard-controls">
          <label className="dashboard-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            <span>Auto-refresh</span>
          </label>
          <button className="dashboard-refresh-btn" onClick={refresh} disabled={checking}>
            {checking ? "Checking…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      <div className="dashboard-banner stagger" style={{ animationDelay: "5ms" }}>
        <div className="dashboard-banner-row">
          <span className="dashboard-banner-pill" style={{ borderColor: "var(--pass-border)", color: "var(--pass)", background: "var(--pass-light)" }}>
            ● {overall.connected} connected
          </span>
          <span className="dashboard-banner-pill" style={{ borderColor: "var(--warn-border)", color: "var(--warn)", background: "var(--warn-light)" }}>
            ● {overall.demos} in demo mode
          </span>
          <span className="dashboard-banner-pill" style={{ borderColor: "var(--fail-border)", color: "var(--fail)", background: "var(--fail-light)" }}>
            ● {overall.errors} need attention
          </span>
        </div>
        <p className="dashboard-banner-help">
          This page shows whether each piece of the tool is working. <strong>Connected</strong> means it&apos;s live. <strong>Demo mode</strong> means no API key is set and the tool will use a stand-in instead. <strong>Connection error</strong> means a key is set but couldn&apos;t reach the service — usually a wrong key or wrong URL.
        </p>
      </div>

      <div className="dashboard-section stagger" style={{ animationDelay: "20ms" }}>
        <div className="dashboard-section-title">Integrations</div>
        <div className="dashboard-grid">
          {integrationCards.map((card) => {
            const config = STATE_CONFIG[card.state] || STATE_CONFIG.checking;
            const color = TONE_COLORS[config.tone] || TONE_COLORS.muted;
            return (
              <div key={card.key} className="dashboard-card dashboard-card-tall">
                <div className="dashboard-card-header">
                  <div className="dashboard-card-title">{card.label}</div>
                  <span
                    className="dashboard-status-pill"
                    style={{ color, borderColor: color, background: "var(--surface)" }}
                  >
                    <span className="dashboard-dot" style={{ background: color }} />
                    {config.label}
                  </span>
                </div>
                <div className="dashboard-card-blurb">{card.blurb}</div>
                <div className="dashboard-card-message" style={{ color }}>
                  {card.message || config.description}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="dashboard-section stagger" style={{ animationDelay: "30ms" }}>
        <div className="dashboard-section-title">Tool Services</div>
        <div className="dashboard-section-help">
          Each part of the QA tool that runs on this computer.
        </div>
        <div className="dashboard-grid">
          {DASHBOARD_ENDPOINTS.map((endpoint, index) => {
            const status = endpointStatus(endpoint, results[index]);
            const color = TONE_COLORS[status.tone] || TONE_COLORS.muted;
            const result = results[index];
            return (
              <div key={`${endpoint.method}-${endpoint.path}`} className="dashboard-card">
                <div className="dashboard-card-header">
                  <div className="dashboard-card-title">{endpoint.label}</div>
                  <span
                    className="dashboard-status-pill"
                    style={{ color, borderColor: color, background: "var(--surface)" }}
                  >
                    <span
                      className="dashboard-dot"
                      style={{
                        background: color,
                        animation: status.tone === "muted" ? "blink 1.2s ease-in-out infinite" : "none",
                      }}
                    />
                    {status.label}
                  </span>
                </div>
                <div className="dashboard-card-blurb">{endpoint.description}</div>
                {result ? (
                  <div className="dashboard-card-meta">
                    Responded in {result.latency}ms
                    <span className="dashboard-card-meta-divider">·</span>
                    <span className="dashboard-card-meta-mono">{endpoint.method} {endpoint.path}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="dashboard-section stagger" style={{ animationDelay: "40ms" }}>
        <button
          className="dashboard-advanced-toggle"
          onClick={() => setShowAdvanced((current) => !current)}
        >
          {showAdvanced ? "Hide advanced" : "Show advanced"}
        </button>
        {showAdvanced ? (
          <div className="dashboard-advanced">
            <div className="dashboard-section-title" style={{ marginTop: 12 }}>Custom Endpoint Check</div>
            <div className="dashboard-section-help">
              For developers — call any path on the local backend and see the response.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <select className="settings-select" style={{ marginTop: 0, width: 90 }} value={method} onChange={(event) => setMethod(event.target.value)}>
                <option>GET</option>
                <option>POST</option>
              </select>
              <input className="settings-input" style={{ flex: 1, minWidth: 160, marginTop: 0 }} placeholder="/api/path" value={path} onChange={(event) => setPath(event.target.value)} />
              <button className="run-btn" style={{ fontSize: 13, padding: "8px 16px" }} onClick={handleCustomCheck}>Check</button>
            </div>
            <div style={{ marginTop: 10 }}>{customResult}</div>
          </div>
        ) : null}
      </div>
    </>
  );
}
