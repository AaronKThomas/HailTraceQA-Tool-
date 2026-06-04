// Process-wide concurrency gate for Playwright runs.
//
// A headless browser is heavy, so unbounded parallelism (e.g. a burst of
// authenticated /run-test requests) can exhaust memory and starve the event
// loop. This gate caps how many runs execute at once and bounds the waiting
// line so excess load fails fast with a clear "busy" signal instead of hanging.
//
// Invariant: `active` always equals the number of tasks currently holding a
// slot (between a successful acquire and its release). When a task finishes it
// hands its slot directly to the next waiter, keeping the count stable.

import { MAX_CONCURRENT_PLAYWRIGHT, MAX_QUEUED_PLAYWRIGHT } from "./constants.mjs";
import { TestRunCancelledError, throwIfAborted } from "../cancellation.mjs";

// A domain signal that the runner is at capacity. It deliberately carries no
// transport (HTTP) knowledge; callers map it to the appropriate response by
// identity (`instanceof`), keeping the website-QA layer free of routing detail.
export class WebsiteQaBusyError extends Error {
  constructor() {
    super("The website QA runner is at capacity. Please retry in a few seconds.");
    this.name = "WebsiteQaBusyError";
  }
}

let active = 0;
const waiters = [];

function acquireSlot(signal) {
  throwIfAborted(signal);
  if (active < MAX_CONCURRENT_PLAYWRIGHT) {
    active += 1;
    return Promise.resolve();
  }
  if (waiters.length >= MAX_QUEUED_PLAYWRIGHT) {
    return Promise.reject(new WebsiteQaBusyError());
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const waiter = () => {
      cleanup();
      if (signal?.aborted) {
        reject(new TestRunCancelledError());
        return;
      }
      resolve();
    };
    const onAbort = () => {
      const index = waiters.indexOf(waiter);
      if (index !== -1) waiters.splice(index, 1);
      cleanup();
      reject(new TestRunCancelledError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    waiters.push(waiter);
  });
}

function releaseSlot() {
  const next = waiters.shift();
  if (next) {
    next(); // Hand the slot to the next waiter; `active` is unchanged.
  } else {
    active -= 1;
  }
}

export async function withPlaywrightSlot(task, { signal } = {}) {
  await acquireSlot(signal);
  try {
    throwIfAborted(signal);
    return await task();
  } finally {
    releaseSlot();
  }
}
