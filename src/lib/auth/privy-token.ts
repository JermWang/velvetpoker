"use client";

/**
 * SSR-safe access to the current Privy access token, WITHOUT importing the Privy
 * SDK here (the SDK is isolated behind ssr:false dynamic imports — importing it
 * anywhere else breaks the prerender build). The Privy tree registers a token
 * getter at runtime via setTokenGetter(); everything else reads through it.
 *
 * Why this exists: the server reads the Privy token from the `privy-token` cookie,
 * which can go stale (expired) while the SDK holds a fresh token in memory. Sending
 * a freshly-fetched token in the Authorization header makes API auth reliable.
 */

let tokenGetter: (() => Promise<string | null>) | null = null;

/** Called by the Privy provider tree (client-only) to expose its token getter. */
export function setTokenGetter(fn: (() => Promise<string | null>) | null): void {
  tokenGetter = fn;
}

/** Current Privy access token (fresh), or null if unavailable / not signed in. */
export async function getPrivyAccessToken(): Promise<string | null> {
  if (!tokenGetter) return null;
  try {
    return await tokenGetter();
  } catch {
    return null;
  }
}

/**
 * fetch() that attaches a fresh Privy access token as a Bearer header so the
 * server authenticates reliably even when the privy-token cookie is stale. Falls
 * back to plain cookie auth when no token is available.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getPrivyAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}
