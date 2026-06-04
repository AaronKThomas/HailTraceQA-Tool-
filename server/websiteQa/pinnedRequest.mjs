import http from "node:http";
import https from "node:https";

import { LINK_TIMEOUT_MS } from "./constants.mjs";
import { TestRunCancelledError, throwIfAborted } from "../cancellation.mjs";

// Performs a single HTTP(S) request that connects ONLY to the IP we already
// validated as public, while keeping the original hostname for the Host header
// and TLS SNI/certificate validation. Forcing the connect address closes the
// DNS-rebinding window between our safety check and the actual connection,
// which plain `fetch` cannot do without re-resolving the hostname.
//
// Redirects are never followed automatically: the caller decides whether a
// redirect target is safe (re-validated and same-origin) before following it.
export function requestPinned({ url, ip, method, timeoutMs = LINK_TIMEOUT_MS, signal }) {
  throwIfAborted(signal);
  const parsed = new URL(url);
  const client = parsed.protocol === "https:" ? https : http;
  const family = ip.includes(":") ? 6 : 4;

  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method,
        // Pin DNS resolution to the pre-validated address.
        lookup: (_hostname, _options, callback) => callback(null, ip, family),
        signal,
      },
      (response) => {
        clearTimeout(timer);
        // Drain the body so the socket is released; only status/headers matter.
        response.resume();
        const status = response.statusCode || 0;
        // A duplicated Location header is exposed as an array; take the first.
        const rawLocation = response.headers.location;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          location: (Array.isArray(rawLocation) ? rawLocation[0] : rawLocation) || null,
        });
      },
    );

    const timer = setTimeout(() => {
      request.destroy(new Error("Link request timed out."));
    }, timeoutMs);
    const onAbort = () => request.destroy(new TestRunCancelledError());
    signal?.addEventListener("abort", onAbort, { once: true });
    request.on("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    request.on("close", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
    request.end();
  });
}
