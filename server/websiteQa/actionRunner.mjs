import { MAP_INTERACTION_TIMEOUT_MS, MAP_RENDER_SETTLE_MS } from "./constants.mjs";
import { redactUrlForLog } from "./urlSafety.mjs";
import { throwIfAborted } from "../cancellation.mjs";

// Selecting a checkbox is harder than it looks: apps frequently render the real
// <input type=checkbox> as a zero-size, opacity:0 control wrapped in a styled
// <label> (e.g. styled-components), so a direct click misses it. This step hides
// that reality behind a simple "select the Nth checkbox and confirm it stuck"
// contract, and verifies the resulting :checked state rather than assuming the
// click worked.
async function selectCheckboxStep(page, step, signal) {
  throwIfAborted(signal);
  const input = page.locator("input[type='checkbox']").nth(step.index);
  if ((await input.count()) === 0) {
    throw new Error(`No checkbox found at index ${step.index}.`);
  }

  if (!(await input.isChecked())) {
    const wrappingLabel = input.locator("xpath=ancestor::label[1]");
    if ((await wrappingLabel.count()) > 0) {
      await wrappingLabel.first().click({ timeout: step.timeoutMs });
    } else {
      await input.check({ force: true, timeout: step.timeoutMs });
    }
  }

  await waitForChecked(input, step.timeoutMs, signal);
  return { detail: `Selected checkbox #${step.index + 1} and confirmed it is checked.` };
}

async function waitForChecked(input, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    throwIfAborted(signal);
    if (await input.isChecked()) return;
    if (Date.now() >= deadline) {
      throw new Error("Checkbox did not become checked after selection.");
    }
    await input.page().waitForTimeout(150);
  }
}

async function fillSearchStep(page, step, signal) {
  const candidates = [
    page.getByRole("searchbox"),
    page.getByRole("textbox", { name: /search/i }),
    page.getByPlaceholder(/search/i),
    page.locator("input[type='search'], input[name*='search' i], input[aria-label*='search' i], input[placeholder*='search' i]"),
  ];

  for (const candidate of candidates) {
    throwIfAborted(signal);
    const locator = candidate.first();
    try {
      await locator.waitFor({ state: "visible", timeout: step.timeoutMs });
      await locator.fill(step.value, { timeout: step.timeoutMs });
      await locator.press("Enter", { timeout: step.timeoutMs }).catch(() => {});
      return { detail: "Filled and submitted the search field." };
    } catch {
      throwIfAborted(signal);
      // Try the next locator strategy.
    }
  }

  throw new Error("Could not locate a visible search field. Add a searchable input with role=searchbox, an accessible search name, or a search placeholder.");
}

function panDelta(direction, distance) {
  if (direction === "up") return { x: 0, y: -distance };
  if (direction === "down") return { x: 0, y: distance };
  if (direction === "left") return { x: -distance, y: 0 };
  return { x: distance, y: 0 };
}

function hasMeaningfulScreenshotChange(before, after) {
  if (!before?.length || !after?.length) return false;
  const length = Math.min(before.length, after.length);
  let changed = Math.abs(before.length - after.length);
  for (let index = 0; index < length; index += 1) {
    if (before[index] !== after[index]) changed += 1;
  }
  return changed > Math.max(100, Math.floor(length * 0.001));
}

