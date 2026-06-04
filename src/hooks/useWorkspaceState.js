import { useEffect, useState } from "react";
import { pingServer } from "../lib/api";
import { getUserKey, writeJson } from "../lib/storage";

export function useWorkspaceState({
  settings,
  currentUser,
  history,
  templates,
  suites,
}) {
  const [activeTab, setActiveTab] = useState("tests");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const [serverStatus, setServerStatus] = useState("unknown");

  useEffect(() => {
    document.body.classList.toggle("light", settings.theme === "light");
  }, [settings.theme]);

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

    [
      ["history", history],
      ["templates", templates],
      ["suites", suites],
      ["settings", settings],
    ].forEach(([prefix, value]) => {
      writeJson(getUserKey(prefix, currentUser.email), value);
    });

    return undefined;
  }, [currentUser, history, templates, suites, settings]);

  return {
    activeTab,
    setActiveTab,
    historyFilter,
    setHistoryFilter,
    historySearch,
    setHistorySearch,
    serverStatus,
  };
}
