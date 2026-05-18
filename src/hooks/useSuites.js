import { useCallback, useEffect, useRef } from "react";
import { STATUS } from "../lib/constants";
import { genId } from "../lib/utils";

export function useSuites({
  currentUser,
  suites,
  setSuites,
  setTests,
  runSingleTest,
  running,
  setRunning,
  showToast,
  setActiveTab,
}) {
  const loginSuitesRanForRef = useRef(null);

  const createSuite = useCallback((name) => {
    if (!name.trim()) {
      showToast("Enter a suite name", "fail");
      return;
    }
    setSuites((current) => [...current, { id: genId(), name: name.trim(), tests: [], schedule: "Off", createdAt: new Date().toISOString() }]);
    showToast(`✓ Suite "${name.trim()}" created`, "pass");
  }, [setSuites, showToast]);

  const deleteSuite = useCallback((id) => {
    setSuites((current) => current.filter((suite) => suite.id !== id));
  }, [setSuites]);

  const cloneSuite = useCallback((id) => {
    const suite = suites.find((entry) => entry.id === id);
    if (!suite) return;
    setSuites((current) => [...current, { ...JSON.parse(JSON.stringify(suite)), id: genId(), name: `${suite.name} (copy)`, createdAt: new Date().toISOString(), lastRun: null }]);
    showToast("✓ Suite cloned", "pass");
  }, [setSuites, showToast, suites]);

  const setSuiteSchedule = useCallback((id, schedule) => {
    setSuites((current) => current.map((suite) => suite.id === id ? { ...suite, schedule } : suite));
    if (schedule === "On Login") showToast("⏰ Suite will run when you sign in", "pass");
  }, [setSuites, showToast]);

  const addSuiteTest = useCallback((suiteId, description) => {
    if (!description.trim()) return;
    setSuites((current) => current.map((suite) => suite.id === suiteId ? { ...suite, tests: [...suite.tests, { id: genId(), description: description.trim() }] } : suite));
  }, [setSuites]);

  const removeSuiteTest = useCallback((suiteId, testId) => {
    setSuites((current) => current.map((suite) => suite.id === suiteId ? { ...suite, tests: suite.tests.filter((test) => test.id !== testId) } : suite));
  }, [setSuites]);

  const runSingleSuiteTest = useCallback(async (suiteId, testId) => {
    if (running) {
      showToast("A test is already running", "fail");
      return;
    }
    const suite = suites.find((entry) => entry.id === suiteId);
    const test = suite?.tests.find((entry) => entry.id === testId);
    if (!test) return;
    setActiveTab("tests");
    setRunning(true);
    const newTest = { id: genId(), description: test.description, source: "manual", jiraKey: null, jiraSummary: "", status: STATUS.idle, output: "", playwrightLog: "", apiResults: [] };
    setTests((current) => [...current, newTest]);
    await runSingleTest(newTest.id, test.description, null);
    setRunning(false);
  }, [runSingleTest, running, setActiveTab, setRunning, setTests, showToast, suites]);

  const runSuite = useCallback(async (suiteId) => {
    if (running) {
      showToast("A test is already running", "fail");
      return;
    }
    const suite = suites.find((entry) => entry.id === suiteId);
    if (!suite || !suite.tests.length) {
      showToast("Suite is empty", "fail");
      return;
    }
    setActiveTab("tests");
    setRunning(true);
    let pass = 0;
    let fail = 0;
    let manual = 0;

    // Run suite tests serially to match the current backend contract and keep
    // the UI timeline deterministic during reviews.
    for (const test of suite.tests) {
      const newTest = { id: genId(), description: test.description, source: "manual", jiraKey: null, jiraSummary: "", status: STATUS.idle, output: "", playwrightLog: "", apiResults: [] };
      setTests((current) => [...current, newTest]);
      // eslint-disable-next-line no-await-in-loop
      const result = await runSingleTest(newTest.id, test.description, null);
      if (result === STATUS.pass) pass += 1;
      else if (result === STATUS.manual) manual += 1;
      else fail += 1;
    }

    setSuites((current) => current.map((entry) => entry.id === suiteId ? {
      ...entry,
      lastRun: new Date().toISOString(),
      lastPass: pass,
      lastFail: fail,
      lastManual: manual,
    } : entry));
    setRunning(false);
    showToast(`Suite "${suite.name}" — ✓${pass} ✗${fail}${manual ? ` ⚠${manual}` : ""}`, fail > 0 ? "fail" : "pass");
  }, [runSingleTest, running, setActiveTab, setRunning, setSuites, setTests, showToast, suites]);

  const importDescriptionToSuite = useCallback((suiteId, description) => {
    let added = false;
    setSuites((current) => current.map((suite) => {
      if (suite.id !== suiteId) return suite;
      if (suite.tests.some((test) => test.description === description)) {
        return suite;
      }
      added = true;
      return { ...suite, tests: [...suite.tests, { id: genId(), description }] };
    }));
    showToast(added ? "✓ Added to suite" : "Already in suite", added ? "pass" : "");
  }, [setSuites, showToast]);

  useEffect(() => {
    if (!currentUser) {
      loginSuitesRanForRef.current = null;
      return;
    }
    if (loginSuitesRanForRef.current === currentUser.username) return;
    const loginSuites = suites.filter((suite) => suite.schedule === "On Login");
    if (!loginSuites.length) return;

    // Guard against duplicate auto-runs during login hydration and re-renders.
    loginSuitesRanForRef.current = currentUser.username;
    const timer = window.setTimeout(() => {
      loginSuites.forEach((suite) => {
        runSuite(suite.id);
      });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [currentUser, runSuite, suites]);

  return {
    createSuite,
    deleteSuite,
    cloneSuite,
    setSuiteSchedule,
    addSuiteTest,
    removeSuiteTest,
    runSingleSuiteTest,
    runSuite,
    importDescriptionToSuite,
  };
}
