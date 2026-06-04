import { useCallback, useEffect, useState } from "react";
import { fetchSession, loginRequest, logoutRequest, registerRequest } from "../lib/api";
import { defaultSettings } from "../lib/constants";
import { getUserKey, readJson, writeJson } from "../lib/storage";

export function useAuth() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [history, setHistory] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [suites, setSuites] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [testDraft, setTestDraft] = useState("");

  const hydrateUser = useCallback((account) => {
    const savedSettings = readJson(getUserKey("settings", account.email), {}) || {};

    setCurrentUser(account);
    setHistory((readJson(getUserKey("history", account.email), []) || []).map((entry) => ({
      ...entry,
      timestamp: new Date(entry.timestamp),
    })));
    setTemplates(readJson(getUserKey("templates", account.email), []) || []);
    setSuites(readJson(getUserKey("suites", account.email), []) || []);
    setSettings({
      ...defaultSettings,
      ...savedSettings,
      displayName: savedSettings.displayName || account.displayName,
    });
    setTestDraft("");
  }, []);

  const handleLogin = useCallback(async (email, password) => {
    const account = await loginRequest(settings.backendUrl, email, password);
    hydrateUser(account);
  }, [hydrateUser, settings.backendUrl]);

  const handleRegister = useCallback(async (payload) => {
    const account = await registerRequest(settings.backendUrl, payload);
    hydrateUser(account);
  }, [hydrateUser, settings.backendUrl]);

  const handleLogout = useCallback(() => {
    logoutRequest(settings.backendUrl).catch(() => {});
    setCurrentUser(null);
    setHistory([]);
    setTemplates([]);
    setSuites([]);
    setSettings((current) => ({
      ...defaultSettings,
      backendUrl: current.backendUrl || defaultSettings.backendUrl,
    }));
    setTestDraft("");
  }, [settings.backendUrl]);

  useEffect(() => {
    let active = true;
    const savedSession = readJson("hailtrace-qa:session:last", {}) || {};
    const savedBackendUrl = typeof savedSession.backendUrl === "string" && savedSession.backendUrl.trim()
      ? savedSession.backendUrl.trim()
      : defaultSettings.backendUrl;

    fetchSession(savedBackendUrl).then((account) => {
      if (!active) return;
      if (account?.email) {
        hydrateUser(account);
        setSettings((current) => ({
          ...current,
          backendUrl: savedBackendUrl,
        }));
      }
      setAuthReady(true);
    }).catch(() => {
      if (active) setAuthReady(true);
    });
    return () => {
      active = false;
    };
  }, [hydrateUser]);

  useEffect(() => {
    writeJson("hailtrace-qa:session:last", { backendUrl: settings.backendUrl });
  }, [settings.backendUrl]);

  return {
    authReady,
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
    handleLogin,
    handleRegister,
    handleLogout,
  };
}
