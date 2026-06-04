// Shared outbound HTTP helper.
//
// Centralizes hard-timeout behavior so every integration aborts hung
// connections consistently instead of holding a request handler open
// indefinitely. Kept dependency-free and side-effect-free.

export async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const { signal, ...requestOptions } = options;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });

  try {
    return await fetch(url, { ...requestOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
