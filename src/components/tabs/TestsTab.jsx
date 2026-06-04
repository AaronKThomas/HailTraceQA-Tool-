import { useEffect, useMemo, useState } from "react";
import { STATUS, STATUS_CONFIG } from "../../lib/constants";
import { parseJiraUrl, parseOutput } from "../../lib/utils";

const ESTIMATED_TEST_DURATION_MS = 90 * 1000;

function formatDuration(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

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

function getProgressView({ test, queuePosition, now }) {
  const status = test.status;
  const isDone = status === STATUS.pass || status === STATUS.fail || status === STATUS.manual || status === STATUS.cancelled;
  const isRunning = status === STATUS.running;
  if (isRunning) {
    const elapsedMs = Math.max(0, now - (test.startedAt || now));
    const percent = Math.min(95, Math.max(8, Math.round((elapsedMs / ESTIMATED_TEST_DURATION_MS) * 100)));
    const remainingMs = ESTIMATED_TEST_DURATION_MS - elapsedMs;
    return {
      label: "Running browser QA",
      percent,
      detail: remainingMs > 0 ? `${percent}% · ~${formatDuration(remainingMs)} left` : `${percent}% · finishing up`,
    };
  }
  if (status === STATUS.idle) {
    const estimatedWaitMs = Math.max(1, queuePosition) * ESTIMATED_TEST_DURATION_MS;
    return {
      label: queuePosition > 1 ? `Queued #${queuePosition}` : "Queued next",
      percent: 0,
      detail: `0% · starts in ~${formatDuration(estimatedWaitMs)}`,
    };
  }
  if (isDone) {
    const durationMs = test.startedAt && test.completedAt ? test.completedAt - test.startedAt : 0;
    return {
      label: status === STATUS.cancelled ? "Cancelled" : "Complete",
      percent: 100,
      detail: durationMs > 0 ? `100% · ${formatDuration(durationMs)}` : "100%",
    };
  }
  return { label: "Queued", percent: 0, detail: "0%" };
}

function TestProgress({ test, queuePosition, now }) {
  const { label, percent, detail } = getProgressView({ test, queuePosition, now });
  const status = test.status;
  const isDone = status === STATUS.pass || status === STATUS.fail || status === STATUS.manual || status === STATUS.cancelled;
  const isRunning = status === STATUS.running;

  return (
    <div
      className={`task-progress status-${status} ${isRunning ? "running" : ""} ${isDone ? "done" : ""}`}
      aria-label={`${label}, ${detail}`}
    >
      <div className="task-progress-meta">
        <span>{label}</span>
        <span>{detail}</span>
      </div>
      <div className="task-progress-track" aria-hidden="true">
        <div className="task-progress-fill" style={{ width: `${percent}%` }} />
      </div>
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

      {test.replay?.url ? (
        <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <div className="output-section-label">Execution Replay</div>
          <video
            controls
            controlsList="nodownload"
            preload="metadata"
            src={test.replay.url}
            style={{ width: "100%", maxHeight: 420, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}
          >
            <a href={test.replay.url} target="_blank" rel="noreferrer">Open video replay</a>
          </video>
          <div className="api-desc" style={{ marginTop: 8 }}>
            Replay expires {test.replay.expiresAt ? new Date(test.replay.expiresAt).toLocaleString() : "soon"}.
          </div>
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
  onCancelTest,
  onSaveAsTemplate,
  draftInput,
  setDraftInput,
}) {
  const [openDetailId, setOpenDetailId] = useState(null);
  const [progressNow, setProgressNow] = useState(Date.now());

  const jiraDetected = useMemo(() => parseJiraUrl(draftInput.trim()), [draftInput]);
  const testsStatusMessage = running
    ? "Running tests."
    : fetchingJira
      ? "Loading Jira ticket details."
      : `${tests.length} test${tests.length === 1 ? "" : "s"} in the current workspace.`;

  async function handleRun() {
    const raw = draftInput.trim();
    if (!raw) return;
    setDraftInput("");
    await onInitiateTest(raw);
  }

  const submitLabel = fetchingJira
    ? "Loading Jira…"
    : running ? "Add to Queue" : "Run Test";

  useEffect(() => {
    if (!running) {
      setProgressNow(Date.now());
      return undefined;
    }
    const timer = window.setInterval(() => setProgressNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <>
      <div className="sr-only" aria-live="polite">{testsStatusMessage}</div>
      <div className="input-card stagger" style={{ animationDelay: "0ms" }}>
        <div className="input-header">
          <span className="input-label">New Test</span>
          <div className="input-header-meta">
            <span className="jira-hint" style={{ display: jiraDetected ? "inline-flex" : "none" }}>Jira ticket detected</span>
            <span className="powered-by">Powered by OpenAI</span>
          </div>
        </div>
        <label className="sr-only" htmlFor="test-input">Describe a feature to test or paste a Jira ticket</label>
        <textarea
          id="test-input"
          value={draftInput}
          disabled={fetchingJira}
          aria-describedby="test-input-help test-run-status"
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
          <div className={`progress-bar-wrap ${running || fetchingJira ? "show" : ""}`}><div className="progress-bar-fill" /></div>
          <div className="input-actions">
            <span id="test-input-help" className="input-hint">Press Ctrl+Enter or Cmd+Enter to {running ? "add to the queue" : "run"}.</span>
            <span id="test-run-status" className="sr-only">{running ? "Test queue is processing." : "Test execution idle."}</span>
            {running ? (
              <button className="cancel-btn" type="button" onClick={onCancelTest}>
                Cancel Queue
              </button>
            ) : null}
            <button className={`run-btn ${running ? "running" : ""}`} disabled={!draftInput.trim() || fetchingJira} onClick={handleRun}>
              {running ? <><span className="spinner" /> {submitLabel}</> : submitLabel}
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
            <div className="tests-list" aria-label="Queued and completed tests">
              {tests.map((test, index) => {
                const config = STATUS_CONFIG[test.status];
                const hasOutput = (test.output || test.playwrightLog || test.apiResults?.length || test.replay?.url) && test.status !== STATUS.idle;
                const isRunning = test.status === STATUS.running;
                const isCompleted = test.status !== STATUS.idle && test.status !== STATUS.running;
                const queuePosition = test.status === STATUS.idle
                  ? tests.slice(0, index).filter((entry) => entry.status === STATUS.idle).length + 1
                  : 0;
                const detailId = `test-detail-${test.id}`;
                const headingId = `test-title-${test.id}`;

                return (
                  <div className="stagger" style={{ animationDelay: `${index * 10}ms` }} key={test.id}>
                    <article className="test-card" style={{ border: `1px solid ${config.border}` }} aria-labelledby={headingId}>
                      <div className="test-card-header">
                        <span className="test-num">{String(index + 1).padStart(2, "0")}</span>
                        <div className="test-body">
                          {test.jiraKey ? <div className="test-jira">{test.jiraKey} · {test.jiraSummary || ""}</div> : null}
                          <h2 id={headingId} className="test-desc">{test.description.length > 160 ? `${test.description.slice(0, 160)}…` : test.description}</h2>
                          {isRunning ? <div className="test-running-label">Running test…</div> : null}
                          <TestProgress test={test} queuePosition={queuePosition} now={progressNow} />
                          <div className="test-badges">
                            <span className="source-badge" style={{ color: test.source === "jira" ? "var(--accent)" : "var(--muted)", background: test.source === "jira" ? "rgba(10,132,255,0.12)" : "rgba(128,128,128,0.08)", borderColor: test.source === "jira" ? "rgba(10,132,255,0.25)" : "var(--border)" }}>
                              {test.source === "jira" ? "Jira" : "Manual"}
                            </span>
                            <span className="tag" style={{ background: config.bg, borderColor: config.border, color: config.text }}>
                              <span className="tag-dot" style={{ background: config.dot, ...(isRunning ? { animation: "blink 1.2s ease-in-out infinite" } : {}) }} />
                              {config.label}
                            </span>
                            {hasOutput ? <button className="view-btn" aria-expanded={openDetailId === test.id} aria-controls={detailId} onClick={() => setOpenDetailId((current) => current === test.id ? null : test.id)}>{openDetailId === test.id ? "Hide" : "View"}</button> : null}
                            {isRunning ? <button className="cancel-btn" aria-label={`Cancel test ${index + 1}`} onClick={onCancelTest}>Cancel</button> : null}
                            {isCompleted ? <button className="rerun-btn" aria-label={`Re-run test ${index + 1}`} onClick={() => onRerunTest(test.id)}>↺ Re-run</button> : null}
                            {test.status === STATUS.idle ? <button className="remove-btn" aria-label={`Remove test ${index + 1}`} onClick={() => onRemoveTest(test.id)}>×</button> : null}
                            {test.status === STATUS.idle ? <button className="view-btn" onClick={() => onSaveAsTemplate(test.id)}>Save as template</button> : null}
                          </div>
                        </div>
                      </div>
                      {openDetailId === test.id ? <div id={detailId} role="region" aria-label={`Details for test ${index + 1}`}><TestDetail test={test} /></div> : null}
                    </article>
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
