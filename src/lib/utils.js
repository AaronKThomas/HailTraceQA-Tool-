import { SECTION_HEADERS } from "./constants";

export function genId() {
  return Math.random().toString(36).slice(2, 9);
}

export function parseJiraUrl(str) {
  try {
    const match = new URL(str).pathname.match(/\/browse\/([A-Z]+-\d+)/);
    if (match) return match[1];
  } catch {}
  const bare = str.match(/^([A-Z]+-\d+)$/);
  return bare ? bare[1] : null;
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
