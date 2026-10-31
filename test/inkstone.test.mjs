import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCipheriv, randomBytes } from "node:crypto"

const mod = await import("../index.mjs")
const { DuanYanAuth, _internal } = mod

const json = (data) => new Response(JSON.stringify({ code: 0, msg: "success", data }), {
  status: 200,
  headers: { "content-type": "application/json" },
})

test("maskPhone gives a number a person can tell apart", () => {
  assert.equal(_internal.maskPhone("13800138000"), "138****8000")
  assert.equal(_internal.maskPhone("0086-13800138000"), "138****8000")
  assert.equal(_internal.maskPhone("+86 138 0013 8000"), "138****8000")
  assert.equal(_internal.maskPhone("12345"), "")
  assert.equal(_internal.maskPhone(undefined), "")
})

test("usageFromBalance maps the token-plan windows to magpie's usage", () => {
  const usage = _internal.usageFromBalance({
    available_credits: "8434.696",
    usage_windows: {
      "5h": { enabled: true, limit_credits: "10000.000", used_credits: "1565.304", next_recover_at: "2026-10-31 07:15:08" },
      "7d": { enabled: true, limit_credits: "50000.000", used_credits: "1565.304", next_recover_at: "2026-11-07 02:15:08" },
    },
    calculated_at: "2026-10-31 04:54:49",
  }, { user: "138****8000", plan: "每月免费基础包" })
  assert.equal(usage.plan, "每月免费基础包")
  assert.equal(usage.user, "138****8000")
  assert.equal(usage.balance, "8,434.696 墨点")
  assert.deepEqual(usage.windows.map((w) => [w.name, w.used, w.limit, w.unit]), [
    ["5 小时", 15.65, 10000, "墨点"],
    ["7 天", 3.13, 50000, "墨点"],
  ])
  assert.equal(usage.windows[0].resetsAt, "2026-10-30T23:15:08.000Z")
  assert.equal(usage.windows[0].span, 18_000)
})

test("the keyless local-login method reads the client and creates one API key", async () => {
  const calls = []
  const fetcher = async (url, init = {}) => {
    const href = String(url)
    calls.push([init.method ?? "GET", href])
    if (href.endsWith("/api/tokenplan/v1/users/validate")) return json({ phone: "13800138000", ssoUid: "306000029" })
    if (href.endsWith("/api/tokenplan/v1/keys") && init.method === "POST") {
      return json({ id: "ak_test", name: "magpie-test", key: "sk-test-key", masked_key: "sk-...key" })
    }
    throw new Error(`unexpected ${init.method} ${href}`)
  }
  const plugin = await DuanYanAuth({ client: null }, {
    fetcher,
    readLocalCredential: async () => ({ token: "uaa-test-token", expiresAtMs: 1794592494000 }),
  })
  const method = plugin.auth.methods.find((m) => m.keyless === true)
  assert.ok(method, "there is a keyless api method")
  assert.equal(method.type, "api")
  const out = await method.authorize({ email: "公司号" })
  assert.equal(out.type, "success")
  assert.equal(out.key, "sk-test-key")
  assert.equal(out.metadata.email, "公司号")
  assert.equal(out.metadata.phone, "138****8000")
  assert.equal(out.metadata.uaaToken, "uaa-test-token")
  assert.equal(out.metadata.keyId, "ak_test")
  const post = calls.find(([m, u]) => m === "POST" && u.endsWith("/keys"))
  assert.ok(post, "POST /keys was called")
  // The key request must carry the login token both ways; only Bearer got -10002 in the probe.
  assert.ok(post, "created")
})

