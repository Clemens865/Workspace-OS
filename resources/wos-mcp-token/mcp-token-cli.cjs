#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main/mcp-token-cli.ts
var mcp_token_cli_exports = {};
__export(mcp_token_cli_exports, {
  resolveAuthHeaders: () => resolveAuthHeaders
});
module.exports = __toCommonJS(mcp_token_cli_exports);

// src/main/secrets/vault.ts
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var SECRETS_FILE = "secrets.json";
var KEY_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
function isValidSecretName(name) {
  return typeof name === "string" && KEY_NAME_RE.test(name);
}
var MAX_SECRET_CHARS = 8192;
var Vault = class {
  constructor(storeDir, secrets) {
    this.storeDir = storeDir;
    this.secrets = secrets;
  }
  secretsPath() {
    return import_path.default.join(this.storeDir, SECRETS_FILE);
  }
  readMap() {
    try {
      const raw = import_fs.default.readFileSync(this.secretsPath(), "utf-8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const out = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (isValidSecretName(k) && typeof v === "string") out[k] = v;
      }
      return out;
    } catch {
      return {};
    }
  }
  writeMap(map) {
    import_fs.default.mkdirSync(this.storeDir, { recursive: true });
    import_fs.default.writeFileSync(this.secretsPath(), JSON.stringify(map, null, 2), { encoding: "utf-8", mode: 384 });
    try {
      import_fs.default.chmodSync(this.secretsPath(), 384);
    } catch {
    }
  }
  /** Whether secrets can be stored securely right now (and the backend name). */
  status() {
    return { available: this.secrets.isAvailable(), backend: this.secrets.backend() };
  }
  /** Key NAMES + metadata only — NEVER values. Sorted for stable UI. */
  list() {
    return Object.keys(this.readMap()).sort().map((name) => ({ name }));
  }
  /** True if a secret with this name is stored (no value exposed). */
  has(name) {
    return isValidSecretName(name) && name in this.readMap();
  }
  /**
   * Encrypts and stores a secret under `name`. REFUSES (throws) if secure
   * storage is unavailable — never silently persists plaintext.
   */
  set(name, value) {
    if (!isValidSecretName(name)) throw new Error("Invalid secret name");
    if (typeof value !== "string" || value.length === 0) throw new Error("Secret value must be a non-empty string");
    if (value.length > MAX_SECRET_CHARS) throw new Error("Secret value too long");
    if (!this.secrets.isAvailable()) {
      throw new Error(
        `Secure credential storage is unavailable (backend: ${this.secrets.backend()}). Refusing to store the secret as plaintext.`
      );
    }
    const cipher = this.secrets.encrypt(value);
    const map = this.readMap();
    map[name] = cipher.toString("base64");
    this.writeMap(map);
  }
  /** Removes a stored secret. No-op if absent. */
  remove(name) {
    if (!isValidSecretName(name)) return;
    const map = this.readMap();
    if (name in map) {
      delete map[name];
      this.writeMap(map);
    }
  }
  /**
   * Decrypts and returns the plaintext for `name`, or null if absent.
   *
   * THE ONLY PATH plaintext exists in-process. Callers (only the spawn wiring)
   * must never log it and must let it go out of scope immediately after handing
   * it to the child env.
   */
  get(name) {
    if (!isValidSecretName(name)) return null;
    const b64 = this.readMap()[name];
    if (!b64) return null;
    if (!this.secrets.isAvailable()) {
      throw new Error("Secure credential storage is unavailable \u2014 cannot decrypt.");
    }
    return this.secrets.decrypt(Buffer.from(b64, "base64"));
  }
};

// src/main/userdata-path.ts
var import_os = __toESM(require("os"), 1);
var import_path2 = __toESM(require("path"), 1);
var APP_NAME = "workspace-os";
function userDataDir() {
  const override = process.env["WOS_USERDATA_DIR"];
  if (override) return override;
  if (process.platform === "darwin") {
    return import_path2.default.join(import_os.default.homedir(), "Library", "Application Support", APP_NAME);
  }
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"] || import_path2.default.join(import_os.default.homedir(), "AppData", "Roaming");
    return import_path2.default.join(appData, APP_NAME);
  }
  const xdg = process.env["XDG_CONFIG_HOME"] || import_path2.default.join(import_os.default.homedir(), ".config");
  return import_path2.default.join(xdg, APP_NAME);
}

