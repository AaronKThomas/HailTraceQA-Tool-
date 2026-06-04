import {
  ACTION_PLAN_VERSION,
  ALLOWED_ACTIONS,
  ALLOWED_ROLES,
  DEFAULT_MAP_SELECTOR,
  DEFAULT_POPUP_SELECTOR,
  MAX_ACTION_STEPS,
  MAX_ACTION_TEXT_LENGTH,
  MAX_CHECKBOX_INDEX,
  MAX_SELECTOR_LENGTH,
  STEP_TIMEOUT_MS,
} from "./constants.mjs";
import { assertSafeWebsiteUrl, ensureSameOrigin, extractFirstHttpUrl } from "./urlSafety.mjs";

function cleanString(value, fieldName, maxLength = MAX_ACTION_TEXT_LENGTH) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${fieldName} is required.`);
  if (text.length > maxLength) throw new Error(`${fieldName} is too long.`);
  return text;
}

function normalizeTimeout(value) {
  if (value === undefined || value === null || value === "") return STEP_TIMEOUT_MS;
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > STEP_TIMEOUT_MS) {
    throw new Error(`Step timeout must be between 500 and ${STEP_TIMEOUT_MS}ms.`);
  }
  return timeoutMs;
}

function isSafeSelectorPart(selector) {
  return /^#[A-Za-z][\w:-]*$/.test(selector)
    || /^\.[A-Za-z][\w:-]*$/.test(selector)
    || /^[a-z][a-z0-9-]*$/i.test(selector)
    || /^\[data-testid=(?:"[A-Za-z0-9:_ -]{1,80}"|'[A-Za-z0-9:_ -]{1,80}'|[A-Za-z0-9:_-]{1,80})\]$/.test(selector)
    || /^\[aria-label=(?:"[A-Za-z0-9:_ .-]{1,80}"|'[A-Za-z0-9:_ .-]{1,80}')\]$/.test(selector);
}

function cleanSelector(value) {
  const selector = cleanString(value, "selector", MAX_SELECTOR_LENGTH);
  const parts = selector.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || !parts.every(isSafeSelectorPart)) {
    throw new Error("Selector is not allowed. Use a simple tag, id, class, data-testid, or aria-label selector.");
  }
  return parts.join(", ");
}

function normalizeCheckboxIndex(value) {
  if (value === undefined || value === null || value === "") return 0;
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index > MAX_CHECKBOX_INDEX) {
    throw new Error(`Checkbox index must be an integer between 0 and ${MAX_CHECKBOX_INDEX}.`);
  }
  return index;
}

function normalizeClickPosition(position) {
  if (!position) return null;
  const xRatio = Number(position.xRatio ?? position.x);
  const yRatio = Number(position.yRatio ?? position.y);
  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio) || xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) {
    throw new Error("Click position must use xRatio/yRatio values between 0 and 1.");
  }
  return { xRatio, yRatio };
}

function normalizePanDirection(value) {
  const direction = String(value || "right").trim().toLowerCase();
  if (!["up", "down", "left", "right"].includes(direction)) {
    throw new Error("Pan direction must be up, down, left, or right.");
  }
  return direction;
}

function normalizePanDistance(value) {
  if (value === undefined || value === null || value === "") return 220;
  const distance = Number(value);
  if (!Number.isInteger(distance) || distance < 40 || distance > 500) {
    throw new Error("Pan distance must be an integer between 40 and 500 pixels.");
  }
  return distance;
}

function isHailTraceTarget(url) {
  try {
    return /(^|\.)hailtrace\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function describesSearch(text) {
  return /\b(search|find|look up|lookup)\b/i.test(String(text || ""));
}

function describesWeatherEventDownload(text) {
  const value = String(text || "");
  return /\bdownload\b/i.test(value)
    && /\b(storm date|storm dates|weather[ -]?event|weather events|hailtrace|maps?|hail)\b/i.test(value);
}

function describesWeatherEventMapInspection(text) {
  const value = String(text || "");
  return (
    /\b(search|find|look up|lookup|check|select|verify|test)\b/i.test(value)
    && /\b(storm date|storm dates|weather[ -]?event|weather events|hail|swaths?|polygons?|maps?)\b/i.test(value)
  ) || (
    /\b(swaths?|polygons?)\b/i.test(value)
    && /\b(map|canvas|hailtrace|weather[ -]?event|storm)\b/i.test(value)
  );
}

function describesMapPan(text) {
  const value = String(text || "");
  return /\b(pan|drag|move)\b/i.test(value) && /\b(map|canvas|polygons?|tiles?)\b/i.test(value);
}

function inferSearchValue(description) {
  const text = String(description || "");
  const match = text.match(/\b(?:search|find|look up|lookup)(?:\s+for)?\s+["“]?([^"”\n.]+)["”]?/i);
  const candidate = String(match?.[1] || "").trim();
  if (!candidate || /\b(weather event|weather events|event|events|functionality|hailtrace|maps? page)\b/i.test(candidate)) {
    return "hail";
  }
  return candidate.slice(0, MAX_ACTION_TEXT_LENGTH);
}

function actionNeedsSelector(action) {
  return action === "clickSelector" || action === "expectVisible" || action === "panMap";
}

function isMissingSelectorError(error, rawStep) {
  const action = String(rawStep?.action || rawStep?.type || "");
  return actionNeedsSelector(action) && error?.message === "selector is required.";
}

function isGeneratedDownloadTextStep(rawStep) {
  const action = String(rawStep?.action || rawStep?.type || "");
  const text = String(rawStep?.text || rawStep?.name || "");
  return /\bdownload\b/i.test(text)
    && (
      action === "clickText"
      || action === "waitForText"
      || action === "expectText"
      || action === "clickRole"
    );
}

function isGeneratedPolygonTextStep(rawStep) {
  const action = String(rawStep?.action || rawStep?.type || "");
  const text = String(rawStep?.text || rawStep?.name || "");
  return /\b(polygons?|map layer|map layers|shape|shapes)\b/i.test(text)
    && (
      action === "clickText"
      || action === "waitForText"
      || action === "expectText"
      || action === "clickRole"
    );
}

function insertStepAfterLatest(steps, step, preferredActions) {
  let insertAt = 0;
  for (let index = 0; index < steps.length; index += 1) {
    if (preferredActions.includes(steps[index].action)) {
      insertAt = index + 1;
    }
  }
  steps.splice(insertAt, 0, step);
}

function normalizeActionStep(step, index) {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new Error(`Action step ${index + 1} must be an object.`);
  }
  const action = cleanString(step.action || step.type, `steps[${index}].action`, 40);
  if (!ALLOWED_ACTIONS.has(action)) {
    throw new Error(`Action "${action}" is not allowed.`);
  }
  const normalized = {
    action,
    timeoutMs: normalizeTimeout(step.timeoutMs),
  };

  if (action === "navigate") {
    if (step.url) normalized.url = cleanString(step.url, "url", 2000);
  } else if (action === "clickText" || action === "waitForText" || action === "expectText") {
    normalized.text = cleanString(step.text, "text");
  } else if (action === "clickRole") {
    normalized.role = cleanString(step.role, "role", 40).toLowerCase();
    if (!ALLOWED_ROLES.has(normalized.role)) {
      throw new Error(`Role "${normalized.role}" is not allowed.`);
    }
    normalized.name = cleanString(step.name, "name");
  } else if (action === "clickSelector") {
    normalized.selector = cleanSelector(step.selector);
    normalized.position = normalizeClickPosition(step.position);
  } else if (action === "panMap") {
    normalized.selector = step.selector ? cleanSelector(step.selector) : DEFAULT_MAP_SELECTOR;
    normalized.direction = normalizePanDirection(step.direction || step.value);
    normalized.distance = normalizePanDistance(step.distance || step.index);
  } else if (action === "selectCheckbox") {
    normalized.index = normalizeCheckboxIndex(step.index);
  } else if (action === "fillLabel") {
    normalized.label = cleanString(step.label, "label");
    normalized.value = cleanString(step.value, "value");
  } else if (action === "fillSearch") {
    normalized.value = cleanString(step.value || "hail", "value");
  } else if (action === "expectVisible") {
    normalized.selector = cleanSelector(step.selector);
  } else if (action === "expectPopupLikeElement") {
    normalized.selector = step.selector ? cleanSelector(step.selector) : DEFAULT_POPUP_SELECTOR;
    if (step.text) normalized.text = cleanString(step.text, "text");
  }

  return normalized;
}

function inferActionPlanFromText(description, defaultTargetUrl = "") {
  const targetUrl = extractFirstHttpUrl(description) || defaultTargetUrl;
  if (!targetUrl) return null;
  const text = String(description || "").toLowerCase();
  const wantsMapPan = describesMapPan(description);
  const wantsInteraction = /\b(click|select|tap|choose|press)\b/.test(text);
  const wantsPopup = /\b(pop\s?up|popup|modal|dialog|details?)\b/.test(text);
  const mentionsMap = /\b(map|marker|weather event|hail)\b/.test(text);

  const steps = [{ action: "navigate", url: targetUrl }];
  if (!wantsInteraction && !wantsPopup && !wantsMapPan) {
    return {
      version: ACTION_PLAN_VERSION,
      targetUrl,
      requiresAuth: /(^|\.)hailtrace\.com$/i.test(new URL(targetUrl).hostname),
      steps,
    };
  }
  if (mentionsMap || wantsInteraction) {
    steps.push({
      action: "clickSelector",
      selector: mentionsMap ? DEFAULT_MAP_SELECTOR : "body",
      position: { xRatio: 0.5, yRatio: 0.5 },
    });
  }
  if (wantsMapPan) {
    steps.push({
      action: "panMap",
      selector: DEFAULT_MAP_SELECTOR,
      direction: "right",
      distance: 220,
    });
  }
  if (wantsPopup) {
    steps.push({ action: "expectPopupLikeElement" });
  }

  return {
    version: ACTION_PLAN_VERSION,
    targetUrl,
    requiresAuth: /app\.hailtrace\.com/i.test(targetUrl),
    steps,
  };
}

export async function normalizeWebsiteActionPlan(value, description = "") {
  return normalizeWebsiteActionPlanWithDefaults(value, description);
}

export async function normalizeWebsiteActionPlanWithDefaults(value, description = "", {
  defaultTargetUrl = "",
  repairGeneratedPlan = false,
} = {}) {
  const explicitUrl = extractFirstHttpUrl(description);
  const safeDefaultUrl = defaultTargetUrl ? await assertSafeWebsiteUrl(defaultTargetUrl) : "";
  const rawPlan = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : inferActionPlanFromText(description, safeDefaultUrl);
  if (!rawPlan) return null;

  const authorityUrl = explicitUrl || safeDefaultUrl || rawPlan.targetUrl;
  const targetUrl = await assertSafeWebsiteUrl(rawPlan.targetUrl || authorityUrl);
  const origin = new URL(await assertSafeWebsiteUrl(authorityUrl)).origin;
  ensureSameOrigin(targetUrl, origin);
  const canRepairMissingSelector = repairGeneratedPlan;
  const canRepairWeatherEventDownload = repairGeneratedPlan
    && describesWeatherEventDownload(description)
    && (isHailTraceTarget(targetUrl) || (!explicitUrl && Boolean(safeDefaultUrl)));
  const canRepairWeatherEventMapInspection = repairGeneratedPlan
    && describesWeatherEventMapInspection(description)
    && (isHailTraceTarget(targetUrl) || (!explicitUrl && Boolean(safeDefaultUrl)));
  const canRepairMapPan = repairGeneratedPlan
    && describesMapPan(description)
    && (isHailTraceTarget(targetUrl) || (!explicitUrl && Boolean(safeDefaultUrl)));
  const rawSteps = Array.isArray(rawPlan.steps) ? rawPlan.steps : [];
  if (!rawSteps.length) return null;
  if (rawSteps.length > MAX_ACTION_STEPS) {
    throw new Error(`Action plan can include at most ${MAX_ACTION_STEPS} steps.`);
  }

  const steps = [];
  for (let index = 0; index < rawSteps.length; index += 1) {
    if (canRepairWeatherEventDownload && isGeneratedDownloadTextStep(rawSteps[index])) {
      continue;
    }
    if (canRepairMapPan && isGeneratedPolygonTextStep(rawSteps[index])) {
      continue;
    }

    let step;
    try {
      step = normalizeActionStep(rawSteps[index], index);
    } catch (error) {
      if (canRepairMissingSelector && isMissingSelectorError(error, rawSteps[index])) {
        continue;
      }
      throw error;
    }
    if (step.action === "navigate") {
      const safeStepUrl = await assertSafeWebsiteUrl(step.url || targetUrl);
      ensureSameOrigin(safeStepUrl, origin);
      step.url = safeStepUrl;
    }
    steps.push(step);
  }

  if (!steps.some((step) => step.action === "navigate")) {
    steps.unshift({ action: "navigate", url: targetUrl, timeoutMs: STEP_TIMEOUT_MS });
  }
  if (
    describesSearch(description)
    && (isHailTraceTarget(targetUrl) || (!explicitUrl && Boolean(safeDefaultUrl)))
    && !steps.some((step) => step.action === "fillSearch")
  ) {
    const insertAt = Math.max(1, steps.findIndex((step) => step.action !== "navigate"));
    steps.splice(insertAt, 0, {
      action: "fillSearch",
      value: inferSearchValue(description),
      timeoutMs: STEP_TIMEOUT_MS,
    });
  }
  if (
    (canRepairWeatherEventDownload || canRepairWeatherEventMapInspection)
    && !steps.some((step) => step.action === "selectCheckbox")
  ) {
    insertStepAfterLatest(steps, {
      action: "selectCheckbox",
      index: 0,
      timeoutMs: STEP_TIMEOUT_MS,
    }, ["navigate", "fillSearch"]);
  }
  if (
    (canRepairMapPan || canRepairWeatherEventMapInspection)
    && !steps.some((step) => step.action === "panMap")
  ) {
    insertStepAfterLatest(steps, {
      action: "panMap",
      selector: DEFAULT_MAP_SELECTOR,
      direction: "right",
      distance: 220,
      timeoutMs: STEP_TIMEOUT_MS,
    }, ["selectCheckbox", "clickSelector", "fillSearch", "navigate"]);
  }

  return {
    version: ACTION_PLAN_VERSION,
    targetUrl,
    requiresAuth: Boolean(rawPlan.requiresAuth) || /(^|\.)hailtrace\.com$/i.test(new URL(targetUrl).hostname),
    steps,
  };
}
