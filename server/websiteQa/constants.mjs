export const MAX_LINK_CHECKS = 10;
export const LINK_CHECK_CONCURRENCY = 3;
export const MAX_ACTION_STEPS = 8;
export const MAX_ACTION_TEXT_LENGTH = 200;
export const MAX_SELECTOR_LENGTH = 160;
// Bounds how far down a list of checkboxes a plan may reach, so a plan cannot
// scan an unbounded number of controls.
export const MAX_CHECKBOX_INDEX = 50;
export const NAVIGATION_TIMEOUT_MS = 30000;
export const LINK_TIMEOUT_MS = 6000;
export const STEP_TIMEOUT_MS = 30000;
// Map layers often render after checkbox/API updates and tile work settles.
// Give map-specific verification more time than ordinary button/text steps.
export const MAP_INTERACTION_TIMEOUT_MS = 60000;
export const MAP_RENDER_SETTLE_MS = 3000;
export const ACTION_PLAN_VERSION = 1;

// Each run launches a headless Chromium (hundreds of MB). The per-user rate
// limit bounds requests over time but NOT how many run at once, so a burst of
// concurrent requests could exhaust memory. These caps bound in-flight work
// process-wide: at most MAX_CONCURRENT_PLAYWRIGHT run simultaneously, with a
// short waiting line; requests beyond the queue are rejected fast (503) rather
// than piling up and timing out. Conservative defaults — tune if the host has
// more headroom.
export const MAX_CONCURRENT_PLAYWRIGHT = 2;
export const MAX_QUEUED_PLAYWRIGHT = 8;

// Intentionally map-specific. Generic [role=dialog]/[role=tooltip] match
// unrelated widgets (chat, consent, onboarding) and caused false positives,
// so they are excluded from the default. Callers can still pass an explicit
// selector when they really want to assert a generic dialog.
export const DEFAULT_POPUP_SELECTOR = [
  ".mapboxgl-popup",
  ".leaflet-popup",
  "[data-testid='popup']",
  "[data-testid='map-popup']",
].join(", ");

export const DEFAULT_MAP_SELECTOR = [
  ".mapboxgl-canvas",
  ".leaflet-container",
  "[data-testid='map']",
  "canvas",
].join(", ");

export const ACTION_PLAN_ACTIONS = [
  "navigate",
  "clickText",
  "clickRole",
  "clickSelector",
  "panMap",
  "selectCheckbox",
  "fillLabel",
  "fillSearch",
  "waitForText",
  "expectText",
  "expectVisible",
  "expectPopupLikeElement",
];

export const ACTION_PLAN_ROLES = [
  "button",
  "link",
  "checkbox",
  "combobox",
  "menuitem",
  "option",
  "radio",
  "tab",
  "textbox",
];

export const ALLOWED_ACTIONS = new Set(ACTION_PLAN_ACTIONS);
export const ALLOWED_ROLES = new Set(ACTION_PLAN_ROLES);
