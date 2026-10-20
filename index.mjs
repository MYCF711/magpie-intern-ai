/**
 * 书生端砚 (InternAI Discovery) —— Magpie / OpenCode provider 插件
 *
 * https://discovery.intern-ai.org.cn
 *
 * 提供两个供应商，各自用同一个书生端砚 API key 登录：
 *   - duanyan        走 OpenAI 兼容协议  https://discovery-api.intern-ai.org.cn/v1
 *   - duanyan-claude 走 Anthropic / SystemOne 协议 https://discovery-api.intern-ai.org.cn
 *
 * 模型列表：登录后从 /v1/models 动态拉取（账号相关），拉取失败时回退到内置静态列表。
 */

const OPENAI_BASE = "https://discovery-api.intern-ai.org.cn/v1"
const ANTHROPIC_BASE = "https://discovery-api.intern-ai.org.cn"
// 动态模型清单端点：标准 OpenAI 风格，返回 { data: [{ id, … }] }
const MODELS_URL = `${OPENAI_BASE}/models`

const SIGN_IN_LABEL = "书生端砚 API key"

// ---------------------------------------------------------------------------
// 静态兜底模型（仅在 /v1/models 拉取失败时使用）
// 书生端砚的实际可用模型随账号/平台变化，以动态拉取结果为准；
// 如发现兜底条目不准确，欢迎提 issue / PR 修正。
// ---------------------------------------------------------------------------
const FALLBACK_OPENAI_MODELS = {
  "internlm4-flash": {
    name: "InternLM4 Flash",
    limit: { context: 32768, output: 8192 },
    tool_call: true,
  },
}

const FALLBACK_CLAUDE_MODELS = {
  "claude-sonnet-4-5": {
    name: "Claude Sonnet 4.5",
    limit: { context: 200000, output: 64000 },
    tool_call: true,
  },
}

// ---------------------------------------------------------------------------
// 内部工具（不从入口导出；插件入口的每个导出函数都会被宿主当作插件调用）
// ---------------------------------------------------------------------------

async function listRemoteModelIds(key) {
  let res
  try {
    res = await fetch(MODELS_URL, { headers: { authorization: `Bearer ${key}` } })
  } catch {
    return { ok: false }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, unauthorized: true }
  if (!res.ok) return { ok: false }
  let body = null
  try {
    body = await res.json()
  } catch {
    return { ok: false }
  }
  const ids = (Array.isArray(body?.data) ? body.data : [])
    .map((m) => (typeof m?.id === "string" ? m.id : null))
    .filter((id) => Boolean(id))
  if (ids.length === 0) return { ok: false }
  return { ok: true, ids }
}

function prettify(id) {
  return id
    .replace(/^claude-/i, "Claude ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function signInExpiredError() {
  const err = new Error("书生端砚 API key 已失效，请重新登录")
  err.signIn = "expired"
  return err
}

/**
 * 合并动态模型清单与兜底：API 成功时以动态为准（账号没有的兜底模型不再列出）。
 */
function mergeModels(providerModels, ids) {
  const merged = {}
  for (const id of ids) {
    const base = providerModels?.[id] ?? {}
    merged[id] = { ...base, id, name: base.name ?? prettify(id) }
  }
  return merged
}

function makeModelsHook({ fallback, filter }) {
  return async (provider, { auth }) => {
    const key = typeof auth?.key === "string" ? auth.key : ""
    if (!key) return provider.models
    const result = await listRemoteModelIds(key)
    if (result.unauthorized) throw signInExpiredError()
    if (!result.ok) return provider.models
    const ids = filter ? result.ids.filter(filter) : result.ids
    if (ids.length === 0) return provider.models
    return mergeModels(provider.models ?? fallback, ids)
  }
}

/**
 * 每个账号共用的 loader：把请求发往指定 base，并附上该账号的 API key。
 * 多账号由宿主管理（auth 作用域隔离），这里不持有任何模块级状态。
 */
function makeLoader(base, { anthropicStyle = false } = {}) {
  return (getAuth) =>
    getAuth().then((auth) => {
      if (auth?.type !== "api" || typeof auth.key !== "string" || !auth.key) return {}
      const key = auth.key
      return {
        baseURL: base,
        apiKey: key,
        async fetch(input, init) {
          const headers = new Headers(init?.headers)
          headers.set("authorization", `Bearer ${key}`)
          if (anthropicStyle) headers.set("x-api-key", key)
          return fetch(input, { ...init, headers })
        },
      }
    })
}

// ---------------------------------------------------------------------------
// 供应商 1：书生端砚（OpenAI 兼容协议）
// ---------------------------------------------------------------------------

export const DuanYanOpenAI = async () => ({
  config: async (cfg) => {
    cfg.provider ??= {}
    cfg.provider["duanyan"] ??= {
      name: "书生端砚",
      npm: "@ai-sdk/openai-compatible",
      api: OPENAI_BASE,
      models: FALLBACK_OPENAI_MODELS,
    }
  },
  auth: {
    provider: "duanyan",
    methods: [
      {
        type: "api",
        label: SIGN_IN_LABEL,
        placeholder: "在 discovery.intern-ai.org.cn 的控制台生成 API key",
      },
    ],
    loader: makeLoader(OPENAI_BASE),
  },
  provider: {
    id: "duanyan",
    models: makeModelsHook({ fallback: FALLBACK_OPENAI_MODELS }),
  },
})

// ---------------------------------------------------------------------------
// 供应商 2：书生端砚 Claude（Anthropic / SystemOne 协议）
// ---------------------------------------------------------------------------

export const DuanYanClaude = async () => ({
  config: async (cfg) => {
    cfg.provider ??= {}
    cfg.provider["duanyan-claude"] ??= {
      name: "书生端砚 (Claude)",
      npm: "@ai-sdk/anthropic",
      api: ANTHROPIC_BASE,
      models: FALLBACK_CLAUDE_MODELS,
    }
  },
  auth: {
    provider: "duanyan-claude",
    methods: [
      {
        type: "api",
        label: SIGN_IN_LABEL,
        placeholder: "在 discovery.intern-ai.org.cn 的控制台生成 API key",
      },
    ],
    loader: makeLoader(ANTHROPIC_BASE, { anthropicStyle: true }),
  },
  provider: {
    id: "duanyan-claude",
    // Anthropic 协议端点只服务 Claude 系模型，动态清单按 id 过滤
    models: makeModelsHook({
      fallback: FALLBACK_CLAUDE_MODELS,
      filter: (id) => /claude/i.test(id),
    }),
  },
})
