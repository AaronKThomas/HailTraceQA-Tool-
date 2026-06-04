import DashboardTab from "./tabs/DashboardTab";
import HistoryTab from "./tabs/HistoryTab";
import SettingsTab from "./tabs/SettingsTab";
import SuitesTab from "./tabs/SuitesTab";
import TemplatesTab from "./tabs/TemplatesTab";
import TestsTab from "./tabs/TestsTab";

export default function WorkspaceTabs({
  activeTab,
  tabs,
}) {
  switch (activeTab) {
    case "history":
      return <HistoryTab {...tabs.history} />;
    case "templates":
      return <TemplatesTab {...tabs.templates} />;
    case "suites":
      return <SuitesTab {...tabs.suites} />;
    case "dashboard":
      return <DashboardTab {...tabs.dashboard} />;
    case "settings":
      return <SettingsTab {...tabs.settings} />;
    case "tests":
    default:
      return <TestsTab {...tabs.tests} />;
  }
}
