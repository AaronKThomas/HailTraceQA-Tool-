import { useEffect, useMemo, useState } from "react";
import { resetPasswordRequest, validateResetToken } from "../lib/api";
import { defaultSettings } from "../lib/constants";

export default function ResetPassword() {
  const backendUrl = defaultSettings.backendUrl;

  const [tokenState, setTokenState] = useState({ status: "loading" });
  const [form, setForm] = useState({ password: "", confirm: "" });
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
    validateResetToken(backendUrl, token).then((result) => {
      if (!active) return;
      if (result?.valid) {
        setTokenState({ status: "valid", email: result.email });
      } else {
        setTokenState({ status: "invalid" });
      }
    });
    return () => {
      active = false;
    };
  }, [backendUrl, token]);

  const passwordsMatch = form.password === form.confirm;
  const isValid = form.password.length >= 12 && passwordsMatch;

  async function handleSubmit() {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await resetPasswordRequest(backendUrl, { token, password: form.password });
      setDone(true);
    } catch (submissionError) {
      setError(submissionError.message);
      setSubmitting(false);
    }
  }

  return (
    <div id="login-screen">
      <div className="login-wordmark">
        <h1>HailTrace QA</h1>
        <div className="login-subtitle">Set a new password</div>
      </div>
      <div className="login-card">
        {tokenState.status === "loading" && (
          <div className="login-fields" role="status" aria-live="polite">Checking your reset link…</div>
        )}
        {tokenState.status === "invalid" && (
          <div className="login-fields">
            <div className="login-error" role="alert">This reset link is invalid or has expired.</div>
            <div className="login-footer">
              <a href="/forgot-password">Request a new link</a>
              {" · "}
              <a href="/">Return to sign in</a>
            </div>
          </div>
        )}
        {tokenState.status === "valid" && !done && (
          <>
            <div className="login-fields">
              <div className="field-group">
                <label htmlFor="reset-email">Email</label>
                <input id="reset-email" type="email" value={tokenState.email} disabled readOnly />
              </div>
              <div className="field-group">
                <label htmlFor="reset-new-password">New password</label>
                <input
                  id="reset-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="12+ characters"
                  onKeyDown={(event) => event.key === "Enter" && handleSubmit()}
                />
              </div>
              <div className="field-group">
                <label htmlFor="reset-confirm-password">Confirm new password</label>
                <input
                  id="reset-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={(event) => setForm((current) => ({ ...current, confirm: event.target.value }))}
                  onKeyDown={(event) => event.key === "Enter" && handleSubmit()}
                />
              </div>
            </div>
            {error ? <div className="login-error" role="alert">{error}</div> : null}
            <button className="login-btn" disabled={!isValid || submitting} onClick={handleSubmit}>
              {submitting ? "Updating…" : "Update password"}
            </button>
          </>
        )}
        {done && (
          <>
            <div className="login-fields" role="status" aria-live="polite">
              <p style={{ margin: 0, color: "var(--text)", fontSize: 14, lineHeight: 1.5 }}>
                Your password has been updated. All existing sessions for this
                account have been signed out. Please sign in with your new
                password.
              </p>
            </div>
            <div className="login-footer">
              <a href="/">Sign in</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
