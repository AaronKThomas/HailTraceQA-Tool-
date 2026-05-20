import { useEffect, useMemo, useState } from "react";
import { acceptInviteRequest, validateInviteToken } from "../lib/api";
import { defaultSettings } from "../lib/constants";

export default function AcceptInvite() {
  const backendUrl = defaultSettings.backendUrl;

  const [tokenState, setTokenState] = useState({ status: "loading" });
  const [form, setForm] = useState({ password: "", confirm: "", displayName: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const token = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }, []);

  useEffect(() => {
    let active = true;
    if (!token) {
      setTokenState({ status: "invalid" });
      return undefined;
    }
    validateInviteToken(backendUrl, token).then((result) => {
      if (!active) return;
      if (result?.valid) {
        setTokenState({ status: "valid", email: result.email, displayName: result.displayName });
        setForm((current) => ({ ...current, displayName: result.displayName || "" }));
      } else {
        setTokenState({ status: "invalid" });
      }
    });
    return () => {
      active = false;
    };
  }, [backendUrl, token]);

  const passwordsMatch = form.password === form.confirm;
  const isValid = form.password.length >= 12 && passwordsMatch && form.displayName.trim().length >= 2;

  async function handleSubmit() {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await acceptInviteRequest(backendUrl, {
        token,
        password: form.password,
        displayName: form.displayName.trim(),
      });
      setDone(true);
      window.setTimeout(() => {
        window.location.assign("/");
      }, 1200);
    } catch (submissionError) {
      setError(submissionError.message);
      setSubmitting(false);
    }
  }

  return (
    <div id="login-screen">
      <div className="login-wordmark">
        <h1>HailTrace QA</h1>
        <div className="login-subtitle">Set your password</div>
      </div>
      <div className="login-card">
        {tokenState.status === "loading" && (
          <div className="login-fields">Checking your invite…</div>
        )}
        {tokenState.status === "invalid" && (
          <div className="login-fields">
            <div className="login-error">This invite link is invalid or has expired.</div>
            <a className="login-footer" href="/">Return to sign in</a>
          </div>
        )}
        {tokenState.status === "valid" && !done && (
          <>
            <div className="login-fields">
              <div className="field-group">
                <label>Email</label>
                <input type="email" value={tokenState.email} disabled readOnly />
              </div>
              <div className="field-group">
                <label>Display name</label>
                <input
                  value={form.displayName}
                  onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                  onKeyDown={(event) => event.key === "Enter" && handleSubmit()}
                />
              </div>
              <div className="field-group">
                <label>Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="12+ characters"
                  onKeyDown={(event) => event.key === "Enter" && handleSubmit()}
                />
              </div>
              <div className="field-group">
                <label>Confirm password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={(event) => setForm((current) => ({ ...current, confirm: event.target.value }))}
                  onKeyDown={(event) => event.key === "Enter" && handleSubmit()}
                />
              </div>
            </div>
            {error ? <div className="login-error">{error}</div> : null}
            <button className="login-btn" disabled={!isValid || submitting} onClick={handleSubmit}>
              {submitting ? "Setting password…" : "Set password and sign in"}
            </button>
          </>
        )}
        {done && (
          <div className="login-fields">Welcome aboard. Redirecting you to the app…</div>
        )}
      </div>
    </div>
  );
}
