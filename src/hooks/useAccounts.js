import { useCallback, useEffect, useState } from "react";
import { fetchAllAccounts, inviteUserRequest, registerRequest, removeAccount } from "../lib/api";

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
    if (!newUser.email.trim() || !newUser.displayName.trim() || !newUser.password || !newUser.confirm) {
      throw new Error("All fields required.");
    }
    if (newUser.password !== newUser.confirm) throw new Error("Passwords don't match.");
    if (newUser.password.length < 12) throw new Error("Min 12 characters.");
    await registerRequest(backendUrl, {
      email: newUser.email.trim().toLowerCase(),
      displayName: newUser.displayName.trim(),
      password: newUser.password,
    });
    await refreshAccounts();
  }, [backendUrl, refreshAccounts]);

  const inviteUser = useCallback(async (newInvite) => {
    if (!newInvite.email.trim() || !newInvite.displayName.trim()) {
      throw new Error("Email and display name are required.");
    }
    await inviteUserRequest(backendUrl, {
      email: newInvite.email.trim().toLowerCase(),
      displayName: newInvite.displayName.trim(),
    });
    await refreshAccounts();
  }, [backendUrl, refreshAccounts]);

  const deleteUser = useCallback(async (email) => {
    await removeAccount(backendUrl, email);
    await refreshAccounts();
  }, [backendUrl, refreshAccounts]);

  return { accounts, addUser, inviteUser, deleteUser, refreshAccounts };
}
