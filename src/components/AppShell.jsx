import { useState } from "react";
import ExportMenu from "./ExportMenu";
import { EXPORT_FORMATS } from "../lib/export";
import { useExportConfirmation } from "../hooks/useExportConfirmation";

const SIDEBAR_NAV = [
  { id: "tests", label: "Tests", icon: "▶" },
  { id: "history", label: "History", icon: "↻" },
  { id: "templates", label: "Templates", icon: "📋" },
  { id: "suites", label: "Test Suites", icon: "🧪" },
  { id: "dashboard", label: "API Dashboard", icon: "📊" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export default function AppShell({
  activeTab,
  onTabChange,
  currentUser,
  onLogout,
  onExport,
  exportDefaultFormat,
  onClearTests,
  showExport,
  exportDisabled = false,
  showClear,
  stats,
  serverStatus,
  dropdownOpen,
  setDropdownOpen,
  children,
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const serverColor = serverStatus === "ok" ? "var(--pass)" : serverStatus === "error" ? "var(--fail)" : "var(--faint)";
  const serverLabel = serverStatus === "ok" ? "Server online" : serverStatus === "error" ? "Server offline" : "Checking…";
  const ran = stats.pass + stats.fail + stats.manual;

  const { requestExport, exportModal } = useExportConfirmation(onExport, {
    title: "Export test results?",
    getDescription: (format) => {
      const label = EXPORT_FORMATS.find((entry) => entry.id === format)?.label || "file";
      return `Your current test list will be saved as ${label}.`;
    },
  });

  return (
    <div id="app" className={`visible ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`desktop-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="desktop-sidebar-inner">
          <div className="desktop-brand">
            <div className="desktop-brand-mark">HT</div>
            <div className="desktop-brand-copy">
              <div className="desktop-brand-title">HailTrace QA</div>
              <div className="desktop-brand-subtitle">Team workspace</div>
            </div>
            <button className="desktop-sidebar-toggle" onClick={() => setSidebarCollapsed((current) => !current)} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {sidebarCollapsed ? "→" : "←"}
            </button>
          </div>

          <div className="desktop-sidebar-user">
            <div className="dropdown-user-avatar">{currentUser.displayName?.[0] || "?"}</div>
            <div className="desktop-sidebar-copy">
              <div className="dropdown-user-name">{currentUser.displayName}</div>
              <div className="dropdown-user-role">QA Tester</div>
            </div>
          </div>

          <div className="desktop-sidebar-section">
            <div className="desktop-sidebar-label">Navigation</div>
            {SIDEBAR_NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`desktop-sidebar-link ${activeTab === item.id ? "active" : ""}`}
                onClick={() => onTabChange(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-current={activeTab === item.id ? "page" : undefined}
              >
                <span className="desktop-sidebar-link-icon" aria-hidden="true">{item.icon}</span>
                <span className="desktop-sidebar-copy">{item.label}</span>
              </button>
            ))}
          </div>

          {ran > 0 ? (
            <div className="desktop-sidebar-section">
              <div className="desktop-sidebar-label">Run Summary</div>
              <div className="desktop-sidebar-stats">
                <span className="s-pass">✓ {stats.pass}</span>
                <span className="s-fail">✗ {stats.fail}</span>
                {stats.manual > 0 ? <span className="s-warn">⚠ {stats.manual}</span> : null}
              </div>
            </div>
          ) : null}

          <div className="desktop-sidebar-section">
            <div className="desktop-sidebar-label">Connection</div>
            <div className="desktop-sidebar-status">
              <div className="server-dot" style={{ background: serverColor }} />
              <span style={{ color: serverStatus === "error" ? "var(--fail)" : "var(--muted)" }}>{serverLabel}</span>
            </div>
          </div>

          <div className="desktop-sidebar-actions">
            {showExport ? (
              <ExportMenu
                compact={sidebarCollapsed}
                label={sidebarCollapsed ? "Ex" : "Export"}
                defaultFormat={exportDefaultFormat}
                onExport={requestExport}
                disabled={exportDisabled}
                className={sidebarCollapsed ? "sidebar-collapsed-export" : ""}
              />
            ) : null}
            {showClear ? <button className="ghost-btn" data-short="Cl" onClick={onClearTests}>Clear</button> : null}
            <button className="ghost-btn sign-out-btn" data-short="Out" onClick={onLogout}>Sign out</button>
          </div>
        </div>
      </aside>

      {exportModal}
      <div className="app-stage">
      <nav>
        <div className="nav-left">
          <span className="nav-title">HailTrace QA</span>
          <div className="server-indicator">
            <div className="server-dot" style={{ background: serverColor }} />
            <span className="server-label" style={{ color: serverStatus === "error" ? "var(--fail)" : "var(--muted)" }}>{serverLabel}</span>
          </div>
        </div>
        <div className="nav-center">
          <button className={`tab-btn ${activeTab === "tests" ? "active" : ""}`} onClick={() => onTabChange("tests")}>Tests</button>
          <button className={`tab-btn ${activeTab === "history" ? "active" : ""}`} onClick={() => onTabChange("history")}>
            History
          </button>
        </div>
        <div className="nav-right">
          {ran > 0 ? (
            <div className="nav-stats" style={{ display: "flex" }}>
              <span className="s-pass">✓ {stats.pass}</span>
              <span className="s-fail">✗ {stats.fail}</span>
              {stats.manual > 0 ? <span className="s-warn">⚠ {stats.manual}</span> : null}
            </div>
          ) : null}
          {showExport ? (
            <ExportMenu compact defaultFormat={exportDefaultFormat} onExport={requestExport} disabled={exportDisabled} />
          ) : null}
          {showClear ? <button className="ghost-btn" onClick={onClearTests}>Clear</button> : null}
          <div className="avatar">{currentUser.displayName?.[0] || "?"}</div>
          <button className="ghost-btn sign-out-btn" onClick={onLogout}>Sign out</button>
          <button className={`hamburger ${dropdownOpen ? "open" : ""}`} onClick={() => setDropdownOpen((current) => !current)} aria-label="Menu">
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>

      <div className={`dropdown-menu ${dropdownOpen ? "show" : ""}`}>
        <div className="dropdown-user">
          <div className="dropdown-user-avatar">{currentUser.displayName?.[0] || "?"}</div>
          <div>
            <div className="dropdown-user-name">{currentUser.displayName}</div>
            <div className="dropdown-user-role">QA Tester</div>
          </div>
        </div>
        {ran > 0 ? (
          <div className="dropdown-stats" style={{ display: "flex" }}>
            <div className="dropdown-stat"><span className="dropdown-stat-val s-pass">{stats.pass}</span><span className="dropdown-stat-label">Pass</span></div>
            <div className="dropdown-stat"><span className="dropdown-stat-val s-fail">{stats.fail}</span><span className="dropdown-stat-label">Fail</span></div>
            <div className="dropdown-stat"><span className="dropdown-stat-val s-warn">{stats.manual}</span><span className="dropdown-stat-label">Manual</span></div>
          </div>
        ) : null}
        <div className="dropdown-section">
          <div className="server-indicator" style={{ padding: "8px 12px", gap: 8 }}>
            <div className="server-dot" style={{ background: serverColor }} />
            <span style={{ fontSize: 13, color: serverStatus === "error" ? "var(--fail)" : "var(--muted)" }}>{serverLabel}</span>
          </div>
        </div>
        <div className="dropdown-section">
          {showExport ? EXPORT_FORMATS.map((format) => (
            <button
              key={format.id}
              className="dropdown-item"
              onClick={() => { requestExport(format.id); setDropdownOpen(false); }}
            >
              <span className="dropdown-item-icon">↓</span>
              Export {format.label}
            </button>
          )) : null}
          <button className="dropdown-item" onClick={() => { onClearTests(); setDropdownOpen(false); }}><span className="dropdown-item-icon">⊘</span> Clear Tests</button>
          <button className="dropdown-item" onClick={() => { onTabChange("settings"); setDropdownOpen(false); }}><span className="dropdown-item-icon">⚙</span> Settings</button>
          <button className="dropdown-item" onClick={() => { onTabChange("templates"); setDropdownOpen(false); }}><span className="dropdown-item-icon">📋</span> Templates</button>
          <button className="dropdown-item" onClick={() => { onTabChange("suites"); setDropdownOpen(false); }}><span className="dropdown-item-icon">🧪</span> Test Suites</button>
          <button className="dropdown-item" onClick={() => { onTabChange("dashboard"); setDropdownOpen(false); }}><span className="dropdown-item-icon">📊</span> API Dashboard</button>
        </div>
        <div className="dropdown-section">
          <button className="dropdown-item destructive" onClick={onLogout}><span className="dropdown-item-icon">→</span> Sign Out</button>
        </div>
      </div>

      <div id="offline-banner" className={serverStatus === "error" ? "show" : ""}>
        <span>●</span>
        <span>Server offline. {currentUser ? "Backend not reachable." : ""}</span>
      </div>

      <div className="main">
        <div id="tab-content">{children}</div>
      </div>
      </div>
    </div>
  );
}
