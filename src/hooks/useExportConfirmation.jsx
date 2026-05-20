import { useCallback, useMemo, useState } from "react";
import ExportConfirmModal from "../components/ExportConfirmModal";
import { EXPORT_FORMATS } from "../lib/export";

export function useExportConfirmation(onExport, {
  title = "Export report?",
  getDescription,
} = {}) {
  const [pendingFormat, setPendingFormat] = useState(null);

  const formatLabel = useMemo(
    () => EXPORT_FORMATS.find((format) => format.id === pendingFormat)?.label || "",
    [pendingFormat],
  );

  const requestExport = useCallback((format) => {
    setPendingFormat(format);
  }, []);

  const cancelExport = useCallback(() => {
    setPendingFormat(null);
  }, []);

  const confirmExport = useCallback(async () => {
    if (!pendingFormat) return;
    await onExport(pendingFormat);
    setPendingFormat(null);
  }, [onExport, pendingFormat]);

  const exportModal = (
    <ExportConfirmModal
      open={pendingFormat !== null}
      formatLabel={formatLabel}
      title={title}
      description={getDescription?.(pendingFormat)}
      onConfirm={confirmExport}
      onCancel={cancelExport}
    />
  );

  return { requestExport, exportModal };
}
