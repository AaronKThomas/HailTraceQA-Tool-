import { useMemo, useState } from "react";

export default function LoginScreen({ onLogin, onRegister }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    email: "",
    displayName: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isValid = useMemo(() => {
    if (mode === "login") return Boolean(form.email.trim() && form.password);
    return Boolean(form.email.trim() && form.displayName.trim() && form.password && form.confirm);
  }, [form, mode]);

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError("");

    try {
      if (mode === "login") {
        await onLogin(form.email.trim().toLowerCase(), form.password);
      } else {
        if (form.password !== form.confirm) throw new Error("Passwords don't match.");
        if (form.password.length < 12) throw new Error("Password must be at least 12 characters.");
        await onRegister({
          email: form.email.trim().toLowerCase(),
          displayName: form.displayName.trim(),
          password: form.password,
        });
      }
    } catch (submissionError) {
      setError(submissionError.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div id="login-screen">
      <div className="login-wordmark">
        <h1>HailTrace QA</h1>
        <div className="login-subtitle">
          {mode === "login" ? "Sign in to your account" : "Create your account"}
        </div>
      </div>
      <div className="login-card" aria-live="polite">
        <div className="seg-control">
          <div className="seg-pill" id="seg-pill" style={{ left: mode === "login" ? "3px" : "calc(50% + 1.5px)" }} />
          <button type="button" className={`seg-btn ${mode === "login" ? "active" : ""}`} aria-pressed={mode === "login"} onClick={() => setMode("login")}>Sign In</button>
          <button type="button" className={`seg-btn ${mode === "register" ? "active" : ""}`} aria-pressed={mode === "register"} onClick={() => setMode("register")}>Register</button>
        </div>
        <div className="login-fields">
          <div className="field-group">
            <label htmlFor="login-email">Email</label>
            <input id="login-email" type="email" autoComplete="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} placeholder="you@hailtrace.com" onKeyDown={(event) => event.key === "Enter" && handleSubmit()} />
          </div>
          {mode === "register" && (
            <div className="field-group">
              <label htmlFor="register-display-name">Display Name</label>
              <input id="register-display-name" value={form.displayName} onChange={(event) => updateField("displayName", event.target.value)} placeholder="Your Name" onKeyDown={(event) => event.key === "Enter" && handleSubmit()} />
            </div>
          )}
          <div className="field-group">
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" value={form.password} onChange={(event) => updateField("password", event.target.value)} placeholder={mode === "register" ? "12+ characters" : "••••••"} onKeyDown={(event) => event.key === "Enter" && handleSubmit()} />
          </div>
          {mode === "register" && (
            <div className="field-group">
              <label htmlFor="register-confirm-password">Confirm Password</label>
              <input id="register-confirm-password" type="password" value={form.confirm} onChange={(event) => updateField("confirm", event.target.value)} placeholder="••••••" onKeyDown={(event) => event.key === "Enter" && handleSubmit()} />
            </div>
          )}
        </div>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <button className="login-btn" disabled={!isValid || submitting} onClick={handleSubmit}>
          {submitting ? (mode === "login" ? "Signing in…" : "Creating account…") : (mode === "login" ? "Sign In" : "Create Account")}
        </button>
        {mode === "login" ? (
          <div className="login-footer" style={{ marginTop: 8 }}>
            <a href="/forgot-password">Forgot your password?</a>
          </div>
        ) : null}
        <div className="login-footer">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Register" : "Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}
