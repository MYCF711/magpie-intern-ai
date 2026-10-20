// 插件自测：模拟宿主加载入口、调用插件钩子并检查行为。npm test 运行。
import { test } from "node:test"
import assert from "node:assert/strict"

const mod = await import("../index.mjs")
const entries = Object.entries(mod).filter(([, v]) => typeof v === "function")

const OPENAI_BASE = "https://discovery-api.intern-ai.org.cn/v1"
const ANTHROPIC_BASE = "https://discovery-api.intern-ai.org.cn"

test("入口只导出一个插件工厂", () => {
  assert.equal(entries.length, 1)
})

const [name, fn] = entries[0]

test(`${name}: 钩子行为`, async () => {
  const hooks = await fn({ client: null }, undefined)
  const providerId = hooks?.auth?.provider
  assert.equal(providerId, "duanyan", "只注册一个供应商 duanyan")

  // config：补齐默认字段，但不覆盖用户在 plugins.json 里的配置
  const cfg = { provider: { duanyan: { name: "用户自定义" } } }
  await hooks.config(cfg)
  assert.equal(cfg.provider.duanyan.name, "用户自定义")
  assert.equal(cfg.provider.duanyan.npm, "@ai-sdk/openai-compatible", "应补齐 npm 默认值")
  const cfg2 = { provider: {} }
  await hooks.config(cfg2)
  assert.equal(cfg2.provider.duanyan.api, OPENAI_BASE)
  assert.ok(hooks.auth.icon?.startsWith("data:image/"), "auth 应带图标")

  // 登录方式：API key
  assert.equal(hooks.auth.methods[0]?.type, "api")

  const savedFetch = globalThis.fetch
  try {
    // loader：placeholder 不泄真 key，真 key 只进请求头，且只发往平台域名
    const cfgLoader = await hooks.auth.loader(async () => ({ type: "api", key: "test-key" }))
    assert.equal(cfgLoader.baseURL, OPENAI_BASE)
    assert.notEqual(cfgLoader.apiKey, "test-key", "loader 的 apiKey 必须是占位符，不能放真 key")

    let seenHeaders = null
    globalThis.fetch = async (input, init) => {
      seenHeaders = new Headers(init?.headers)
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }
    await cfgLoader.fetch("https://discovery-api.intern-ai.org.cn/x", { headers: { "x-keep": "1" } })
    assert.equal(seenHeaders.get("authorization"), "Bearer test-key", "authorization 头应带账号 key")
    assert.equal(seenHeaders.get("x-api-key"), "test-key", "claude 模型分流到 Anthropic 端点需要 x-api-key")

    await assert.rejects(() => cfgLoader.fetch("https://evil.example.com/x", {}), /拒绝/, "非平台域名必须拒绝")
    await assert.rejects(() => cfgLoader.fetch("not-a-url", {}), /拒绝/)

    // 未登录时 loader 返回空对象
    const empty = await hooks.auth.loader(async () => null)
    assert.deepEqual(empty, {})

    // provider.models：动态全量拉取；claude 系模型分流 Anthropic 协议，其余 OpenAI 兼容
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-test" }, { id: "claude-sonnet-4-5" }] }), { status: 200 })
    const models = await hooks.provider.models({ models: {} }, { auth: { type: "api", key: "test-key" } })
    assert.ok("gpt-test" in models && "claude-sonnet-4-5" in models, "动态模型应全部合并进同一列表")
    assert.equal(models["claude-sonnet-4-5"].api?.npm, "@ai-sdk/anthropic", "claude 模型应分流到 Anthropic 协议")
    assert.equal(models["claude-sonnet-4-5"].api?.url, ANTHROPIC_BASE)
    assert.equal(models["gpt-test"].api?.npm, "@ai-sdk/openai-compatible", "非 claude 模型走 OpenAI 兼容协议")
    assert.equal(models["gpt-test"].api?.url, OPENAI_BASE)

    // 401 → 标记账号重新登录
    globalThis.fetch = async () => new Response("{}", { status: 401 })
    await assert.rejects(
      () => hooks.provider.models({ models: {} }, { auth: { type: "api", key: "bad" } }),
      (e) => e?.signIn === "expired",
      "401 应抛出 signIn: expired",
    )
  } finally {
    globalThis.fetch = savedFetch
  }
})
