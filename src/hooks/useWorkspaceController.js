import { DASHBOARD_ENDPOINTS } from "../lib/constants";
import {
  checkEndpoint,
  fetchHealth,
  fetchIntegrationsHealth,
  testSlackWebhookRequest,
  testZohoCliqWebhookRequest,
} from "../lib/api";
import { exportSuiteReport, exportTestsReport } from "../lib/export";
import { genId } from "../lib/utils";
import { useAccounts } from "./useAccounts";
import { useAuth } from "./useAuth";
import { useSuites } from "./useSuites";
import { useTests } from "./useTests";
import { useToast } from "./useToast";
import { useWorkspaceState } from "./useWorkspaceState";

export function useWorkspaceController() {
  const { toast, showToast } = useToast();

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
    cancelRunningTest,
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

  function loadTemplate(id) {
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

  return {
    authReady,
    currentUser,
    toast,
    auth: {
      handleLogin,
      handleRegister,
    },
    shell: {
      activeTab,
      onTabChange: setActiveTab,
      currentUser,
      onLogout: handleLogout,
      exportDefaultFormat: settings.exportFormat,
      onExport: (format) => exportTestsReport(tests, format || settings.exportFormat, currentUser),
      onClearTests: clearTests,
      showExport: tests.length > 0,
      exportDisabled: running,
      showClear: tests.length > 0 && !running,
      stats,
      serverStatus,
    },
    workspaceTabs: {
      activeTab,
      tabs: {
        history: {
          currentUser,
          history,
          filter: historyFilter,
          search: historySearch,
          setFilter: setHistoryFilter,
          setSearch: setHistorySearch,
          onClear: () => setHistory([]),
          onRerun: async (entry) => {
            const didStart = await rerunFromHistory(entry);
            if (didStart) setActiveTab("tests");
          },
        },
        templates: {
          templates,
          onAdd: addTemplate,
          onUse: loadTemplate,
          onDelete: deleteTemplate,
        },
        suites: {
          suites,
          history,
          templates,
          onCreate: createSuite,
          onDelete: deleteSuite,
          onClone: cloneSuite,
          onSchedule: setSuiteSchedule,
          onAddSuiteTest: addSuiteTest,
          onRemoveSuiteTest: removeSuiteTest,
          onRunSuite: runSuite,
          onRunSingleSuiteTest: runSingleSuiteTest,
          exportDefaultFormat: settings.exportFormat,
          onExportSuiteReport: (suiteId, format) => exportSuiteReport(
            suites.find((suite) => suite.id === suiteId),
            tests,
            format || settings.exportFormat,
            currentUser,
          ),
          onImportDescription: importDescriptionToSuite,
        },
        dashboard: {
          onRefresh: () => Promise.all(
            DASHBOARD_ENDPOINTS.map((endpoint) =>
              checkEndpoint(settings.backendUrl, endpoint.path, endpoint.method)),
          ),
          onCustomCheck: (path, method) => checkEndpoint(settings.backendUrl, path, method),
          onFetchHealth: () => fetchHealth(settings.backendUrl),
          onFetchIntegrationsHealth: () => fetchIntegrationsHealth(settings.backendUrl),
        },
        settings: {
          settings,
          onSave: handleSaveSettings,
          currentUser,
          accounts,
          onAddUser: addUser,
          onInviteUser: inviteUser,
          onRemoveUser: deleteUser,
          onLogout: handleLogout,
          onTestSlack: handleTestSlack,
          onTestZohoCliq: handleTestZohoCliq,
        },
        tests: {
          tests,
          running,
          fetchingJira,
          onInitiateTest: initiateTest,
          onRemoveTest: removeTest,
          onRerunTest: rerunTest,
          onCancelTest: cancelRunningTest,
          onSaveAsTemplate: saveAsTemplate,
          draftInput: testDraft,
          setDraftInput: setTestDraft,
        },
      },
    },
  };
}
