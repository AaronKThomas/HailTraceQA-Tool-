import { useEffect, useState } from "react";

export default function SettingsTab({
  settings,
  onSave,
  currentUser,
  accounts,
  onAddUser,
  onInviteUser,
  onRemoveUser,
  onLogout,
  onTestSlack,
  onTestZohoCliq,
}) {
  const [form, setForm] = useState(settings);
  const [newUser, setNewUser] = useState({ email: "", displayName: "", password: "", confirm: "" });
  const [newInvite, setNewInvite] = useState({ email: "", displayName: "" });
  const [adminMessage, setAdminMessage] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSave() {
    onSave(form);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  async function handleAddUser() {
    try {
      await onAddUser(newUser);
      setAdminMessage(`✓ ${newUser.displayName} added`);
      setNewUser({ email: "", displayName: "", password: "", confirm: "" });
    } catch (error) {
      setAdminMessage(error.message);
    }
    window.setTimeout(() => setAdminMessage(""), 3000);
  }

  async function handleInviteUser() {
    try {
      await onInviteUser(newInvite);
      setInviteMessage(`✓ Invite sent to ${newInvite.email}`);
      setNewInvite({ email: "", displayName: "" });
    } catch (error) {
      setInviteMessage(error.message);
    }
    window.setTimeout(() => setInviteMessage(""), 4000);
  }

  return (
    <div className="settings-wrap">
      <div className="settings-section stagger" style={{ animationDelay: "0ms" }}>
        <div className="settings-section-title">Connection</div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(10,132,255,0.15)" }}>🔌</div>
          <div className="settings-row-body">
            <div className="settings-row-label">Backend URL</div>
            <div className="settings-row-desc">Address of your local QA server</div>
            <input className="settings-input mono" value={form.backendUrl} onChange={(event) => updateField("backendUrl", event.target.value)} />
          </div>
        </div>
      </div>

      <div className="settings-section stagger" style={{ animationDelay: "30ms" }}>
        <div className="settings-section-title">Jira Integration</div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(0,82,204,0.15)" }}>🎫</div>
          <div className="settings-row-body">
            <div className="settings-row-label">Backend-managed</div>
            <div className="settings-row-desc">Jira access should be configured on the backend, not in the browser.</div>
          </div>
        </div>
      </div>

      <div className="settings-section stagger" style={{ animationDelay: "60ms" }}>
        <div className="settings-section-title">Slack Notifications</div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(74,21,75,0.2)" }}>💬</div>
          <div className="settings-row-body">
            <div className="settings-row-label">Backend-managed delivery</div>
            <div className="settings-row-desc">Slack routing should be configured on the backend. This UI only controls whether notifications are requested.</div>
            <button className="slack-test-btn" onClick={onTestSlack}>Test Delivery</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(255,69,58,0.15)" }}>🔴</div>
          <div className="settings-row-body"><div className="settings-row-label">Notify on Fail</div></div>
          <label className="settings-toggle"><input type="checkbox" checked={form.slackOnFail} onChange={(event) => updateField("slackOnFail", event.target.checked)} /><div className="toggle-track" /><div className="toggle-thumb" /></label>
        </div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(48,209,88,0.15)" }}>🟢</div>
          <div className="settings-row-body"><div className="settings-row-label">Notify on Pass</div></div>
          <label className="settings-toggle"><input type="checkbox" checked={form.slackOnPass} onChange={(event) => updateField("slackOnPass", event.target.checked)} /><div className="toggle-track" /><div className="toggle-thumb" /></label>
        </div>
      </div>

      <div className="settings-section stagger" style={{ animationDelay: "75ms" }}>
        <div className="settings-section-title">Zoho Cliq Notifications</div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(229,57,53,0.18)" }}>💼</div>
          <div className="settings-row-body">
            <div className="settings-row-label">Backend-managed delivery</div>
            <div className="settings-row-desc">Zoho Cliq routing should be configured on the backend. This UI only controls whether notifications are requested.</div>
            <button className="slack-test-btn" onClick={onTestZohoCliq}>Test Delivery</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(255,69,58,0.15)" }}>🔴</div>
          <div className="settings-row-body"><div className="settings-row-label">Notify on Fail</div></div>
          <label className="settings-toggle"><input type="checkbox" checked={form.zohoCliqOnFail} onChange={(event) => updateField("zohoCliqOnFail", event.target.checked)} /><div className="toggle-track" /><div className="toggle-thumb" /></label>
        </div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(48,209,88,0.15)" }}>🟢</div>
          <div className="settings-row-body"><div className="settings-row-label">Notify on Pass</div></div>
          <label className="settings-toggle"><input type="checkbox" checked={form.zohoCliqOnPass} onChange={(event) => updateField("zohoCliqOnPass", event.target.checked)} /><div className="toggle-track" /><div className="toggle-thumb" /></label>
        </div>
      </div>

      <div className="settings-section stagger" style={{ animationDelay: "90ms" }}>
        <div className="settings-section-title">Notifications</div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(255,159,10,0.15)" }}>🔔</div>
          <div className="settings-row-body"><div className="settings-row-label">Sound on test complete</div><div className="settings-row-desc">Play a chime when a test finishes</div></div>
          <label className="settings-toggle"><input type="checkbox" checked={form.soundOnComplete} onChange={(event) => updateField("soundOnComplete", event.target.checked)} /><div className="toggle-track" /><div className="toggle-thumb" /></label>
        </div>
      </div>

      <div className="settings-section stagger" style={{ animationDelay: "110ms" }}>
        <div className="settings-section-title">Appearance</div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(128,128,128,0.15)" }}>🌓</div>
          <div className="settings-row-body">
            <div className="settings-row-label">Theme</div>
            <select className="settings-select" value={form.theme} onChange={(event) => updateField("theme", event.target.value)}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
        </div>
      </div>

      <div className="settings-section stagger" style={{ animationDelay: "130ms" }}>
        <div className="settings-section-title">Export</div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(48,209,88,0.15)" }}>📄</div>
          <div className="settings-row-body">
            <div className="settings-row-label">Default export format</div>
            <select className="settings-select" value={form.exportFormat} onChange={(event) => updateField("exportFormat", event.target.value)}>
              <option value="txt">Plain Text (.txt)</option>
              <option value="csv">CSV (.csv)</option>
              <option value="json">JSON (.json)</option>
              <option value="html">HTML (.html)</option>
              <option value="pdf">PDF (.pdf)</option>
            </select>
            <div className="settings-row-desc" style={{ marginTop: 8 }}>Used when you click Export, or pick another format from the export menu.</div>
          </div>
        </div>
      </div>

      <div className="settings-section stagger" style={{ animationDelay: "150ms" }}>
        <div className="settings-section-title">Account</div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(10,132,255,0.15)" }}>👤</div>
          <div className="settings-row-body">
            <div className="settings-row-label">Display Name</div>
            <input className="settings-input" value={form.displayName || currentUser.displayName} onChange={(event) => updateField("displayName", event.target.value)} />
            <div className="settings-row-desc" style={{ marginTop: 6 }}>Role: {currentUser.role === "admin" ? "Admin" : "Tester"}</div>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-icon" style={{ background: "rgba(255,69,58,0.15)" }}>🚪</div>
          <div className="settings-row-body">
            <div className="settings-row-label">Sign Out</div>
            <div style={{ marginTop: 6 }}><button className="danger-btn" onClick={onLogout}>Sign out of HailTrace QA</button></div>
          </div>
        </div>
      </div>

      {currentUser.role === "admin" ? (
        <div className="settings-section stagger" style={{ animationDelay: "170ms" }}>
          <div className="settings-section-title">Admin — User Management</div>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Invite User by Email</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              Sends a one-time link so the new user can set their own password. Link expires in 72 hours.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <input className="settings-input" type="email" autoComplete="off" placeholder="email@hailtrace.com" value={newInvite.email} onChange={(event) => setNewInvite((current) => ({ ...current, email: event.target.value }))} />
              <input className="settings-input" placeholder="Display Name" value={newInvite.displayName} onChange={(event) => setNewInvite((current) => ({ ...current, displayName: event.target.value }))} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="settings-save-btn" style={{ marginTop: 0 }} onClick={handleInviteUser}>Send Invite</button>
              <span style={{ fontSize: 12, color: inviteMessage.startsWith("✓") ? "var(--pass)" : "var(--fail)" }}>{inviteMessage}</span>
            </div>
          </div>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Add New User (set password directly)</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              Use this only when you cannot email the user. Avoid hand-rolled passwords when an invite is possible.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input className="settings-input" type="email" autoComplete="off" placeholder="email@hailtrace.com" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} />
              <input className="settings-input" placeholder="Display Name" value={newUser.displayName} onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <input className="settings-input" type="password" placeholder="Password (12+ chars)" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} />
              <input className="settings-input" type="password" placeholder="Confirm Password" value={newUser.confirm} onChange={(event) => setNewUser((current) => ({ ...current, confirm: event.target.value }))} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="settings-save-btn" style={{ marginTop: 0 }} onClick={handleAddUser}>Add User</button>
              <span style={{ fontSize: 12, color: adminMessage.startsWith("✓") ? "var(--pass)" : "var(--fail)" }}>{adminMessage}</span>
            </div>
          </div>
          <div>
            {!accounts.length ? (
              <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>No accounts found or your session does not have access.</div>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr><th>Email</th><th>Display Name</th><th>Role</th><th>Status</th><th>Added</th><th /></tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.email}>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{account.email}</td>
                      <td>{account.displayName}</td>
                      <td><span className="admin-badge" style={{ background: account.role === "admin" ? "rgba(10,132,255,0.15)" : "rgba(48,209,88,0.15)", color: account.role === "admin" ? "var(--accent)" : "var(--pass)" }}>{account.role}</span></td>
                      <td>{account.status === "pending"
                        ? <span className="admin-badge" style={{ background: "rgba(255,159,10,0.18)", color: "#ff9f0a" }}>pending</span>
                        : <span className="admin-badge" style={{ background: "rgba(120,120,120,0.15)", color: "var(--muted)" }}>active</span>}
                      </td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{account.registeredAt ? new Date(account.registeredAt).toLocaleDateString() : "—"}</td>
                      <td>{account.email !== currentUser.email ? <button className="danger-btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => onRemoveUser(account.email)}>Remove</button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}

      <div className="stagger" style={{ animationDelay: "200ms", display: "flex", alignItems: "center", paddingBottom: 32 }}>
        <button className="settings-save-btn" onClick={handleSave}>Save Settings</button>
        <span className={`settings-saved-msg ${saved ? "show" : ""}`}>✓ Saved</span>
      </div>
    </div>
  );
}
