import { useEffect, useMemo, useState } from "react";
import AppShell from "./components/AppShell";
import LoginScreen from "./components/LoginScreen";
import Toast from "./components/Toast";
import DashboardTab from "./components/tabs/DashboardTab";
import HistoryTab from "./components/tabs/HistoryTab";
import SettingsTab from "./components/tabs/SettingsTab";
import SuitesTab from "./components/tabs/SuitesTab";
import TemplatesTab from "./components/tabs/TemplatesTab";
import TestsTab from "./components/tabs/TestsTab";
import { DASHBOARD_ENDPOINTS } from "./lib/constants";
import { checkEndpoint, fetchHealth, pingServer, testSlackWebhookRequest } from "./lib/api";
import { writeJson } from "./lib/storage";
import { exportSuiteReport, exportTestsReport } from "./lib/export";
import { genId } from "./lib/utils";
import { useAccounts } from "./hooks/useAccounts";
import { useAuth } from "./hooks/useAuth";
import { useSuites } from "./hooks/useSuites";
import { useTests } from "./hooks/useTests";
import { useToast } from "./hooks/useToast";

function getUserKey(prefix, username) {
  return `${prefix}:${username}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("tests");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const [serverStatus, setServerStatus] = useState("unknown");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const {
    toast,
    showToast,
  } = useToast();

  const {
    currentUser,
    setCurrentUser,
    history,
    setHistory,
    templates,
    setTemplates,
    suites,
    setSuites,
    settings,
    setSettings,
    testDraft,
    setTestDraft,
    authReady,
    handleLogin,
    handleRegister,
    handleLogout: baseLogout,
  } = useAuth();

  const {
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
    clearTests,
    removeTest,
  } = useTests({
    backendUrl: settings.backendUrl,
    currentUser,
    settings,
    setHistory,
    showToast,
  });

  const {
    accounts,
    addUser,
    deleteUser,
  } = useAccounts(settings.backendUrl, currentUser);

  const {
    createSuite,
    deleteSuite,
    cloneSuite,
    setSuiteSchedule,
    addSuiteTest,
    removeSuiteTest,
    runSingleSuiteTest,
    runSuite,
    importDescriptionToSuite,
  } = useSuites({
    currentUser,
    suites,
    setSuites,
    setTests,
    runSingleTest,
    running,
    setRunning,
    showToast,
    setActiveTab,
  });

  useEffect(() => {
    document.body.classList.toggle("light", settings.theme === "light");
  }, [settings.theme]);

  // Keep the server indicator tied to the selected backend URL so reviewers can
  // immediately tell whether they are exercising the mock server or a real one.
  useEffect(() => {
    let active = true;
    pingServer(settings.backendUrl).then((status) => {
      if (active) setServerStatus(status);
    });
    return () => {
      active = false;
    };
  }, [settings.backendUrl]);

  useEffect(() => {
    if (!currentUser) return undefined;

    // Persist each user-owned slice separately so a page refresh preserves the
    // current workspace without forcing a more complex client store.
    [
      ["history", history],
      ["templates", templates],
      ["suites", suites],
      ["settings", settings],
    ].forEach(([prefix, value]) => {
      writeJson(getUserKey(prefix, currentUser.username), value);
    });

    return undefined;
  }, [currentUser, history, templates, suites, settings]);

  useEffect(() => {
    if (!dropdownOpen) return undefined;

    // The mobile dropdown sits outside the normal tab flow, so clicking away
    // should close it without affecting the desktop sidebar state.
    function handleClick(event) {
      const menu = document.querySelector(".dropdown-menu");
      const button = document.querySelector(".hamburger");
      if (menu && button && !menu.contains(event.target) && !button.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [dropdownOpen]);

  function handleLogout() {
    baseLogout();
    setDropdownOpen(false);
    setActiveTab("tests");
  }

  function saveAsTemplate(testId) {
    const test = tests.find((entry) => entry.id === testId);
    if (!test) return;
    setTemplates((current) => [...current, {
      id: genId(),
      name: test.description.slice(0, 60),
      description: test.description,
      jiraKey: test.jiraKey || null,
      createdAt: new Date().toISOString(),
    }]);
    showToast("✓ Template saved", "pass");
  }

  function addTemplate(name, description) {
    if (!name.trim() || !description.trim()) {
      showToast("Name and description required", "fail");
      return;
    }
    setTemplates((current) => [...current, {
      id: genId(),
      name: name.trim(),
      description: description.trim(),
      jiraKey: null,
      createdAt: new Date().toISOString(),
    }]);
    showToast("✓ Template saved", "pass");
  }

  function useTemplate(id) {
    const template = templates.find((entry) => entry.id === id);
    if (!template) return;
    setActiveTab("tests");
    setTestDraft(template.description);
    showToast("Template loaded into the test input", "pass");
  }

  function deleteTemplate(id) {
    setTemplates((current) => current.filter((template) => template.id !== id));
  }

  async function handleTestSlack() {
    try {
      await testSlackWebhookRequest(settings.backendUrl, {});
      showToast("✓ Slack notification sent", "pass");
    } catch (error) {
      showToast(error.message, "fail");
    }
  }

  function handleSaveSettings(nextSettings) {
    setSettings(nextSettings);
    if (currentUser && nextSettings.displayName?.trim()) {
      setCurrentUser({ ...currentUser, displayName: nextSettings.displayName.trim() });
    }
  }

  // Keep the composition root explicit for reviewers: feature behavior lives in
  // hooks and leaf components, while App owns wiring and tab-level routing.
  const renderedTab = useMemo(() => {
    switch (activeTab) {
      case "history":
        return (
          <HistoryTab
            currentUser={currentUser}
            history={history}
            filter={historyFilter}
            search={historySearch}
            setFilter={setHistoryFilter}
            setSearch={setHistorySearch}
            onClear={() => setHistory([])}
            onRerun={async (entry) => {
              const didStart = await rerunFromHistory(entry);
              if (didStart) setActiveTab("tests");
            }}
          />
        );
      case "templates":
        return <TemplatesTab templates={templates} onAdd={addTemplate} onUse={useTemplate} onDelete={deleteTemplate} />;
      case "suites":
        return (
          <SuitesTab
            suites={suites}
            history={history}
            templates={templates}
            onCreate={createSuite}
            onDelete={deleteSuite}
            onClone={cloneSuite}
            onSchedule={setSuiteSchedule}
            onAddSuiteTest={addSuiteTest}
            onRemoveSuiteTest={removeSuiteTest}
            onRunSuite={runSuite}
            onRunSingleSuiteTest={runSingleSuiteTest}
            exportDefaultFormat={settings.exportFormat}
            onExportSuiteReport={(suiteId, format) => exportSuiteReport(
              suites.find((suite) => suite.id === suiteId),
              tests,
              format || settings.exportFormat,
              currentUser,
            )}
            onImportDescription={importDescriptionToSuite}
          />
        );
      case "dashboard":
        return (
          <DashboardTab
            onRefresh={() => Promise.all(DASHBOARD_ENDPOINTS.map((endpoint) => checkEndpoint(settings.backendUrl, endpoint.path, endpoint.method)))}
            onCustomCheck={(path, method) => checkEndpoint(settings.backendUrl, path, method)}
            onFetchHealth={() => fetchHealth(settings.backendUrl)}
          />
        );
      case "settings":
        return (
          <SettingsTab
            settings={settings}
            onSave={handleSaveSettings}
            currentUser={currentUser}
            accounts={accounts}
            onAddUser={addUser}
            onRemoveUser={deleteUser}
            onLogout={handleLogout}
            onTestSlack={handleTestSlack}
          />
        );
      case "tests":
      default:
        return (
          <TestsTab
            tests={tests}
            running={running}
            fetchingJira={fetchingJira}
            onInitiateTest={initiateTest}
            onRemoveTest={removeTest}
            onRerunTest={rerunTest}
            onSaveAsTemplate={saveAsTemplate}
            draftInput={testDraft}
            setDraftInput={setTestDraft}
          />
        );
    }
  }, [
    activeTab,
    accounts,
    createSuite,
    currentUser,
    deleteSuite,
    deleteTemplate,
    history,
    historyFilter,
    historySearch,
    rerunFromHistory,
    settings,
    suites,
    templates,
    tests,
    running,
    fetchingJira,
    initiateTest,
    removeTest,
    rerunTest,
    testDraft,
    addUser,
    deleteUser,
    addSuiteTest,
    removeSuiteTest,
    runSuite,
    runSingleSuiteTest,
    importDescriptionToSuite,
    cloneSuite,
    setSuiteSchedule,
  ]);

  if (!authReady) {
    return null;
  }

  if (!currentUser) {
    return (
      <>
        <LoginScreen onLogin={handleLogin} onRegister={handleRegister} />
        <Toast toast={toast} />
      </>
    );
  }

  return (
    <>
      <AppShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        currentUser={currentUser}
        onLogout={handleLogout}
        exportDefaultFormat={settings.exportFormat}
        onExport={(format) => exportTestsReport(tests, format || settings.exportFormat, currentUser)}
        onClearTests={clearTests}
        showExport={tests.length > 0}
        exportDisabled={running}
        showClear={tests.length > 0 && !running}
        stats={stats}
        serverStatus={serverStatus}
        dropdownOpen={dropdownOpen}
        setDropdownOpen={setDropdownOpen}
      >
        {renderedTab}
      </AppShell>
      <Toast toast={toast} />
    </>
  );
}