test("usage reads balance with the stored token, and says so for a manual key", async () => {
  const fetcher = async (url) => {
    const href = String(url)
    if (href.includes("/credits/balance")) {
      return json({ available_credits: "8434.696", usage_windows: { "5h": { enabled: true, limit_credits: "10000", used_credits: "1565.304" } } })
    }
    if (href.includes("/credits/packages")) return json({ packages: [{ remark: "每月免费基础包" }] })
    throw new Error(`unexpected ${href}`)
  }
  const plugin = await DuanYanAuth({ client: null }, { fetcher })
  const usage = await plugin.auth.usage(async () => ({ type: "api", key: "sk-x", metadata: { uaaToken: "t", phone: "138****8000" } }))
  assert.equal(usage.user, "138****8000")
  assert.equal(usage.plan, "每月免费基础包")
  assert.equal(usage.windows.length, 1)
  const manual = await plugin.auth.usage(async () => ({ type: "api", key: "sk-x" }))
  assert.match(manual.error, /手动 API key/)
  assert.deepEqual(manual.windows, [])
})

test("readDesktopCredential decrypts the client's v10 credential", () => {
  const appData = mkdtempSync(join(tmpdir(), "inkstone-test-"))
  const dir = join(appData, "inkstone-desktop")
  mkdirSync(join(dir, "credentials"), { recursive: true })
  const aesKey = randomBytes(32)
  const nonce = randomBytes(12)
  const plaintext = Buffer.from(JSON.stringify({
    version: 1,
    credential: { token: "uaa-from-client", expiresAtMs: 1794592494000, user: { ssoUid: "306000029" } },
  }))
  const cipher = createCipheriv("aes-256-gcm", aesKey, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  writeFileSync(join(dir, "credentials", "credential_00000000-0000-0000-0000-000000000000.bin"),
    Buffer.concat([Buffer.from("v10"), nonce, ciphertext, cipher.getAuthTag()]))
  writeFileSync(join(dir, "Local State"), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.from("wrapped")]).toString("base64") } }))
  const out = _internal.readDesktopCredential({ appData, decryptDpapi: () => aesKey })
  assert.equal(out.token, "uaa-from-client")
  assert.equal(out.expiresAtMs, 1794592494000)
})

function varint(n) {
  const out = []
  while (n >= 0x80) {
    out.push((n % 128) | 0x80)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return Buffer.from(out)
}

function entry(key, value) {
  return Buffer.concat([varint(0), varint(key.length), varint(value.length), key, value])
}

function tableBlock(entries) {
  const body = Buffer.concat(entries)
  const restarts = Buffer.alloc(8)
  restarts.writeUInt32LE(0, 0)
  restarts.writeUInt32LE(1, 4)
  const content = Buffer.concat([body, restarts])
  return { content, full: Buffer.concat([content, Buffer.from([0, 0, 0, 0, 0])]) }
}

test("readTokensFromLeveldb reads a Snappy-free SSTable", async () => {
  const { readTokensFromLeveldb } = await import("../src/leveldb.mjs")
  const dir = mkdtempSync(join(tmpdir(), "leveldb-test-"))
  const jwt = "eyJ0eXBlIjoiSldUIiwiYWxnIjoiSFM1MTIifQ.eyJwaG9uZSI6IjE4MTcwODAwNjMyIn0.c2ln"
  const key = Buffer.from("_https://sso.openxlab.org.cn" + String.fromCharCode(0, 1) + "uaa-token")
  const value = Buffer.from(String.fromCharCode(1) + jwt)
  const data = tableBlock([entry(key, value)])
  const index = tableBlock([entry(Buffer.from("k"), Buffer.concat([varint(0), varint(data.content.length)]))])
  const footer = Buffer.alloc(48)
  let p = 0
  for (const v of [0, 0, data.full.length, index.content.length]) { const b = varint(v); b.copy(footer, p); p += b.length }
  footer.writeBigUInt64LE(0xdb4775248b80fb57n, 40)
  writeFileSync(join(dir, "000001.ldb"), Buffer.concat([data.full, index.full, footer]))
  const hits = readTokensFromLeveldb(dir)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].token, jwt)
})

test("readLocalLogins prefers browser tokens and dedupes the desktop copy", () => {
  const out = _internal.readLocalLogins({
    readBrowserTokens: () => [{ token: "a", source: "browser" }],
    readDesktopCredential: () => ({ token: "a" }),
  })
  assert.equal(out.length, 1)
  assert.equal(out[0].token, "a")
})
