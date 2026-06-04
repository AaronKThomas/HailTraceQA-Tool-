import AcceptInvite from "./components/AcceptInvite";
import AppShell from "./components/AppShell";
import ForgotPassword from "./components/ForgotPassword";
import LoginScreen from "./components/LoginScreen";
import ResetPassword from "./components/ResetPassword";
import Toast from "./components/Toast";
import WorkspaceTabs from "./components/WorkspaceTabs";
import { useWorkspaceController } from "./hooks/useWorkspaceController";

// Lightweight pathname routing for the three public auth-flow pages. We
// intentionally avoid pulling in react-router for a 3-route surface — these
// pages are full-screen, do not share state with the main app, and benefit
// from a hard page reload between auth flow and authenticated app. The
// wrapper keeps the hook order in AuthenticatedApp stable per React's rules
// of hooks (the auth pages never invoke AuthenticatedApp's hook chain).
export default function App() {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  if (pathname.startsWith("/accept-invite")) return <AcceptInvite />;
  if (pathname.startsWith("/forgot-password")) return <ForgotPassword />;
  if (pathname.startsWith("/reset-password")) return <ResetPassword />;
  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const workspace = useWorkspaceController();

  if (!workspace.authReady) {
    return null;
  }

  if (!workspace.currentUser) {
    return (
      <>
        <LoginScreen onLogin={workspace.auth.handleLogin} onRegister={workspace.auth.handleRegister} />
        <Toast toast={workspace.toast} />
      </>
    );
  }

  return (
    <>
      <AppShell
        {...workspace.shell}
      >
        <WorkspaceTabs
          {...workspace.workspaceTabs}
        />
      </AppShell>
      <Toast toast={workspace.toast} />
    </>
  );
}
