import fs from "fs/promises";
import path from "path";
import os from "os";
import type { AuthTokens, SavedCredentials } from "./types.js";
import { BASE_URL, FIREBASE_REFRESH_URL, DEFAULT_HEADERS, delay, safeParseInt, writeSecure, isFileNotFound, DIR_MODE } from "./utils.js";

const CONFIG_DIR = path.join(os.homedir(), ".function-health");
const CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");
const TOKEN_REFRESH_BUFFER = 300; // seconds before expiry to refresh

async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: DIR_MODE });
}

export async function loadCredentials(): Promise<SavedCredentials | null> {
  try {
    const data = await fs.readFile(CREDENTIALS_PATH, "utf-8");
    return JSON.parse(data) as SavedCredentials;
  } catch (err: unknown) {
    if (!isFileNotFound(err)) {
      console.error("Warning: could not read credentials:", (err as Error).message);
    }
    // Also check legacy location
    try {
      const legacyPath = path.join(os.homedir(), ".function-health-cli", "credentials.json");
      const data = await fs.readFile(legacyPath, "utf-8");
      return JSON.parse(data) as SavedCredentials;
    } catch {
      return null;
    }
  }
}

export async function saveCredentials(creds: SavedCredentials): Promise<void> {
  await ensureConfigDir();
  await writeSecure(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
}

export async function clearCredentials(): Promise<void> {
  try {
    await fs.unlink(CREDENTIALS_PATH);
  } catch {
    // File may not exist
  }
}

export async function login(email: string, password: string): Promise<AuthTokens> {
  const res = await retryFetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "Unknown error");
    throw new Error(`Login failed: ${res.status} ${res.statusText}. ${body}`);
  }

  const data = await res.json() as AuthTokens;

  if (!data.idToken || !data.refreshToken) {
    throw new Error("Invalid login response — missing tokens");
  }

  const expiresIn = safeParseInt(data.expiresIn, 3600);

  const tokens: AuthTokens = {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresIn,
    localId: data.localId,
    email: data.email,
    loginTime: Date.now(),
  };

  await saveCredentials(tokens);

  return tokens;
}

export async function refreshToken(tokens: AuthTokens): Promise<AuthTokens> {
  const res = await retryFetch(FIREBASE_REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "Unknown error");
    console.error(`[auth] Token refresh failed: ${res.status} ${res.statusText}. ${body}`);
    throw new Error(`Token refresh failed: ${res.status} ${res.statusText}. ${body}`);
  }

  const data = await res.json() as { access_token: string; expires_in: string; refresh_token: string };

  const refreshed: AuthTokens = {
    ...tokens,
    idToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresIn: safeParseInt(data.expires_in, 3600),
    loginTime: Date.now(),
  };

  await saveCredentials(refreshed);

  return refreshed;
}

export function isTokenExpired(tokens: AuthTokens): boolean {
  const tokenAge = (Date.now() - tokens.loginTime) / 1000;
  return tokenAge > tokens.expiresIn - TOKEN_REFRESH_BUFFER;
}

/** Check if env-var login should be attempted. Returns credentials or null. */
export function shouldAttemptEnvLogin(storedEmail: string): { email: string; password: string } | null {
  const email = process.env.FH_EMAIL;
  const password = process.env.FH_PASSWORD;
  if (!email || !password) return null;
  // Guard: only fall back if env email matches the stored account (or stored email is empty/legacy)
  if (storedEmail && storedEmail.toLowerCase() !== email.toLowerCase()) return null;
  return { email, password };
}

/** Refresh tokens, falling back to env-var login if refresh fails */
export async function refreshTokenWithFallback(tokens: AuthTokens): Promise<AuthTokens> {
  try {
    return await refreshToken(tokens);
  } catch (refreshErr) {
    const envCreds = shouldAttemptEnvLogin(tokens.email);
    if (envCreds) {
      console.error("[auth] Refresh failed, attempting login with FH_EMAIL/FH_PASSWORD...");
      return await login(envCreds.email, envCreds.password);
    }
    throw refreshErr;
  }
}

export async function getValidTokens(): Promise<AuthTokens> {
  const creds = await loadCredentials();
  if (!creds?.idToken || !creds?.refreshToken) {
    throw new Error("Not authenticated. Use the fh_login tool or run: function-health login");
  }

  const tokens: AuthTokens = {
    idToken: creds.idToken,
    refreshToken: creds.refreshToken,
    expiresIn: creds.expiresIn ?? 3600,
    localId: creds.localId ?? "",
    email: creds.email ?? "",
    loginTime: creds.loginTime ?? 0,
  };

  if (isTokenExpired(tokens)) {
    return await refreshTokenWithFallback(tokens);
  }

  return tokens;
}

async function retryFetch(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    try {
      if (i > 0) {
        await delay(1000 * Math.pow(2, i));
      }
      const res = await fetch(url, init);
      // Retry on server errors (5xx) — drain body to free the connection
      if (res.status >= 500 && i < attempts - 1) { await res.body?.cancel(); continue; }
      return res;
    } catch (err) {
      if (i === attempts - 1) throw err;
    }
  }
  throw new Error("All retry attempts failed");
}
