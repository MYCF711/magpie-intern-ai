#!/usr/bin/env node
// 插件自测：模拟宿主加载入口、调用每个插件函数并检查钩子行为。
// 运行：node scripts/selftest.mjs

const mod = await import("../index.mjs")
const entries = Object.entries(mod).filter(([, v]) => typeof v === "function")
if (entries.length === 0) throw new Error("入口没有导出任何插件函数")

const expectations = {
  duanyan: { npm: "@ai-sdk/openai-compatible", base: "https://discovery-api.intern-ai.org.cn/v1" },
  "duanyan-claude": { npm: "@ai-sdk/anthropic", base: "https://discovery-api.intern-ai.org.cn" },
}

for (const [name, fn] of entries) {
  const hooks = await fn({ client: null }, undefined)
  const providerId = hooks?.auth?.provider
  if (!providerId || !expectations[providerId]) throw new Error(`${name}: auth.provider 缺失或未知`)
  const want = expectations[providerId]

  // config 钩子：??= 不覆盖用户配置
  const cfg = { provider: { [providerId]: { name: "用户自定义" } } }
  await hooks.config(cfg)
  if (cfg.provider[providerId].name !== "用户自定义") throw new Error(`${name}: config 覆盖了用户配置`)
  const cfg2 = { provider: {} }
  await hooks.config(cfg2)
  const declared = cfg2.provider[providerId]
  if (declared?.npm !== want.npm || declared?.api !== want.base) {
    throw new Error(`${name}: config 声明的 npm/api 不正确`)
  }

  // auth.methods
  const methods = hooks.auth.methods
  if (!Array.isArray(methods) || methods[0]?.type !== "api") throw new Error(`${name}: methods 应为 api key 方式`)

  // loader：注入 key 后应设置 authorization 头并指向正确 baseURL
  const savedFetch = globalThis.fetch
  let seenAuth = null
  globalThis.fetch = async (input, init) => {
    seenAuth = new Headers(init?.headers).get("authorization")
    return new Response(JSON.stringify({ data: [{ id: "test-model" }] }), { status: 200 })
  }
  try {
    const loaderCfg = await hooks.auth.loader(async () => ({ type: "api", key: "test-key" }))
    if (loaderCfg.baseURL !== want.base) throw new Error(`${name}: baseURL 不正确`)
    await loaderCfg.fetch("https://example.invalid/chat", { headers: { "x-keep": "1" } })
    if (seenAuth !== "Bearer test-key") throw new Error(`${name}: authorization 头未设置`)
    const empty = await hooks.auth.loader(async () => null)
    if (Object.keys(empty).length !== 0) throw new Error(`${name}: 未登录时 loader 应返回空对象`)

    // provider.models：动态拉取合并
    const models = await hooks.provider.models(
      { models: Object.fromEntries(Object.keys(declared.models).map((k) => [k, { ...declared.models[k] }])) },
      { auth: { type: "api", key: "test-key" } },
    )
    if (!("test-model" in models) && providerId === "duanyan") {
      throw new Error(`${name}: 动态模型未合并`)
    }
    if (providerId === "duanyan-claude" && "test-model" in models) {
      throw new Error(`${name}: 非 claude 模型不应进入 Anthropic 供应商`)
    }

    // 401 → 标记重新登录
    globalThis.fetch = async () => new Response("{}", { status: 401 })
    let expired = false
    try {
      await hooks.provider.models({ models: declared.models }, { auth: { type: "api", key: "bad" } })
    } catch (e) {
      expired = e?.signIn === "expired"
    }
    if (!expired) throw new Error(`${name}: 401 未抛出 signIn: expired`)
  } finally {
    globalThis.fetch = savedFetch
  }
  console.log(`ok  ${name} (${providerId})`)
}

console.log(`\nall good: ${entries.length} plugin(s) passed`)
