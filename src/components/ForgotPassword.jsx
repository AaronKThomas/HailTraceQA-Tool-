import { useState } from "react";
import { forgotPasswordRequest } from "../lib/api";
import { defaultSettings } from "../lib/constants";

export default function ForgotPassword() {
  const backendUrl = defaultSettings.backendUrl;
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    // The server always returns 200 to prevent enumeration. We mirror that
    // here: success message is shown even if the email is unknown. The only
    // visible side-channel left is timing, which the server's silent rate
    // limit also softens.
    await forgotPasswordRequest(backendUrl, email.trim().toLowerCase());
    setSent(true);
    setSubmitting(false);
  }

  return (
    <div id="login-screen">
      <div className="login-wordmark">
        <h1>HailTrace QA</h1>
        <div className="login-subtitle">Reset your password</div>
      </div>
      <div className="login-card">
        {!sent ? (
          <>
            <div className="login-fields">
              <div className="field-group">
                <label>Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@hailtrace.com"
                  onKeyDown={(event) => event.key === "Enter" && handleSubmit()}
                />
              </div>
            </div>
            <button className="login-btn" disabled={!email.trim() || submitting} onClick={handleSubmit}>
              {submitting ? "Sending…" : "Send reset link"}
            </button>
            <div className="login-footer">
              <a href="/">Back to sign in</a>
            </div>
          </>
        ) : (
          <>
            <div className="login-fields">
              <p style={{ margin: 0, color: "var(--text)", fontSize: 14, lineHeight: 1.5 }}>
                If an account exists for that email, we have sent a reset link.
                Check your inbox. The link expires in 1 hour.
              </p>
            </div>
            <div className="login-footer">
              <a href="/">Return to sign in</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
