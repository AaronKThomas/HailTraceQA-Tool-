import { useState } from "react";
import ExportMenu from "../ExportMenu";
import { EXPORT_FORMATS } from "../../lib/export";
import { useExportConfirmation } from "../../hooks/useExportConfirmation";

function SuiteExportMenu({ suite, exportDefaultFormat, onExportSuiteReport }) {
  const { requestExport, exportModal } = useExportConfirmation(
    (format) => onExportSuiteReport(suite.id, format),
    {
      title: `Export "${suite.name}"?`,
      getDescription: (format) => {
        const label = EXPORT_FORMATS.find((entry) => entry.id === format)?.label || "file";
        const count = suite.tests.length;
        return `Export ${count} test${count === 1 ? "" : "s"} from this suite as ${label}.`;
      },
    },
  );

  return (
    <>
      <ExportMenu label="Export suite" compact defaultFormat={exportDefaultFormat} onExport={requestExport} />
      {exportModal}
    </>
  );
}

export default function SuitesTab({
  suites,
  history,
  templates,
  onCreate,
  onDelete,
  onClone,
  onSchedule,
  onAddSuiteTest,
  onRemoveSuiteTest,
  onRunSuite,
  onRunSingleSuiteTest,
  onExportSuiteReport,
  onImportDescription,
  exportDefaultFormat,
}) {
  const [name, setName] = useState("");
  const [openSuiteIds, setOpenSuiteIds] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [importMode, setImportMode] = useState({});

  function toggleSuite(id) {
    setOpenSuiteIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function getImportCandidates(suiteId) {
    if (importMode[suiteId] === "history") {
      return [...new Map(history.map((entry) => [entry.description, entry])).values()].slice(0, 10).map((entry) => ({
        key: entry.id,
        title: entry.description,
        description: entry.description,
      }));
    }
    if (importMode[suiteId] === "templates") {
      return templates.map((template) => ({
        key: template.id,
        title: template.name,
        description: template.description,
      }));
    }
    return [];
  }

  return (
    <>
      <div className="history-header stagger" style={{ animationDelay: "0ms" }}>
        <div><span className="history-title">Test Suites</span><span className="history-meta">{suites.length} suite{suites.length !== 1 ? "s" : ""}</span></div>
      </div>
      <p className="tab-description stagger" style={{ animationDelay: "10ms" }}>
        <strong>Purpose:</strong> Group related tests and run them together.{" "}
        <strong>Use case:</strong> Build smoke or regression checks (e.g. login flow, map features), run the whole suite with one click, optionally schedule it <strong>On Login</strong>, and track pass/fail counts. Import tests from history or templates, or add descriptions manually.
      </p>

      <div className="input-card stagger" style={{ animationDelay: "20ms" }}>
        <div className="input-header"><span className="input-label">New Suite</span></div>
        <div style={{ padding: "12px 16px", display: "flex", gap: 8 }}>
          <input className="settings-input" style={{ flex: 1, marginTop: 0 }} placeholder="Suite name e.g. Login Flow, Map Features…" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && (onCreate(name), setName(""))} />
          <button className="run-btn" style={{ fontSize: 13, padding: "8px 18px", minHeight: 36 }} onClick={() => { onCreate(name); setName(""); }}>Create</button>
        </div>
      </div>

      {suites.length === 0 ? (
        <div className="empty-state stagger" style={{ animationDelay: "40ms" }}>
          <h2>No suites yet</h2>
          <p>Create a suite above, add test descriptions, then run them together or on login</p>
        </div>
      ) : suites.map((suite, index) => {
        const isOpen = openSuiteIds.includes(suite.id);
        const candidates = getImportCandidates(suite.id);
        return (
          <div key={suite.id} className="suite-card stagger" style={{ animationDelay: `${index * 20}ms`, marginBottom: 10 }}>
            <div className="suite-header" onClick={() => toggleSuite(suite.id)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="suite-name">{suite.name}</span>
                  <span className="suite-count">{suite.tests.length} test{suite.tests.length !== 1 ? "s" : ""}</span>
                  {suite.lastRun ? <span style={{ fontSize: 11, color: "var(--muted)" }}>Last run: {new Date(suite.lastRun).toLocaleDateString([], { month: "short", day: "numeric" })} · <span style={{ color: "var(--pass)" }}>✓{suite.lastPass || 0}</span> <span style={{ color: "var(--fail)" }}>✗{suite.lastFail || 0}</span>{suite.lastManual ? <span style={{ color: "var(--warn)" }}> ⚠{suite.lastManual}</span> : null}</span> : null}
                </div>
                {suite.schedule ? <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 2 }}>⏰ {suite.schedule}</div> : null}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={(event) => event.stopPropagation()}>
                <button className="suite-run-btn" onClick={() => onRunSuite(suite.id)}>▶ Run</button>
                <button className="del-btn" onClick={() => onClone(suite.id)}>Clone</button>
                <button className="del-btn" onClick={() => onDelete(suite.id)}>Delete</button>
              </div>
            </div>
            <div className={`suite-body ${isOpen ? "open" : ""}`}>
              {suite.tests.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--muted)", padding: "8px 0" }}>No tests yet — add some below</div>
              ) : suite.tests.map((test) => (
                <div key={test.id} className="suite-test-item">
                  <span style={{ cursor: "grab", color: "var(--faint)", marginRight: 6 }}>⠿</span>
                  <span style={{ flex: 1 }}>{test.description.slice(0, 80)}{test.description.length > 80 ? "…" : ""}</span>
                  <button className="rerun-btn" style={{ fontSize: 11, padding: "2px 8px", marginRight: 4 }} onClick={() => onRunSingleSuiteTest(suite.id, test.id)}>▶</button>
                  <button className="remove-btn" onClick={() => onRemoveSuiteTest(suite.id, test.id)}>×</button>
                </div>
              ))}

              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Schedule</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {["Off", "On Login"].map((value) => (
                    <button key={value} className={`filter-btn ${(suite.schedule || "Off") === value ? "active" : ""}`} onClick={() => onSchedule(suite.id, value)}>{value}</button>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Import</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="filter-btn" onClick={() => setImportMode((current) => ({ ...current, [suite.id]: current[suite.id] === "history" ? null : "history" }))}>From History</button>
                  <button className="filter-btn" onClick={() => setImportMode((current) => ({ ...current, [suite.id]: current[suite.id] === "templates" ? null : "templates" }))}>From Templates</button>
                </div>
                {importMode[suite.id] ? (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {candidates.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>No {importMode[suite.id]} yet</div>
                    ) : candidates.map((candidate) => (
                      <div key={candidate.key} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-high)", borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{candidate.title.slice(0, 70)}{candidate.title.length > 70 ? "…" : ""}</div>
                          {importMode[suite.id] === "templates" ? <div style={{ fontSize: 11, color: "var(--muted)" }}>{candidate.description.slice(0, 50)}{candidate.description.length > 50 ? "…" : ""}</div> : null}
                        </div>
                        <button className="use-btn" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => onImportDescription(suite.id, candidate.description)}>Add</button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
                <SuiteExportMenu
                  suite={suite}
                  exportDefaultFormat={exportDefaultFormat}
                  onExportSuiteReport={onExportSuiteReport}
                />
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <input className="settings-input" style={{ flex: 1, marginTop: 0 }} placeholder="Add test description…" value={drafts[suite.id] || ""} onChange={(event) => setDrafts((current) => ({ ...current, [suite.id]: event.target.value }))} onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onAddSuiteTest(suite.id, drafts[suite.id] || "");
                    setDrafts((current) => ({ ...current, [suite.id]: "" }));
                  }
                }} />
                <button className="use-btn" onClick={() => { onAddSuiteTest(suite.id, drafts[suite.id] || ""); setDrafts((current) => ({ ...current, [suite.id]: "" })); }}>Add</button>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
