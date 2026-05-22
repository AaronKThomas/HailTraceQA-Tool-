import AcceptInvite from "./components/AcceptInvite";
import AppShell from "./components/AppShell";
import ForgotPassword from "./components/ForgotPassword";
import LoginScreen from "./components/LoginScreen";
import ResetPassword from "./components/ResetPassword";
import Toast from "./components/Toast";
import WorkspaceTabs from "./components/WorkspaceTabs";
import { testSlackWebhookRequest, testZohoCliqWebhookRequest } from "./lib/api";
import { exportTestsReport } from "./lib/export";
import { genId } from "./lib/utils";
import { useAccounts } from "./hooks/useAccounts";
import { useAuth } from "./hooks/useAuth";
import { useSuites } from "./hooks/useSuites";
import { useTests } from "./hooks/useTests";
import { useToast } from "./hooks/useToast";
import { useWorkspaceState } from "./hooks/useWorkspaceState";

// Lightweight pathname routing for the three public auth-flow pages. We
// intentionally avoid pulling in react-router for a 3-route surface — these
// pages are full-screen, do not share state with the main app, and benefit
// from a hard page reload between auth flow and authenticated app. The
// wrapper keeps the hook order in AuthenticatedApp stable per React's rules
// of hooks (the auth pages never invoke AuthenticatedApp's hook chain).
export default function App() {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  if (pathname.startsWith("/accept-invite")) return <AcceptInvite />;
  if (pathname.startsWith("/forgot-password")) return <ForgotPassword />;
  if (pathname.startsWith("/reset-password")) return <ResetPassword />;
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
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
    inviteUser,
    deleteUser,
  } = useAccounts(settings.backendUrl, currentUser);

  const {
    activeTab,
    setActiveTab,
    historyFilter,
    setHistoryFilter,
    historySearch,
    setHistorySearch,
    serverStatus,
  } = useWorkspaceState({
    settings,
    currentUser,
    history,
    templates,
    suites,
  });

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

  function handleLogout() {
    baseLogout();
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

  async function handleTestZohoCliq() {
    try {
      await testZohoCliqWebhookRequest(settings.backendUrl, {});
      showToast("✓ Zoho Cliq notification sent", "pass");
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
      >
        <WorkspaceTabs
          activeTab={activeTab}
          currentUser={currentUser}
          history={history}
          historyFilter={historyFilter}
          historySearch={historySearch}
          setHistory={setHistory}
          setHistoryFilter={setHistoryFilter}
          setHistorySearch={setHistorySearch}
          templates={templates}
          suites={suites}
          tests={tests}
          running={running}
          fetchingJira={fetchingJira}
          settings={settings}
          accounts={accounts}
          addUser={addUser}
          inviteUser={inviteUser}
          deleteUser={deleteUser}
          deleteSuite={deleteSuite}
          createSuite={createSuite}
          cloneSuite={cloneSuite}
          setSuiteSchedule={setSuiteSchedule}
          addSuiteTest={addSuiteTest}
          removeSuiteTest={removeSuiteTest}
          runSuite={runSuite}
          runSingleSuiteTest={runSingleSuiteTest}
          importDescriptionToSuite={importDescriptionToSuite}
          addTemplate={addTemplate}
          useTemplate={useTemplate}
          deleteTemplate={deleteTemplate}
          rerunFromHistory={rerunFromHistory}
          setActiveTab={setActiveTab}
          initiateTest={initiateTest}
          removeTest={removeTest}
          rerunTest={rerunTest}
          saveAsTemplate={saveAsTemplate}
          testDraft={testDraft}
          setTestDraft={setTestDraft}
          handleSaveSettings={handleSaveSettings}
          handleLogout={handleLogout}
          handleTestSlack={handleTestSlack}
          handleTestZohoCliq={handleTestZohoCliq}
        />
      </AppShell>
      <Toast toast={toast} />
    </>
  );
}
