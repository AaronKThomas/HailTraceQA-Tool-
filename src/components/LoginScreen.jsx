import { useMemo, useState } from "react";

export default function LoginScreen({ onLogin, onRegister }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    username: "",
    displayName: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isValid = useMemo(() => {
    if (mode === "login") return Boolean(form.username.trim() && form.password);
    return Boolean(form.username.trim() && form.displayName.trim() && form.password && form.confirm);
  }, [form, mode]);

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError("");

    try {
      if (mode === "login") {
        await onLogin(form.username.trim(), form.password);
      } else {
        if (form.password !== form.confirm) throw new Error("Passwords don't match.");
        if (form.password.length < 4) throw new Error("Password must be at least 4 characters.");
        await onRegister({
          username: form.username.trim(),
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
      <div className="login-card">
        <div className="seg-control">
          <div className="seg-pill" id="seg-pill" style={{ left: mode === "login" ? "3px" : "calc(50% + 1.5px)" }} />
          <button className={`seg-btn ${mode === "login" ? "active" : ""}`} onClick={() => setMode("login")}>Sign In</button>
          <button className={`seg-btn ${mode === "register" ? "active" : ""}`} onClick={() => setMode("register")}>Register</button>
        </div>
        <div className="login-fields">
          <div className="field-group">
            <label>Username</label>
            <input value={form.username} onChange={(event) => updateField("username", event.target.value)} placeholder="yourname" onKeyDown={(event) => event.key === "Enter" && handleSubmit()} />
          </div>
          {mode === "register" && (
            <div className="field-group">
              <label>Display Name</label>
              <input value={form.displayName} onChange={(event) => updateField("displayName", event.target.value)} placeholder="Your Name" onKeyDown={(event) => event.key === "Enter" && handleSubmit()} />
            </div>
          )}
          <div className="field-group">
            <label>Password</label>
            <input type="password" value={form.password} onChange={(event) => updateField("password", event.target.value)} placeholder="••••••" onKeyDown={(event) => event.key === "Enter" && handleSubmit()} />
          </div>
          {mode === "register" && (
            <div className="field-group">
              <label>Confirm Password</label>
              <input type="password" value={form.confirm} onChange={(event) => updateField("confirm", event.target.value)} placeholder="••••••" onKeyDown={(event) => event.key === "Enter" && handleSubmit()} />
            </div>
          )}
        </div>
        {error ? <div className="login-error">{error}</div> : null}
        <button className="login-btn" disabled={!isValid || submitting} onClick={handleSubmit}>
          {submitting ? (mode === "login" ? "Signing in…" : "Creating account…") : (mode === "login" ? "Sign In" : "Create Account")}
        </button>
        <div className="login-footer">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Register" : "Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}
