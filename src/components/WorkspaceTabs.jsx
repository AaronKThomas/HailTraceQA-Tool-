import DashboardTab from "./tabs/DashboardTab";
import HistoryTab from "./tabs/HistoryTab";
import SettingsTab from "./tabs/SettingsTab";
import SuitesTab from "./tabs/SuitesTab";
import TemplatesTab from "./tabs/TemplatesTab";
import TestsTab from "./tabs/TestsTab";
import { DASHBOARD_ENDPOINTS } from "../lib/constants";
import {
  checkEndpoint,
  fetchHealth,
  fetchIntegrationsHealth,
} from "../lib/api";
import { exportSuiteReport } from "../lib/export";

export default function WorkspaceTabs({
  activeTab,
  currentUser,
  history,
  historyFilter,
  historySearch,
  setHistory,
  setHistoryFilter,
  setHistorySearch,
  templates,
  suites,
  tests,
  running,
  fetchingJira,
  settings,
  accounts,
  addUser,
  inviteUser,
  deleteUser,
  deleteSuite,
  createSuite,
  cloneSuite,
  setSuiteSchedule,
  addSuiteTest,
  removeSuiteTest,
  runSuite,
  runSingleSuiteTest,
  importDescriptionToSuite,
  addTemplate,
  useTemplate,
  deleteTemplate,
  rerunFromHistory,
  setActiveTab,
  initiateTest,
  removeTest,
  rerunTest,
  saveAsTemplate,
  testDraft,
  setTestDraft,
  handleSaveSettings,
  handleLogout,
  handleTestSlack,
  handleTestZohoCliq,
}) {
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
      return (
        <TemplatesTab
          templates={templates}
          onAdd={addTemplate}
          onUse={useTemplate}
          onDelete={deleteTemplate}
        />
      );
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
          onRefresh={() => Promise.all(
            DASHBOARD_ENDPOINTS.map((endpoint) =>
              checkEndpoint(settings.backendUrl, endpoint.path, endpoint.method)),
          )}
          onCustomCheck={(path, method) => checkEndpoint(settings.backendUrl, path, method)}
          onFetchHealth={() => fetchHealth(settings.backendUrl)}
          onFetchIntegrationsHealth={() => fetchIntegrationsHealth(settings.backendUrl)}
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
          onInviteUser={inviteUser}
          onRemoveUser={deleteUser}
          onLogout={handleLogout}
          onTestSlack={handleTestSlack}
          onTestZohoCliq={handleTestZohoCliq}
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
}
