import { jsPDF } from "jspdf";
import { STATUS_CONFIG } from "./constants";

export const EXPORT_FORMATS = [
  { id: "txt", label: "Plain Text (.txt)", extension: "txt", mimeType: "text/plain" },
  { id: "csv", label: "CSV (.csv)", extension: "csv", mimeType: "text/csv" },
  { id: "json", label: "JSON (.json)", extension: "json", mimeType: "application/json" },
  { id: "html", label: "HTML (.html)", extension: "html", mimeType: "text/html" },
  { id: "pdf", label: "PDF (.pdf)", extension: "pdf", mimeType: "application/pdf" },
];

function downloadBlob(content, filename, mimeType) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function verdictFromOutput(output) {
  return output?.match(/VERDICT:\s*(.+)/)?.[1]?.trim() || "";
}

function summarizeTests(tests) {
  return {
    pass: tests.filter((test) => test.status === "pass").length,
    fail: tests.filter((test) => test.status === "fail").length,
    manual: tests.filter((test) => test.status === "manual").length,
  };
}

function normalizeTestRows(tests) {
  return tests.map((test, index) => ({
    index: index + 1,
    status: STATUS_CONFIG[test.status]?.label || test.status,
    description: test.description,
    jiraKey: test.jiraKey || "",
    verdict: verdictFromOutput(test.output),
    output: test.output || "",
  }));
}

function buildTestsReportMeta(tests, currentUser, title = "HailTrace QA Report") {
  const { pass, fail, manual } = summarizeTests(tests);
  return {
    title,
    tester: currentUser?.displayName || "",
    generated: new Date().toLocaleString(),
    generatedIso: new Date().toISOString(),
    summary: { pass, fail, manual },
  };
}

function buildTestsTextReport(meta, rows) {
  return [
    meta.title.toUpperCase(),
    `Tester: ${meta.tester}`,
    `Generated: ${meta.generated}`,
    `Results: ${meta.summary.pass} Pass / ${meta.summary.fail} Fail / ${meta.summary.manual} Manual`,
    "=".repeat(60),
    "",
    ...rows.map((row) =>
      [
        `[${row.status.toUpperCase()}] #${String(row.index).padStart(2, "0")}${row.jiraKey ? ` - ${row.jiraKey}` : ""}`,
        `Request: ${row.description.slice(0, 120)}`,
        row.verdict ? `Verdict: ${row.verdict}` : "",
        "",
        row.output || "(not run)",
        "-".repeat(40),
      ].filter(Boolean).join("\n"),
    ),
  ].join("\n");
}

function buildTestsCsv(rows) {
  const escape = (value) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
  return [
    ["#", "Status", "Description", "Jira Key", "Verdict"].join(","),
    ...rows.map((row) => [row.index, row.status, row.description, row.jiraKey, row.verdict].map(escape).join(",")),
  ].join("\n");
}

function buildTestsJson(meta, rows) {
  return JSON.stringify({
    title: meta.title,
    tester: meta.tester,
    generated: meta.generatedIso,
    summary: meta.summary,
    tests: rows.map((row) => ({
      index: row.index,
      status: row.status,
      description: row.description,
      jiraKey: row.jiraKey || null,
      verdict: row.verdict,
      output: row.output,
    })),
  }, null, 2);
}

