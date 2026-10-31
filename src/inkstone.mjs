// 书生端砚（Intern InkStone）本机登录、额度与 API key。
//
// 登录态在客户端里：`%APPDATA%\inkstone-desktop\credentials\credential_*.bin`
// 是 Electron safeStorage 的 `v10` 密文；密钥在同一个 profile 的
// `Local State` → `os_crypt.encrypted_key`（DPAPI 保护，当前用户可解）。
// 解开后是 `{ version, credential: { token, expiresAtMs, user } }`。
//
// 这个 token 就是网页 `uaa-token`：`Authorization: Bearer <token>` 能读
// `/api/tokenplan/v1/credits/balance`；创建 key 的 `POST /keys` 还要同时带
// `Cookie: uaa-token=<token>`（本机实测：只带 Bearer 会回 -10002）。
//
// 全程只读客户端、只打 token-plan 的 GET + 一次 POST /keys；不碰聊天。

import { execFileSync } from "node:child_process"
import { createDecipheriv, randomUUID } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir, hostname } from "node:os"
import { join } from "node:path"
import { readBrowserTokens } from "./leveldb.mjs"

export const API_BASE = "https://discovery.intern-ai.org.cn"
export const APP_DIR = "inkstone-desktop"

const REQUEST_TIMEOUT_MS = 20_000

/** 手机号打码：`13800138000` → `138****8000`；短号返回空串。 */
export function maskPhone(raw) {
  let digits = String(raw ?? "").replace(/\D/g, "")
  if (digits.startsWith("0086") && digits.length >= 15) digits = digits.slice(4)
  else if (digits.startsWith("86") && digits.length === 13) digits = digits.slice(2)
  if (digits.length < 11) return ""
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

/** 用当前 Windows 用户的 DPAPI 解 `Local State` 里的 `os_crypt.encrypted_key`。 */
export function decryptDpapiKey(encryptedKey, { exec = execFileSync } = {}) {
  if (process.platform !== "win32") throw new Error("书生端砚本机登录只支持 Windows")
  const b64 = Buffer.from(encryptedKey).toString("base64")
  const script =
    `Add-Type -AssemblyName System.Security;` +
    `[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect(` +
    `[Convert]::FromBase64String('${b64}'),$null,'CurrentUser'))`
  const out = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  })
  return Buffer.from(String(out).trim(), "base64")
}

function newestCredentialFile(dir) {
  const credDir = join(dir, "credentials")
  if (!existsSync(credDir)) throw new Error(`找不到书生端砚客户端凭据目录：${credDir}`)
  const files = readdirSync(credDir)
    .filter((name) => name.endsWith(".bin"))
    .map((name) => join(credDir, name))
    .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  if (files.length === 0) throw new Error(`书生端砚客户端里没有登录凭据：${credDir}`)
  return files[0].path
}

