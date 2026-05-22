import { useEffect, useId, useRef } from "react";

export default function ExportConfirmModal({
  open,
  formatLabel,
  title = "Confirm export",
  description,
  onConfirm,
  onCancel,
}) {
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const focusable = modalRef.current?.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") onCancel();
      if (event.key !== "Tab" || !modalRef.current) return;
      const nodes = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const items = Array.from(nodes).filter((node) => !node.hasAttribute("disabled"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="export-confirm-backdrop" role="presentation" onClick={onCancel}>
      <div
        ref={modalRef}
        className="export-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-confirm-title"
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="export-confirm-icon" aria-hidden="true">↓</div>
        <h2 id="export-confirm-title" className="export-confirm-title">{title}</h2>
        <p id={descriptionId} className="export-confirm-copy">
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
