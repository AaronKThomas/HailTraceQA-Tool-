import { useEffect, useRef, useState } from "react";
import { EXPORT_FORMATS } from "../lib/export";

export default function ExportMenu({
  defaultFormat = "txt",
  onExport,
  disabled = false,
  label = "Export",
  compact = false,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const panelId = useRef(`export-menu-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function handleSelect(format) {
    setOpen(false);
    onExport(format);
  }

  function handleMainExport() {
    onExport(defaultFormat);
  }

  const defaultLabel = EXPORT_FORMATS.find((format) => format.id === defaultFormat)?.label || "Plain Text (.txt)";

  return (
    <div ref={rootRef} className={`export-menu-wrap ${compact ? "compact" : ""} ${className}`.trim()}>
      <div className="export-menu-trigger">
        <button
          type="button"
          className="ghost-btn export-menu-main"
          disabled={disabled}
          onClick={handleMainExport}
        >
          {label}
        </button>
        <button
          ref={buttonRef}
          type="button"
          className="ghost-btn export-menu-caret"
          disabled={disabled}
          aria-label="Choose export format"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={panelId.current}
          onClick={() => setOpen((current) => !current)}
        >
          ▾
        </button>
      </div>
      {open ? (
        <div id={panelId.current} className="export-menu-panel" aria-label="Export format options">
          <div className="export-menu-heading">Export as</div>
          {EXPORT_FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              className={`export-menu-item ${defaultFormat === format.id ? "active" : ""}`}
              onClick={() => handleSelect(format.id)}
            >
              <span>{format.label}</span>
              {defaultFormat === format.id ? <span className="export-menu-default">Default</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {!compact ? <span className="export-menu-hint">Default: {defaultLabel}</span> : null}
    </div>
  );
}
