import { useCallback, useMemo, useRef, useState } from "react";
import { fetchJiraTicket, runTestRequest, sendSlackNotificationRequest, sendZohoCliqNotificationRequest } from "../lib/api";
import { STATUS } from "../lib/constants";
import { createQueuedTest, genId, parseJiraUrl, playChime, statusToastPrefix, verdictToStatus } from "../lib/utils";

function isAbortError(error) {
  return error?.name === "AbortError";
}

function normalizeReplay(backendUrl, replay) {
  if (!replay?.url) return null;
  return {
    ...replay,
    url: replay.url.startsWith("http") ? replay.url : `${backendUrl}${replay.url}`,
  };
}

export function useTests({
  backendUrl,
  currentUser,
  settings,
  setHistory,
  showToast,
}) {
  const [tests, setTests] = useState([]);
  const [running, setRunning] = useState(false);
  const [fetchingJira, setFetchingJira] = useState(false);
  const activeRunRef = useRef(null);
  const pendingQueueRef = useRef([]);
  const queueProcessingRef = useRef(false);
  const cancelQueuedRunsRef = useRef(false);

  const stats = useMemo(() => ({
    pass: tests.filter((test) => test.status === STATUS.pass).length,
    fail: tests.filter((test) => test.status === STATUS.fail).length,
    manual: tests.filter((test) => test.status === STATUS.manual).length,
  }), [tests]);

  const addHistoryEntry = useCallback((entry) => {
    setHistory((current) => [entry, ...current].slice(0, 200));
  }, [setHistory]);

  const notifySlack = useCallback(async (description, status, verdict) => {
    if (!settings.slackOnFail && !settings.slackOnPass) return;
    await sendSlackNotificationRequest(backendUrl, {
      description,
      status,
      verdict,
    });
  }, [backendUrl, settings.slackOnFail, settings.slackOnPass]);

  const notifyZohoCliq = useCallback(async (description, status, verdict) => {
    if (!settings.zohoCliqOnFail && !settings.zohoCliqOnPass) return;
    await sendZohoCliqNotificationRequest(backendUrl, {
      description,
      status,
      verdict,
    });
  }, [backendUrl, settings.zohoCliqOnFail, settings.zohoCliqOnPass]);

  const runSingleTest = useCallback(async (testId, description, jiraKey) => {
    const controller = new AbortController();
    activeRunRef.current = { controller, testId };
    // Flip status immediately so cards feel responsive while the backend is
    // still running or while reviewers are exercising the mock contract.
    setTests((current) => current.map((test) => test.id === testId ? {
      ...test,
      status: STATUS.running,
      startedAt: Date.now(),
      completedAt: null,
    } : test));
    try {
      const data = await runTestRequest(backendUrl, description, jiraKey, { signal: controller.signal });
      const status = verdictToStatus(data.verdict);
      setTests((current) => current.map((test) => test.id === testId ? {
        ...test,
        status,
        completedAt: Date.now(),
        output: data.analysis || "",
        recommendations: data.recommendations || [],
        playwrightLog: data.playwrightLog || "",
        apiResults: data.apiResults || [],
        replay: normalizeReplay(backendUrl, data.replay),
      } : test));
      addHistoryEntry({
        id: genId(),
        timestamp: new Date(),
        email: currentUser.email,
        displayName: currentUser.displayName,
        description: description.slice(0, 120),
        jiraKey: jiraKey || null,
        status,
        verdict: data.verdict || status.toUpperCase(),
      });
      if (settings.soundOnComplete) playChime(status);
      if ((status === STATUS.fail && settings.slackOnFail) || (status === STATUS.pass && settings.slackOnPass)) {
        notifySlack(description, status, data.verdict).catch(() => {});
      }
      if ((status === STATUS.fail && settings.zohoCliqOnFail) || (status === STATUS.pass && settings.zohoCliqOnPass)) {
        notifyZohoCliq(description, status, data.verdict).catch(() => {});
      }
      showToast(`${statusToastPrefix(status)} — ${description.slice(0, 50)}`, status);
      return status;
    } catch (error) {
      if (isAbortError(error)) {
        setTests((current) => current.map((test) => test.id === testId ? {
          ...test,
          status: STATUS.cancelled,
          completedAt: Date.now(),
          output: "Test cancelled before completion.",
          recommendations: [],
          playwrightLog: "",
          apiResults: [],
          replay: null,
        } : test));
        showToast("Test cancelled", "");
        return STATUS.cancelled;
      }
      setTests((current) => current.map((test) => test.id === testId ? {
        ...test,
        status: STATUS.fail,
        completedAt: Date.now(),
        output: `Error: ${error.message}`,
        recommendations: [],
        playwrightLog: "",
        apiResults: [],
        replay: null,
      } : test));
      addHistoryEntry({
        id: genId(),
        timestamp: new Date(),
        email: currentUser.email,
        displayName: currentUser.displayName,
        description: description.slice(0, 120),
        jiraKey: jiraKey || null,
        status: STATUS.fail,
        verdict: "FAIL",
      });
      showToast(`Error: ${error.message}`, "fail");
      return STATUS.fail;
    } finally {
      if (activeRunRef.current?.testId === testId) {
        activeRunRef.current = null;
      }
    }
  }, [addHistoryEntry, backendUrl, currentUser, notifySlack, notifyZohoCliq, settings.slackOnFail, settings.slackOnPass, settings.zohoCliqOnFail, settings.zohoCliqOnPass, settings.soundOnComplete, showToast]);

  const drainQueue = useCallback(async function drainQueue() {
    if (queueProcessingRef.current) return;
    queueProcessingRef.current = true;
    setRunning(true);

    try {
      while (!cancelQueuedRunsRef.current) {
        const next = pendingQueueRef.current.shift();
        if (!next) break;
        // eslint-disable-next-line no-await-in-loop
        const result = await runSingleTest(next.id, next.description, next.jiraKey);
        if (result === STATUS.cancelled) break;
      }
    } finally {
      queueProcessingRef.current = false;
      if (pendingQueueRef.current.length && !cancelQueuedRunsRef.current) {
        drainQueue();
      } else {
        setRunning(false);
      }
    }
  }, [runSingleTest]);

  const enqueueTests = useCallback((newTests) => {
    if (!newTests.length) return;
    cancelQueuedRunsRef.current = false;
    setTests((current) => [...current, ...newTests]);
    pendingQueueRef.current.push(...newTests.filter((test) => test.status === STATUS.idle));
    drainQueue();
  }, [drainQueue]);

  const initiateTest = useCallback(async (raw) => {
    if (!raw) return;
    cancelQueuedRunsRef.current = false;
    try {
      const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
      const newTests = [];

      // Treat multi-line input as a light batch queue so reviewers can paste a
      // handful of prompts or Jira keys and watch them execute in order.
      for (const line of lines) {
        if (cancelQueuedRunsRef.current) break;
        const jiraKey = parseJiraUrl(line);
        if (jiraKey) {
          setFetchingJira(true);
          try {
            const ticket = await fetchJiraTicket({ backendUrl }, jiraKey);
            const description = [
              ticket.summary,
              ticket.description ? `\n\nDescription: ${ticket.description}` : "",
              ticket.acceptanceCriteria ? `\n\nAcceptance Criteria: ${ticket.acceptanceCriteria}` : "",
            ].join("").trim();
            newTests.push(createQueuedTest({ description, source: "jira", jiraKey: ticket.key, jiraSummary: ticket.summary }));
          } catch (error) {
            newTests.push(createQueuedTest({ description: `Failed to load ${jiraKey}: ${error.message}`, source: "jira", jiraKey, status: STATUS.fail, output: error.message }));
          }
          setFetchingJira(false);
        } else {
          newTests.push(createQueuedTest({ description: line, source: "manual" }));
        }
      }

      enqueueTests(newTests);
    } finally {
      setFetchingJira(false);
    }
  }, [backendUrl, enqueueTests]);

  const rerunTest = useCallback(async (id) => {
    const existing = tests.find((test) => test.id === id);
    if (!existing) return;
    cancelQueuedRunsRef.current = false;
    const newTest = createQueuedTest({ description: existing.description, source: existing.source, jiraKey: existing.jiraKey || null, jiraSummary: existing.jiraSummary || "" });
    enqueueTests([newTest]);
  }, [enqueueTests, tests]);

  const rerunFromHistory = useCallback(async (entry) => {
    cancelQueuedRunsRef.current = false;
    const newTest = createQueuedTest({ description: entry.description, source: entry.jiraKey ? "jira" : "manual", jiraKey: entry.jiraKey || null });
    enqueueTests([newTest]);
    return true;
  }, [enqueueTests]);

  const cancelRunningTest = useCallback(() => {
    cancelQueuedRunsRef.current = true;
    const queuedIds = new Set(pendingQueueRef.current.map((test) => test.id));
    pendingQueueRef.current = [];
    if (queuedIds.size) {
      setTests((current) => current.map((test) => queuedIds.has(test.id)
        ? {
          ...test,
          status: STATUS.cancelled,
          completedAt: Date.now(),
          output: "Test cancelled before it started.",
          recommendations: [],
          playwrightLog: "",
          apiResults: [],
          replay: null,
        }
        : test));
    }
    activeRunRef.current?.controller.abort();
  }, []);

  return {
    tests,
    setTests,
    stats,
    running,
    setRunning,
    fetchingJira,
    initiateTest,
    rerunTest,
    rerunFromHistory,
    runSingleTest,
    cancelRunningTest,
    clearTests: () => {
      if (!running) setTests([]);
    },
    removeTest: (id) => {
      pendingQueueRef.current = pendingQueueRef.current.filter((test) => test.id !== id);
      setTests((current) => current.filter((test) => test.id !== id));
    },
  };
}
