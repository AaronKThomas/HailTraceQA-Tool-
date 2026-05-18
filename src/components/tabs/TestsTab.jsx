import { useMemo, useState } from "react";
import { STATUS, STATUS_CONFIG } from "../../lib/constants";
import { parseJiraUrl, parseOutput } from "../../lib/utils";

function RecommendationsList({ items }) {
  return (
    <div className="recommendation-list">
      {items.map((item, index) => (
        <div key={`${item.title}-${index}`} className="recommendation-item">
          <div className="recommendation-title">{index + 1}. {item.title}</div>
          <div className="recommendation-description">{item.description}</div>
        </div>
      ))}
    </div>
  );
}

function TestDetail({ test }) {
  const sections = parseOutput(test.output);

  return (
    <div className="test-detail open">
      {test.output ? (
        sections.length ? (
          <div className="output-sections">
            {sections.filter((section) => section.header !== "VERDICT").map((section) => (
              <div key={section.header}>
                <div className="output-section-label">{section.header}</div>
                {section.header === "RECOMMENDATIONS" && test.recommendations?.length ? (
                  <RecommendationsList items={test.recommendations} />
                ) : (
                  <div className="output-section-content">{section.content}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="output-section-content">{test.output}</div>
        )
      ) : null}

      {test.apiResults?.length ? (
        <div className="api-results">
          <div className="output-section-label">Live API Calls</div>
          {test.apiResults.map((result, index) => {
            const isError = result.error || !result.result?.ok;
            return (
              <div key={`${result.endpoint || "api"}-${index}`} className="api-result-item" style={{ background: isError ? "var(--fail-light)" : "var(--pass-light)", border: `1px solid ${isError ? "var(--fail-border)" : "var(--pass-border)"}` }}>
                <div className="api-result-row">
                  <span className="api-method" style={{ color: isError ? "var(--fail)" : "var(--pass)" }}>
                    {(result.type || "REST").toUpperCase()} {result.method || ""} {result.endpoint || "graphql"}
                  </span>
                  {result.result?.status ? <span className="api-status-badge">{result.result.status}</span> : null}
                </div>
                <div className="api-desc">{result.description || ""}</div>
                {result.error ? <div className="api-error" style={{ color: "var(--fail)" }}>{result.error}</div> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {test.playwrightLog ? (
        <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <div className="output-section-label">Execution Log</div>
          <pre style={{ fontSize: 12, lineHeight: 1.6, color: "var(--muted)", background: "var(--bg)", borderRadius: 8, padding: "12px 14px", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--mono)", border: "1px solid var(--border)" }}>{test.playwrightLog}</pre>
        </div>
      ) : null}
    </div>
  );
}

export default function TestsTab({
  tests,
  running,
  fetchingJira,
  onInitiateTest,
  onRemoveTest,
  onRerunTest,
  onSaveAsTemplate,
  draftInput,
  setDraftInput,
}) {
  const [openDetailId, setOpenDetailId] = useState(null);

  const jiraDetected = useMemo(() => parseJiraUrl(draftInput.trim()), [draftInput]);

  async function handleRun() {
    const raw = draftInput.trim();
    if (!raw) return;
    setDraftInput("");
    await onInitiateTest(raw);
  }

  return (
    <>
      <div className="input-card stagger" style={{ animationDelay: "0ms" }}>
        <div className="input-header">
          <span className="input-label">New Test</span>
          <div className="input-header-meta">
            <span className="jira-hint" style={{ display: jiraDetected ? "inline-flex" : "none" }}>Jira ticket detected</span>
            <span className="powered-by">Powered by OpenAI</span>
          </div>
        </div>
        <textarea
          id="test-input"
          value={draftInput}
          disabled={running}
          placeholder={"Describe a feature to test, or paste a Jira URL / key (one per line)\n\nExamples:\n  • User should be able to submit a hail damage report\n  • HT-108\n  • https://yourcompany.atlassian.net/browse/HT-108"}
          onChange={(event) => setDraftInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              handleRun();
            }
          }}
        />
        <div className="input-footer">
          <div className={`progress-bar-wrap ${running ? "show" : ""}`}><div className="progress-bar-fill" /></div>
          <div className="input-actions">
            <span className="input-hint">{running ? "Running…" : ""}</span>
            <button className={`run-btn ${running ? "running" : ""}`} disabled={!draftInput.trim() || running || fetchingJira} onClick={handleRun}>
              {running ? <><span className="spinner" /> Analyzing…</> : "Run Test"}
            </button>
          </div>
        </div>
      </div>

      <div id="tests-list-wrap">
        {tests.length === 0 ? (
          <div className="empty-state stagger" style={{ animationDelay: "30ms" }}>
            <h2>No tests yet</h2>
            <p>Describe a feature or paste a Jira URL above</p>
          </div>
        ) : (
          <>
            <div className="tests-count">{tests.length} {tests.length === 1 ? "test" : "tests"}</div>
            <div className="tests-list">
              {tests.map((test, index) => {
                const config = STATUS_CONFIG[test.status];
                const hasOutput = (test.output || test.playwrightLog || test.apiResults?.length) && test.status !== STATUS.idle;
                const isRunning = test.status === STATUS.running;
                const isCompleted = test.status !== STATUS.idle && test.status !== STATUS.running;

                return (
                  <div className="stagger" style={{ animationDelay: `${index * 10}ms` }} key={test.id}>
                    <div className="test-card" style={{ border: `1px solid ${config.border}` }}>
                      <div className="test-card-header">
                        <span className="test-num">{String(index + 1).padStart(2, "0")}</span>
                        <div className="test-body">
                          {test.jiraKey ? <div className="test-jira">{test.jiraKey} · {test.jiraSummary || ""}</div> : null}
                          <div className="test-desc">{test.description.length > 160 ? `${test.description.slice(0, 160)}…` : test.description}</div>
                          {isRunning ? <div className="test-running-label">Running test…</div> : null}
                          <div className="test-badges">
                            <span className="source-badge" style={{ color: test.source === "jira" ? "var(--accent)" : "var(--muted)", background: test.source === "jira" ? "rgba(10,132,255,0.12)" : "rgba(128,128,128,0.08)", borderColor: test.source === "jira" ? "rgba(10,132,255,0.25)" : "var(--border)" }}>
                              {test.source === "jira" ? "Jira" : "Manual"}
                            </span>
                            <span className="tag" style={{ background: config.bg, borderColor: config.border, color: config.text }}>
                              <span className="tag-dot" style={{ background: config.dot, ...(isRunning ? { animation: "blink 1.2s ease-in-out infinite" } : {}) }} />
                              {config.label}
                            </span>
                            {hasOutput ? <button className="view-btn" onClick={() => setOpenDetailId((current) => current === test.id ? null : test.id)}>{openDetailId === test.id ? "Hide" : "View"}</button> : null}
                            {isCompleted ? <button className="rerun-btn" onClick={() => onRerunTest(test.id)}>↺ Re-run</button> : null}
                            {test.status === STATUS.idle ? <button className="remove-btn" onClick={() => onRemoveTest(test.id)}>×</button> : null}
                            {test.status === STATUS.idle ? <button className="view-btn" onClick={() => onSaveAsTemplate(test.id)}>Save as template</button> : null}
                          </div>
                        </div>
                      </div>
                      {openDetailId === test.id ? <TestDetail test={test} /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
