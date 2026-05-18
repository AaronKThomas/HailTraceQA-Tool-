import { useCallback, useMemo, useState } from "react";
import { fetchJiraTicket, runTestRequest, sendSlackNotificationRequest, sendZohoCliqNotificationRequest } from "../lib/api";
import { STATUS } from "../lib/constants";
import { genId, parseJiraUrl, playChime } from "../lib/utils";

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
    // Flip status immediately so cards feel responsive while the backend is
    // still running or while reviewers are exercising the mock contract.
    setTests((current) => current.map((test) => test.id === testId ? { ...test, status: STATUS.running } : test));
    try {
      const data = await runTestRequest(backendUrl, description, jiraKey);
      const status = data.verdict === "PASS" ? STATUS.pass : data.verdict === "NEEDS MANUAL CHECK" ? STATUS.manual : STATUS.fail;
      setTests((current) => current.map((test) => test.id === testId ? {
        ...test,
        status,
        output: data.analysis || "",
        recommendations: data.recommendations || [],
        playwrightLog: data.playwrightLog || "",
        apiResults: data.apiResults || [],
      } : test));
      addHistoryEntry({
        id: genId(),
        timestamp: new Date(),
        username: currentUser.username,
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
      showToast(`${status === "pass" ? "✓ Pass" : status === "fail" ? "✗ Fail" : "⚠ Manual"} — ${description.slice(0, 50)}`, status);
      return status;
    } catch (error) {
      setTests((current) => current.map((test) => test.id === testId ? {
        ...test,
        status: STATUS.fail,
        output: `Error: ${error.message}`,
        recommendations: [],
        playwrightLog: "",
        apiResults: [],
      } : test));
      addHistoryEntry({
        id: genId(),
        timestamp: new Date(),
        username: currentUser.username,
        displayName: currentUser.displayName,
        description: description.slice(0, 120),
        jiraKey: jiraKey || null,
        status: STATUS.fail,
        verdict: "FAIL",
      });
      showToast(`Error: ${error.message}`, "fail");
      return STATUS.fail;
    }
  }, [addHistoryEntry, backendUrl, currentUser, notifySlack, notifyZohoCliq, settings.slackOnFail, settings.slackOnPass, settings.zohoCliqOnFail, settings.zohoCliqOnPass, settings.soundOnComplete, showToast]);

  const initiateTest = useCallback(async (raw) => {
    if (!raw || running) return;
    setRunning(true);
    const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
    const newTests = [];

    // Treat multi-line input as a light batch queue so reviewers can paste a
    // handful of prompts or Jira keys and watch them execute in order.
    for (const line of lines) {
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
          newTests.push({ id: genId(), description, source: "jira", jiraKey: ticket.key, jiraSummary: ticket.summary, status: STATUS.idle, output: "", recommendations: [], playwrightLog: "", apiResults: [] });
        } catch (error) {
          newTests.push({ id: genId(), description: `Failed to load ${jiraKey}: ${error.message}`, source: "jira", jiraKey, jiraSummary: "", status: STATUS.fail, output: error.message, recommendations: [], playwrightLog: "", apiResults: [] });
        }
        setFetchingJira(false);
      } else {
        newTests.push({ id: genId(), description: line, source: "manual", jiraKey: null, jiraSummary: "", status: STATUS.idle, output: "", recommendations: [], playwrightLog: "", apiResults: [] });
      }
    }

    setTests((current) => [...current, ...newTests]);
    for (const test of newTests) {
      if (test.status !== STATUS.idle) continue;
      // eslint-disable-next-line no-await-in-loop
      await runSingleTest(test.id, test.description, test.jiraKey);
    }
    setRunning(false);
  }, [backendUrl, runSingleTest, running]);

  const rerunTest = useCallback(async (id) => {
    const existing = tests.find((test) => test.id === id);
    if (!existing || running) return;
    const newTest = { id: genId(), description: existing.description, source: existing.source, jiraKey: existing.jiraKey || null, jiraSummary: existing.jiraSummary || "", status: STATUS.idle, output: "", recommendations: [], playwrightLog: "", apiResults: [] };
    setTests((current) => [...current, newTest]);
    await runSingleTest(newTest.id, newTest.description, newTest.jiraKey);
  }, [runSingleTest, running, tests]);

  const rerunFromHistory = useCallback(async (entry) => {
    if (running) {
      showToast("A test is already running", "fail");
      return false;
    }
    const newTest = { id: genId(), description: entry.description, source: entry.jiraKey ? "jira" : "manual", jiraKey: entry.jiraKey || null, jiraSummary: "", status: STATUS.idle, output: "", recommendations: [], playwrightLog: "", apiResults: [] };
    setTests((current) => [...current, newTest]);
    await runSingleTest(newTest.id, newTest.description, newTest.jiraKey);
    return true;
  }, [runSingleTest, running, showToast]);

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
    clearTests: () => {
      if (!running) setTests([]);
    },
    removeTest: (id) => setTests((current) => current.filter((test) => test.id !== id)),
  };
}