/** 解开 Electron safeStorage 的 `v10` AES-256-GCM 密文。 */
export function decryptSafeStorage(blob, key) {
  if (blob.length < 3 + 12 + 16 || blob.subarray(0, 3).toString() !== "v10") {
    throw new Error("书生端砚客户端凭据不是 v10 格式")
  }
  const nonce = blob.subarray(3, 15)
  const tag = blob.subarray(blob.length - 16)
  const ciphertext = blob.subarray(15, blob.length - 16)
  const decipher = createDecipheriv("aes-256-gcm", key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * 读本机书生端砚客户端的登录态。
 * @returns {{ token: string, expiresAtMs?: number, user?: object, credentialFile: string }}
 */
export function readDesktopCredential(options = {}) {
  const appData = options.appData ?? process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
  const dir = join(appData, APP_DIR)
  const credentialFile = newestCredentialFile(dir)
  const localState = JSON.parse(readFileSync(join(dir, "Local State"), "utf8"))
  const encryptedKey = localState?.os_crypt?.encrypted_key
  if (!encryptedKey) throw new Error("书生端砚客户端 Local State 里没有 os_crypt.encrypted_key")
  const rawKey = Buffer.from(encryptedKey, "base64")
  if (rawKey.subarray(0, 5).toString() !== "DPAPI") {
    throw new Error("书生端砚客户端凭据不是 Windows DPAPI 格式")
  }
  const key = (options.decryptDpapi ?? decryptDpapiKey)(rawKey.subarray(5), options)
  const plaintext = decryptSafeStorage(readFileSync(credentialFile), key)
  const parsed = JSON.parse(plaintext.toString("utf8"))
  const token = parsed?.credential?.token
  if (typeof token !== "string" || !token) {
    throw new Error("书生端砚客户端凭据里没有 token")
  }
  return {
    token,
    expiresAtMs: parsed.credential.expiresAtMs,
    user: parsed.credential.user,
    credentialFile,
  }
}

/**
 * 本机所有可用的书生端砚登录态：先找 Chromium 浏览器的 Local Storage，再退回
 * 端砚客户端的 safeStorage 凭据。返回数组，调用方逐个用 /users/validate 验。
 */
export function readLocalLogins(options = {}) {
  const out = []
  try {
    const browserTokens = (options.readBrowserTokens ?? readBrowserTokens)(options.env ?? process.env)
    for (const hit of browserTokens) out.push({ ...hit, source: "browser" })
  } catch {
    // 没有浏览器 / 旧格式：继续试客户端。
  }
  try {
    const desktop = (options.readDesktopCredential ?? readDesktopCredential)(options)
    if (desktop?.token && !out.some((x) => x.token === desktop.token)) {
      out.push({ ...desktop, source: "desktop-client" })
    }
  } catch {
    // 客户端没装/没登录：最后给出统一的错误。
  }
  return out
}

function errorMessage(json, text) {
  return json?.msg || json?.message || String(text ?? "").slice(0, 200)
}

/**
 * 调 token-plan API。`Authorization` 每个接口都认；`/keys` 的 POST 还要
 * 同时带 `Cookie: uaa-token`（本机实测只带 Bearer 会回 -10002）。
 */
export async function requestJson(path, options = {}) {
  const {
    token,
    method = "GET",
    body,
    headers = {},
    fetcher = globalThis.fetch,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = options
  if (!token) throw new Error("没有书生端砚登录态")
  const response = await fetcher(`${API_BASE}${path}`, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      cookie: `uaa-token=${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  if (!response.ok || !json || json.code !== 0) {
    const message = `书生端砚 API ${path} 失败：HTTP ${response.status} ${errorMessage(json, text)}`
    const error = new Error(message.trim())
    if (/token expired|A0211|请求未认证|not authenticated/i.test(message)) error.signIn = "expired"
    throw error
  }
  return json.data
}

export function fetchValidate(token, fetcher = globalThis.fetch) {
  return requestJson("/api/tokenplan/v1/users/validate", { token, fetcher })
}

export function fetchBalance(token, fetcher = globalThis.fetch) {
  return requestJson("/api/tokenplan/v1/credits/balance", { token, fetcher })
}

export function fetchPackages(token, fetcher = globalThis.fetch) {
  return requestJson("/api/tokenplan/v1/credits/packages?page=1&page_size=20", { token, fetcher })
}

export function createApiKey(token, name, options = {}) {
  return requestJson("/api/tokenplan/v1/keys", {
    token,
    method: "POST",
    body: { name },
    headers: { "Idempotency-Key": options.idempotencyKey ?? randomUUID() },
    fetcher: options.fetcher ?? globalThis.fetch,
  })
}

export function deleteApiKey(token, id, fetcher = globalThis.fetch) {
  return requestJson(`/api/tokenplan/v1/keys/${encodeURIComponent(id)}`, {
    token,
    method: "DELETE",
    fetcher,
  })
}

/** 给 magpie 的 key 起名：`magpie-<hostname>`；同名重复登录会由平台自己拒绝或保留。 */
export function apiKeyName() {
  return `magpie-${hostname().replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 40)}`
}

function numberOrZero(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatNumber(value) {
  return numberOrZero(value).toLocaleString("en-US", { maximumFractionDigits: 3 })
}

/** 厂商给的是北京时间 `2026-10-31 07:15:08`；转成 ISO（带 +08:00）。 */
export function beijingToIso(value) {
  const s = String(value ?? "").trim()
  if (!s) return undefined
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) {
    const direct = Date.parse(s)
    return Number.isNaN(direct) ? undefined : new Date(direct).toISOString()
  }
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+08:00`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * `credits/balance` → magpie `usage()`。
 *
 * 例（本机实测 2026-10-31）：
 *   available_credits: 8434.696
 *   5h: limit 10000, used 1565.304, next_recover_at 2026-10-31 07:15:08
 *   7d: limit 50000, used 1565.304, next_recover_at 2026-11-07 02:15:08
 */
export function usageFromBalance(balance, options = {}) {
  const windows = []
  const labels = { "5h": "5 小时", "7d": "7 天" }
  const spans = { "5h": 18_000, "7d": 604_800 }
  for (const key of ["5h", "7d"]) {
    const w = balance?.usage_windows?.[key]
    if (!w || w.enabled === false) continue
    const limit = numberOrZero(w.limit_credits)
    const amount = numberOrZero(w.used_credits)
    windows.push({
      name: labels[key],
      used: limit > 0 ? Math.round((amount / limit) * 10_000) / 100 : 0,
      amount,
      limit,
      unit: "墨点",
      display: `${formatNumber(amount)} / ${formatNumber(limit)} 墨点`,
      resetsAt: beijingToIso(w.next_recover_at),
      span: spans[key],
      aside: false,
    })
  }
  const out = {
    plan: options.plan ?? "Token Plan",
    balance: `${formatNumber(balance?.available_credits)} 墨点`,
    windows,
  }
  if (options.user) out.user = options.user
  if (balance?.calculated_at) out.readAt = beijingToIso(balance.calculated_at) ?? String(balance.calculated_at)
  return out
}

export function planNameFromPackages(packages) {
  const first = packages?.packages?.[0]
  return first?.remark || first?.remark_en || "Token Plan"
}
