import { SECTION_HEADERS } from "./constants";

export function genId() {
  return Math.random().toString(36).slice(2, 9);
}

export function parseJiraUrl(str) {
  const input = String(str || "").trim();
  if (!input) return null;

  const bare = input.match(/^([A-Za-z][A-Za-z0-9]+-\d+)$/);
  if (bare) return bare[1].toUpperCase();

  try {
    const url = new URL(input);
    const browse = url.pathname.match(/\/browse\/([A-Za-z][A-Za-z0-9]+-\d+)/i);
    if (browse) return browse[1].toUpperCase();

    const selected = url.searchParams.get("selectedIssue");
    if (selected && /^[A-Za-z][A-Za-z0-9]+-\d+$/i.test(selected)) {
      return selected.toUpperCase();
    }

    const issuePath = url.pathname.match(/\/issues\/([A-Za-z][A-Za-z0-9]+-\d+)/i);
    if (issuePath) return issuePath[1].toUpperCase();
  } catch {
    // not a URL
  }

  return null;
}

export function parseOutput(text) {
  if (!text) return [];
  const sections = [];
  for (let index = 0; index < SECTION_HEADERS.length; index += 1) {
    const header = SECTION_HEADERS[index];
    const next = SECTION_HEADERS[index + 1];
    const start = text.indexOf(header);
    if (start === -1) continue;
    const end = next ? text.indexOf(next) : text.lastIndexOf("VERDICT:");
    sections.push({
      header,
      content: text.slice(start + header.length, end === -1 ? undefined : end).trim(),
    });
  }
  const verdict = text.match(/VERDICT:\s*(PASS|FAIL|NEEDS MANUAL CHECK)/);
  if (verdict) sections.push({ header: "VERDICT", content: verdict[1] });
  return sections;
}

export function playChime(status) {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.frequency.value = status === "pass" ? 880 : 440;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.3, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.5);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.5);
  } catch {}
}