function buildTestsHtml(meta, rows) {
  const rowHtml = rows.map((row) => `
    <section class="test">
      <h3>#${row.index} · ${row.status}${row.jiraKey ? ` · ${row.jiraKey}` : ""}</h3>
      <p class="desc">${escapeHtml(row.description)}</p>
      ${row.verdict ? `<p class="verdict"><strong>Verdict:</strong> ${escapeHtml(row.verdict)}</p>` : ""}
      <pre>${escapeHtml(row.output || "(not run)")}</pre>
    </section>
  `).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(meta.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 32px; color: #1d1d1f; background: #fff; }
    h1 { font-size: 22px; margin-bottom: 8px; }
    .meta { color: #6e6e73; font-size: 14px; margin-bottom: 24px; }
    .summary { display: flex; gap: 16px; margin-bottom: 28px; font-weight: 600; }
    .pass { color: #248a3d; } .fail { color: #d70015; } .manual { color: #9a6b00; }
    .test { border-top: 1px solid #e5e5ea; padding-top: 18px; margin-top: 18px; }
    .test h3 { font-size: 15px; margin-bottom: 8px; }
    .desc { margin-bottom: 8px; line-height: 1.5; }
    pre { white-space: pre-wrap; background: #f5f5f7; border-radius: 10px; padding: 12px; font-size: 12px; line-height: 1.5; }
  </style>
</head>
<body>
  <h1>${escapeHtml(meta.title)}</h1>
  <div class="meta">Tester: ${escapeHtml(meta.tester)} · Generated: ${escapeHtml(meta.generated)}</div>
  <div class="summary">
    <span class="pass">✓ ${meta.summary.pass} Pass</span>
    <span class="fail">✗ ${meta.summary.fail} Fail</span>
    <span class="manual">⚠ ${meta.summary.manual} Manual</span>
  </div>
  ${rowHtml}
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTestsPdf(meta, rows) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (height) => {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (y + height > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(meta.title, margin, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Tester: ${meta.tester}`, margin, y);
  y += 14;
  doc.text(`Generated: ${meta.generated}`, margin, y);
  y += 14;
  doc.text(`Results: ${meta.summary.pass} Pass / ${meta.summary.fail} Fail / ${meta.summary.manual} Manual`, margin, y);
  y += 22;

  rows.forEach((row) => {
    const header = `#${row.index} [${row.status}]${row.jiraKey ? ` ${row.jiraKey}` : ""}`;
    const body = [
      row.description,
      row.verdict ? `Verdict: ${row.verdict}` : "",
      row.output || "(not run)",
    ].filter(Boolean).join("\n\n");

    const headerLines = doc.splitTextToSize(header, maxWidth);
    const bodyLines = doc.splitTextToSize(body, maxWidth);
    const blockHeight = headerLines.length * 12 + bodyLines.length * 11 + 16;
    ensureSpace(blockHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(headerLines, margin, y);
    y += headerLines.length * 12 + 4;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(bodyLines, margin, y);
    y += bodyLines.length * 11 + 16;
  });

  return doc;
}

export function exportTestsReport(tests, format, currentUser) {
  const meta = buildTestsReportMeta(tests, currentUser);
  const rows = normalizeTestRows(tests);
  const stamp = dateStamp();

  switch (format) {
    case "json":
      downloadBlob(buildTestsJson(meta, rows), `hailtrace-qa-${stamp}.json`, "application/json");
      return;
    case "csv":
      downloadBlob(buildTestsCsv(rows), `hailtrace-qa-${stamp}.csv`, "text/csv");
      return;
    case "html":
      downloadBlob(buildTestsHtml(meta, rows), `hailtrace-qa-${stamp}.html`, "text/html");
      return;
    case "pdf":
      buildTestsPdf(meta, rows).save(`hailtrace-qa-${stamp}.pdf`);
      return;
    default:
      downloadBlob(buildTestsTextReport(meta, rows), `hailtrace-qa-${stamp}.txt`, "text/plain");
  }
}

export function exportSuiteReport(suite, tests, format, currentUser) {
  if (!suite) return;

  const suiteRows = suite.tests.map((test, index) => {
    const match = tests.find((result) => result.description === test.description);
    return {
      index: index + 1,
      status: STATUS_CONFIG[match?.status]?.label || match?.status || "not run",
      description: test.description,
      jiraKey: "",
      verdict: verdictFromOutput(match?.output),
      output: match?.output || "",
    };
  });

  const meta = {
    ...buildTestsReportMeta(suiteRows, currentUser, `HailTrace QA — Suite: ${suite.name}`),
    suiteName: suite.name,
    lastRun: suite.lastRun
      ? `${new Date(suite.lastRun).toLocaleString()} · pass ${suite.lastPass || 0} fail ${suite.lastFail || 0}`
      : "Not yet run",
  };

  const stamp = dateStamp();
  const safeName = suite.name.replace(/\s+/g, "-");
  const prefix = `suite-${safeName}-${stamp}`;

  switch (format) {
    case "json":
      downloadBlob(JSON.stringify({ ...meta, tests: suiteRows }, null, 2), `${prefix}.json`, "application/json");
      return;
    case "csv":
      downloadBlob(buildTestsCsv(suiteRows), `${prefix}.csv`, "text/csv");
      return;
    case "html":
      downloadBlob(buildTestsHtml(meta, suiteRows), `${prefix}.html`, "text/html");
      return;
    case "pdf":
      buildTestsPdf(meta, suiteRows).save(`${prefix}.pdf`);
      return;
    default: {
      const text = [
        buildTestsTextReport(meta, suiteRows),
        "",
        `Last run: ${meta.lastRun}`,
      ].join("\n");
      downloadBlob(text, `${prefix}.txt`, "text/plain");
    }
  }
}