// src/main/mcp/oauth/remote-vault.ts
var NEAR_EXPIRY_MS = 5 * 6e4;
function needsRefresh(rec, now = Date.now()) {
  if (!rec.accessToken || typeof rec.accessTokenExpiresAt !== "number") return true;
  return rec.accessTokenExpiresAt - now <= NEAR_EXPIRY_MS;
}
function remoteVaultKey(connectorId) {
  const key = `MCP_OAUTH_${connectorId}`;
  return isValidSecretName(key) ? key : "";
}
function serializeRecord(rec) {
  return JSON.stringify(rec);
}
function parseRecord(raw) {
  if (!raw) return null;
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  const r = doc;
  if (typeof r.refreshToken !== "string" || r.refreshToken.length === 0) return null;
  if (typeof r.tokenEndpoint !== "string" || r.tokenEndpoint.length === 0) return null;
  if (typeof r.clientId !== "string" || r.clientId.length === 0) return null;
  const rec = {
    refreshToken: r.refreshToken,
    tokenEndpoint: r.tokenEndpoint,
    clientId: r.clientId
  };
  if (typeof r.resource === "string" && r.resource.length > 0) rec.resource = r.resource;
  if (typeof r.accessToken === "string" && r.accessToken.length > 0) rec.accessToken = r.accessToken;
  if (typeof r.accessTokenExpiresAt === "number") rec.accessTokenExpiresAt = r.accessTokenExpiresAt;
  return rec;
}

// src/main/mcp/oauth/remote-oauth.ts
function ok(value) {
  return { ok: true, value };
}
function fail(error) {
  return { ok: false, error };
}
async function postToken(fetchFn, tokenEndpoint, body) {
  let res;
  try {
    res = await fetchFn(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body).toString()
    });
  } catch {
    return fail("Could not reach the authorization server.");
  }
  let data;
  try {
    data = await res.json() ?? {};
  } catch {
    return fail("The authorization server returned an unreadable response.");
  }
  if (!res.ok || data.error || !data.access_token) {
    return fail(data.error ? `authorization failed (${data.error})` : "authorization failed");
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  const set = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresIn * 1e3
  };
  if (data.refresh_token) set.refreshToken = data.refresh_token;
  return ok(set);
}
function refreshAccessToken(params, fetchFn) {
  const body = {
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId
  };
  if (params.resource) body.resource = params.resource;
  return postToken(fetchFn, params.tokenEndpoint, body);
}

// src/main/mcp-token-cli.ts
async function resolveAuthHeaders(rec, fetchFn, now = Date.now()) {
  if (!needsRefresh(rec, now) && rec.accessToken) {
    return { ok: true, headers: { Authorization: `Bearer ${rec.accessToken}` } };
  }
  const res = await refreshAccessToken(
    {
      tokenEndpoint: rec.tokenEndpoint,
      refreshToken: rec.refreshToken,
      clientId: rec.clientId,
      resource: rec.resource
    },
    fetchFn
  );
  if (!res.ok) return { ok: false, error: res.error };
  const updated = {
    ...rec,
    accessToken: res.value.accessToken,
    accessTokenExpiresAt: res.value.expiresAt
  };
  if (res.value.refreshToken && res.value.refreshToken !== rec.refreshToken) {
    updated.refreshToken = res.value.refreshToken;
  }
  return { ok: true, headers: { Authorization: `Bearer ${res.value.accessToken}` }, updated };
}
function bail(reason) {
  process.stdout.write("{}");
  process.stderr.write(`wos-mcp-token: ${reason}
`);
  process.exit(1);
}
function makeSecretStore() {
  let safeStorage;
  try {
    const electron = require("electron");
    safeStorage = electron && typeof electron === "object" ? electron.safeStorage : void 0;
  } catch {
    safeStorage = void 0;
  }
  if (!safeStorage || typeof safeStorage.decryptString !== "function") return null;
  return {
    isAvailable: () => {
      try {
        return !!safeStorage.isEncryptionAvailable?.();
      } catch {
        return false;
      }
    },
    encrypt: (plaintext) => safeStorage.encryptString(plaintext),
    decrypt: (ciphertext) => safeStorage.decryptString(ciphertext),
    backend: () => "safeStorage"
  };
}
var nodeFetch = (url, init) => fetch(url, { method: init.method, headers: init.headers, body: init.body });
async function main() {
  const connectorId = process.argv[2];
  if (!connectorId || !/^[A-Za-z0-9_-]{1,64}$/.test(connectorId)) bail("missing/invalid connector id");
  const key = remoteVaultKey(connectorId);
  if (!key) bail("invalid connector id");
  const store = makeSecretStore();
  if (!store) bail("secure storage unavailable");
  if (!store.isAvailable()) bail("keychain unavailable");
  const vault = new Vault(userDataDir(), store);
  let raw;
  try {
    raw = vault.get(key);
  } catch {
    bail("could not read vault");
  }
  const rec = parseRecord(raw);
  if (!rec) bail("connector not connected");
  const res = await resolveAuthHeaders(rec, nodeFetch);
  if (!res.ok) bail(`refresh failed: ${res.error}`);
  if (res.updated) {
    try {
      vault.set(key, serializeRecord(res.updated));
    } catch {
    }
  }
  process.stdout.write(JSON.stringify(res.headers));
  process.exit(0);
}
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main().catch((e) => {
    bail(`unexpected error${e instanceof Error && e.name ? ` (${e.name})` : ""}`);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  resolveAuthHeaders
});
