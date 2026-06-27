import { app, safeStorage, shell } from "electron";
import { createServer, type Server } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { MCPOAuthClientProvider, auth, type OAuthStorage } from "@mastra/mcp";
import type { PluginServerConfig } from "../shared/plugins/types";
import { encryptValue, decryptValue } from "./mcpStore";

/**
 * OAuth for remote (http) MCP servers. We drive the MCP OAuth 2.1 flow with
 * `@mastra/mcp`'s MCPOAuthClientProvider: on Connect we open the system browser,
 * catch the redirect on a fixed loopback port, and exchange the code for tokens.
 * Tokens / client registration / PKCE verifier are persisted encrypted (same
 * safeStorage scheme as relay-plugins.json) and never leave the main process.
 */

// Fixed loopback callback the provider registers as its redirect URI. Must be
// stable so dynamic client registration and the running listener agree.
const LOOPBACK_PORT = 33418;
export const REDIRECT_URL = `http://127.0.0.1:${LOOPBACK_PORT}/callback`;
const AUTH_TIMEOUT_MS = 180_000;

// --- Encrypted token store (relay-oauth.json), namespaced per server id ---

interface OAuthFile {
  data: Record<string, string>;
  encrypted: boolean;
}

let cache: OAuthFile | null = null;

const filePath = (): string => join(app.getPath("userData"), "relay-oauth.json");

const load = (): OAuthFile => {
  if (cache) {
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath(), "utf8")) as Partial<OAuthFile>;
    cache = {
      data: parsed.data && typeof parsed.data === "object" ? parsed.data : {},
      encrypted: parsed.encrypted ?? false
    };
  } catch {
    cache = { data: {}, encrypted: false };
  }
  return cache;
};

const persist = (state: OAuthFile): void => {
  cache = state;
  const path = filePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
};

const nsKey = (serverId: string, key: string): string => `${serverId}:${key}`;

/** A per-server OAuthStorage that encrypts values at rest. */
const storageFor = (serverId: string): OAuthStorage => ({
  get(key: string): string | undefined {
    const file = load();
    const cipher = file.data[nsKey(serverId, key)];
    if (cipher === undefined) {
      return undefined;
    }
    return decryptValue(cipher, file.encrypted) ?? undefined;
  },
  set(key: string, value: string): void {
    const file = load();
    // Lock the encryption mode in on the first write (matches mcpStore).
    const encrypted =
      Object.keys(file.data).length === 0 ? safeStorage.isEncryptionAvailable() : file.encrypted;
    const data = { ...file.data, [nsKey(serverId, key)]: encryptValue(value) };
    persist({ data, encrypted });
  },
  delete(key: string): void {
    const file = load();
    const data = { ...file.data };
    delete data[nsKey(serverId, key)];
    persist({ data, encrypted: file.encrypted });
  }
});

/** True when valid (stored) OAuth tokens exist for a server. Synchronous for summaries. */
export const hasTokens = (serverId: string): boolean => Boolean(load().data[nsKey(serverId, "tokens")]);

/** Forget all OAuth data for a server (on disconnect/remove). */
export const clearTokens = (serverId: string): void => {
  const file = load();
  const data = { ...file.data };
  for (const key of ["tokens", "client_info", "code_verifier"]) {
    delete data[nsKey(serverId, key)];
  }
  persist({ data, encrypted: file.encrypted });
};

/** Build an OAuth provider for a server; reads/saves tokens from the encrypted store. */
export const buildOAuthProvider = (serverId: string): MCPOAuthClientProvider =>
  new MCPOAuthClientProvider({
    redirectUrl: REDIRECT_URL,
    clientMetadata: {
      client_name: "Relay",
      redirect_uris: [REDIRECT_URL],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    },
    storage: storageFor(serverId),
    onRedirectToAuthorization: (url) => {
      void shell.openExternal(url.toString());
    }
  });

// --- Loopback callback + interactive authorize ---

const callbackPage = (ok: boolean): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Relay</title>
<style>body{font-family:system-ui;background:#15140f;color:#f0e9da;display:grid;place-items:center;height:100vh;margin:0}
.card{text-align:center}h1{font-size:18px}p{color:#a29b90}</style></head>
<body><div class="card"><h1>${ok ? "Connected to Relay ✓" : "Authorization failed"}</h1>
<p>${ok ? "You can close this tab and return to Relay." : "Please return to Relay and try again."}</p></div></body></html>`;

const listen = (server: Server, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

/**
 * Run the full browser OAuth flow for one server: open the browser, catch the
 * redirect, exchange the code. Resolves once tokens are stored; throws on
 * denial/timeout. The transient MCPClient connection happens later via the
 * manager (the saved tokens make it succeed).
 */
export const authorize = async (server: PluginServerConfig): Promise<void> => {
  if (!server.url) {
    throw new Error("OAuth server is missing its URL.");
  }
  const httpServer = createServer();
  try {
    await listen(httpServer, LOOPBACK_PORT);
  } catch {
    httpServer.close();
    throw new Error(
      `Could not start the OAuth callback listener on port ${LOOPBACK_PORT}. ` +
        "Close whatever is using that port and try Connect again."
    );
  }

  const codePromise = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Authorization timed out. Click Connect to try again.")),
      AUTH_TIMEOUT_MS
    );
    httpServer.on("request", (req, res) => {
      const requestUrl = new URL(req.url ?? "/", REDIRECT_URL);
      if (!requestUrl.pathname.startsWith("/callback")) {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(callbackPage(Boolean(code) && !error));
      if (error) {
        clearTimeout(timer);
        reject(new Error(`Authorization was denied (${error}).`));
      } else if (code) {
        clearTimeout(timer);
        resolve(code);
      }
    });
  });

  try {
    const provider = buildOAuthProvider(server.id);
    // First call discovers metadata, registers the client, generates PKCE, and
    // opens the browser via onRedirectToAuthorization. Returns "REDIRECT".
    const first = await auth(provider, { serverUrl: server.url });
    if (first === "AUTHORIZED") {
      return; // already had valid tokens
    }
    const code = await codePromise;
    const done = await auth(provider, { serverUrl: server.url, authorizationCode: code });
    if (done !== "AUTHORIZED") {
      throw new Error("OAuth token exchange did not complete.");
    }
  } finally {
    httpServer.close();
  }
};
