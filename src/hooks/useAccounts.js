import { useCallback, useEffect, useState } from "react";
import { fetchAllAccounts, registerRequest, removeAccount } from "../lib/api";

export function useAccounts(backendUrl, currentUser) {
  const [accounts, setAccounts] = useState([]);

  const refreshAccounts = useCallback(async () => {
    const registered = await fetchAllAccounts(backendUrl);
    setAccounts(registered.map((account) => ({ ...account, type: "registered" })));
    return registered;
  }, [backendUrl]);

  useEffect(() => {
    if (!currentUser || currentUser.role !== "admin") {
      setAccounts([]);
      return;
    }
    refreshAccounts();
  }, [currentUser, refreshAccounts]);

  const addUser = useCallback(async (newUser) => {
    if (!newUser.username.trim() || !newUser.displayName.trim() || !newUser.password || !newUser.confirm) {
      throw new Error("All fields required.");
    }
    if (newUser.password !== newUser.confirm) throw new Error("Passwords don't match.");
    if (newUser.password.length < 12) throw new Error("Min 12 characters.");
    await registerRequest(backendUrl, {
      username: newUser.username.trim(),
      displayName: newUser.displayName.trim(),
      password: newUser.password,
    });
    await refreshAccounts();
  }, [backendUrl, refreshAccounts]);

  const deleteUser = useCallback(async (username) => {
    await removeAccount(backendUrl, username);
    await refreshAccounts();
  }, [backendUrl, refreshAccounts]);

  return { accounts, addUser, deleteUser, refreshAccounts };
}
