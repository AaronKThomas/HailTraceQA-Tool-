import { LINK_CHECK_CONCURRENCY, MAX_LINK_CHECKS } from "./constants.mjs";
import { assertSafeWebsiteTarget } from "./urlSafety.mjs";
import { requestPinned } from "./pinnedRequest.mjs";
import { throwIfAborted } from "../cancellation.mjs";

// Some servers reject HEAD (405); fall back to GET to get a real status.
async function headOrGet(url, ip, signal) {
  const response = await requestPinned({ url, ip, method: "HEAD", signal });
  if (response.status === 405) {
    return requestPinned({ url, ip, method: "GET", signal });
  }
  return response;
}

async function checkLink(url, pageOrigin, signal) {
  throwIfAborted(signal);
  const { url: safeUrl, ip } = await assertSafeWebsiteTarget(url);
  let response = await headOrGet(safeUrl, ip, signal);

  if (response.status >= 300 && response.status < 400 && response.location) {
    const redirectedUrl = new URL(response.location, safeUrl);
    // Only follow a redirect that stays on the page's own origin. A same-origin
    // link that bounces off-site must NOT be fetched from the server (avoids
    // turning the link checker into a proxy for arbitrary third-party URLs); a
    // valid 3xx is treated as a working link rather than chased.
    if (redirectedUrl.origin === pageOrigin) {
      const { url: safeRedirect, ip: redirectIp } = await assertSafeWebsiteTarget(redirectedUrl.toString());
      response = await headOrGet(safeRedirect, redirectIp, signal);
    } else {
      return { url: safeUrl, ok: response.status < 400, status: response.status };
    }
  }

  return { url: safeUrl, ok: response.ok, status: response.status };
}

export async function checkSameOriginLinks(pageUrl, links, { signal } = {}) {
  throwIfAborted(signal);
  const origin = new URL(pageUrl).origin;
  const uniqueLinks = [...new Set(links)]
    .filter((href) => {
      try {
        const url = new URL(href, pageUrl);
        return url.origin === origin && ["http:", "https:"].includes(url.protocol);
      } catch {
        return false;
      }
    })
    .slice(0, MAX_LINK_CHECKS);

  const results = new Array(uniqueLinks.length);
  let nextIndex = 0;
  const checkNext = async () => {
    throwIfAborted(signal);
    const index = nextIndex;
    nextIndex += 1;
    if (index >= uniqueLinks.length) return;

    const href = uniqueLinks[index];
    try {
      results[index] = await checkLink(new URL(href, pageUrl).toString(), origin, signal);
    } catch (error) {
      throwIfAborted(signal);
      results[index] = { url: href, ok: false, status: 0, error: error.message };
    }
    await checkNext();
  };

  await Promise.all(
    Array.from({ length: Math.min(LINK_CHECK_CONCURRENCY, uniqueLinks.length) }, checkNext),
  );
  return results;
}
