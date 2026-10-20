// 插件自测：模拟宿主加载入口、调用每个插件函数并检查钩子行为。npm test 运行。
import { test } from "node:test"
import assert from "node:assert/strict"

const mod = await import("../index.mjs")
const entries = Object.entries(mod).filter(([, v]) => typeof v === "function")

const EXPECT = {
  duanyan: { npm: "@ai-sdk/openai-compatible", base: "https://discovery-api.intern-ai.org.cn/v1" },
  "duanyan-claude": { npm: "@ai-sdk/anthropic", base: "https://discovery-api.intern-ai.org.cn" },
}

test("入口导出了两个插件函数", () => {
  assert.equal(entries.length, 2)
})

for (const [name, fn] of entries) {
  test(`${name}: 钩子行为`, async () => {
    const hooks = await fn({ client: null }, undefined)
    const providerId = hooks?.auth?.provider
    assert.ok(providerId && EXPECT[providerId], "auth.provider 缺失或未知")
    const want = EXPECT[providerId]

    // config：补齐默认字段，但不覆盖用户在 plugins.json 里的配置
    const cfg = { provider: { [providerId]: { name: "用户自定义" } } }
    await hooks.config(cfg)
    assert.equal(cfg.provider[providerId].name, "用户自定义")
    assert.equal(cfg.provider[providerId].npm, want.npm, "应补齐 npm 默认值")
    const cfg2 = { provider: {} }
    await hooks.config(cfg2)
    assert.equal(cfg2.provider[providerId].api, want.base)
    assert.ok(hooks.auth.icon?.startsWith("data:image/"), "auth 应带图标")

    // 登录方式：API key
    assert.equal(hooks.auth.methods[0]?.type, "api")

    // loader：placeholder 不泄真 key，真 key 只进请求头，且只发往平台域名
    const savedFetch = globalThis.fetch
    try {
      const cfgLoader = await hooks.auth.loader(async () => ({ type: "api", key: "test-key" }))
      assert.equal(cfgLoader.baseURL, want.base)
      assert.notEqual(cfgLoader.apiKey, "test-key", "loader 的 apiKey 必须是占位符，不能放真 key")

      let seenAuth = null
      globalThis.fetch = async (input, init) => {
        seenAuth = new Headers(init?.headers).get("authorization")
        return new Response(JSON.stringify({ data: [{ id: "test-model" }] }), { status: 200 })
      }
      await cfgLoader.fetch("https://discovery-api.intern-ai.org.cn/x", { headers: { "x-keep": "1" } })
      assert.equal(seenAuth, "Bearer test-key", "authorization 头应带账号 key")

      await assert.rejects(() => cfgLoader.fetch("https://evil.example.com/x", {}), /拒绝/, "非平台域名必须拒绝")
      await assert.rejects(() => cfgLoader.fetch("not-a-url", {}), /拒绝/)

      // 未登录时 loader 返回空对象
      const empty = await hooks.auth.loader(async () => null)
      assert.deepEqual(empty, {})

      // provider.models：动态拉取合并；duanyan-claude 只收 claude 系
      const models = await hooks.provider.models({ models: {} }, { auth: { type: "api", key: "test-key" } })
      if (providerId === "duanyan") assert.ok("test-model" in models, "动态模型应合并进列表")
      else assert.ok(!("test-model" in models), "非 claude 模型不应进入 Anthropic 供应商")

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
}
