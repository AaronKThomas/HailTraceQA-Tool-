import { useCallback, useEffect, useState } from "react";
import { loginRequest, registerRequest } from "../lib/api";
import { defaultSettings } from "../lib/constants";
import { readJson, removeJson, writeJson } from "../lib/storage";

const SESSION_KEY = "hailtrace-qa:session";

function getUserKey(prefix, username) {
  return `${prefix}:${username}`;
}

export function useAuth() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [history, setHistory] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [suites, setSuites] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [testDraft, setTestDraft] = useState("");

  const hydrateUser = useCallback((account) => {
    const savedSettings = readJson(getUserKey("settings", account.username), {}) || {};

    // User hydration is the boundary between the anonymous shell and the
    // persisted per-user workspace stored in the browser.
    writeJson(SESSION_KEY, {
      username: account.username,
      displayName: account.displayName,
      registeredAt: account.registeredAt,
    });
    setCurrentUser(account);
    setHistory((readJson(getUserKey("history", account.username), []) || []).map((entry) => ({
      ...entry,
      timestamp: new Date(entry.timestamp),
    })));
    setTemplates(readJson(getUserKey("templates", account.username), []) || []);
    setSuites(readJson(getUserKey("suites", account.username), []) || []);
    setSettings({
      ...defaultSettings,
      ...savedSettings,
      displayName: savedSettings.displayName || account.displayName,
    });
    setTestDraft("");
  }, []);

  const handleLogin = useCallback(async (username, password) => {
    const account = await loginRequest(settings.backendUrl, username, password);
    hydrateUser(account);
  }, [hydrateUser, settings.backendUrl]);

  const handleRegister = useCallback(async (payload) => {
    const account = await registerRequest(settings.backendUrl, payload);
    hydrateUser(account);
  }, [hydrateUser, settings.backendUrl]);

  const handleLogout = useCallback(() => {
    removeJson(SESSION_KEY);
    setCurrentUser(null);
    setHistory([]);
    setTemplates([]);
    setSuites([]);
    setSettings(defaultSettings);
    setTestDraft("");
  }, []);

  useEffect(() => {
    const savedSession = readJson(SESSION_KEY);
    if (savedSession?.username) {
      hydrateUser(savedSession);
    }
    setAuthReady(true);
  }, [hydrateUser]);

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
