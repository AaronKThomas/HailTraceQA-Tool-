export default function Toast({ toast }) {
  if (!toast) return null;
  const isError = toast.type === "fail";
  return (
    <div
      className={`toast show ${toast.type || ""}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      {toast.message}
    </div>
  );
}