async function panMapStep(page, step, signal) {
  throwIfAborted(signal);
  const timeoutMs = Math.max(step.timeoutMs, MAP_INTERACTION_TIMEOUT_MS);
  const locator = page.locator(step.selector).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Map selector "${step.selector}" is not visible for panning.`);

  // HailTrace polygons can arrive after the storm-card checkbox changes state.
  // This map-specific settle gives the layer/API update room before we compare.
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(MAP_RENDER_SETTLE_MS);
  throwIfAborted(signal);

  const before = await locator.screenshot({ timeout: timeoutMs }).catch(() => null);
  const centerX = box.x + (box.width / 2);
  const centerY = box.y + (box.height / 2);
  const delta = panDelta(step.direction, step.distance);
  const targetX = Math.min(Math.max(box.x + 8, centerX + delta.x), box.x + box.width - 8);
  const targetY = Math.min(Math.max(box.y + 8, centerY + delta.y), box.y + box.height - 8);

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 12 });
  await page.mouse.up();
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(MAP_RENDER_SETTLE_MS);
  throwIfAborted(signal);

  const after = await locator.screenshot({ timeout: timeoutMs }).catch(() => null);
  if (!hasMeaningfulScreenshotChange(before, after)) {
    throw new Error("Map pan did not produce a visible map change.");
  }

  return { detail: `Panned map ${step.direction} by ${step.distance}px and verified the map changed.` };
}

async function executeActionStep(page, step, signal) {
  throwIfAborted(signal);
  if (step.action === "navigate") {
    const response = await page.goto(step.url, {
      waitUntil: "domcontentloaded",
      timeout: step.timeoutMs,
    });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    return {
      status: response?.status() || 0,
      detail: `Navigated to ${redactUrlForLog(step.url)} with status ${response?.status() || "unknown"}.`,
    };
  }

  if (step.action === "clickText") {
    await page.getByText(step.text, { exact: false }).first().click({ timeout: step.timeoutMs });
    return { detail: `Clicked text matching "${step.text}".` };
  }

  if (step.action === "clickRole") {
    await page.getByRole(step.role, { name: step.name }).click({ timeout: step.timeoutMs });
    return { detail: `Clicked ${step.role} named "${step.name}".` };
  }

  if (step.action === "clickSelector") {
    const locator = page.locator(step.selector).first();
    await locator.waitFor({ state: "visible", timeout: step.timeoutMs });
    if (step.position) {
      const box = await locator.boundingBox();
      if (!box) throw new Error(`Selector "${step.selector}" is not visible for coordinate click.`);
      await page.mouse.click(
        box.x + (box.width * step.position.xRatio),
        box.y + (box.height * step.position.yRatio),
      );
    } else {
      await locator.click({ timeout: step.timeoutMs });
    }
    return { detail: `Clicked selector "${step.selector}".` };
  }

  if (step.action === "panMap") {
    return panMapStep(page, step, signal);
  }

  if (step.action === "selectCheckbox") {
    return selectCheckboxStep(page, step, signal);
  }

  if (step.action === "fillLabel") {
    await page.getByLabel(step.label).fill(step.value, { timeout: step.timeoutMs });
    return { detail: `Filled field labeled "${step.label}".` };
  }

  if (step.action === "fillSearch") {
    return fillSearchStep(page, step, signal);
  }

  if (step.action === "waitForText" || step.action === "expectText") {
    await page.getByText(step.text, { exact: false }).first().waitFor({ state: "visible", timeout: step.timeoutMs });
    return { detail: `Verified visible text matching "${step.text}".` };
  }

  if (step.action === "expectVisible") {
    await page.locator(step.selector).first().waitFor({ state: "visible", timeout: step.timeoutMs });
    return { detail: `Verified visible selector "${step.selector}".` };
  }

  if (step.action === "expectPopupLikeElement") {
    const locator = step.text
      ? page.locator(step.selector).filter({ hasText: step.text }).first()
      : page.locator(step.selector).first();
    await locator.waitFor({ state: "visible", timeout: step.timeoutMs });
    return { detail: step.text ? `Verified popup-like element containing "${step.text}".` : "Verified a popup-like element appeared." };
  }

  throw new Error(`Unsupported action "${step.action}".`);
}

export async function executeActionPlan(page, actionPlan, { signal } = {}) {
  const actionResults = [];
  let pageStatus = 0;
  for (let index = 0; index < actionPlan.steps.length; index += 1) {
    throwIfAborted(signal);
    const step = actionPlan.steps[index];
    try {
      const result = await executeActionStep(page, step, signal);
      if (step.action === "navigate") pageStatus = result.status;
      actionResults.push({
        ok: true,
        action: step.action,
        detail: result.detail,
      });
    } catch (error) {
      throwIfAborted(signal);
      actionResults.push({
        ok: false,
        action: step.action,
        detail: `Step ${index + 1} (${step.action}) failed: ${error.message}`,
      });
      break;
    }
  }
  return { actionResults, pageStatus };
}
