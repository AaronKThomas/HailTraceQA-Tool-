import { useEffect } from "react";

export default function ExportConfirmModal({
  open,
  formatLabel,
  title = "Confirm export",
  description,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") onCancel();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="export-confirm-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="export-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="export-confirm-icon" aria-hidden="true">↓</div>
        <h2 id="export-confirm-title" className="export-confirm-title">{title}</h2>
        <p className="export-confirm-copy">
          {description || `Download this report as ${formatLabel || "the selected format"}?`}
        </p>
        {formatLabel ? (
          <div className="export-confirm-format">
            <span className="export-confirm-format-label">Format</span>
            <span className="export-confirm-format-value">{formatLabel}</span>
          </div>
        ) : null}
        <div className="export-confirm-actions">
          <button type="button" className="ghost-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="run-btn export-confirm-download" onClick={onConfirm}>
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
