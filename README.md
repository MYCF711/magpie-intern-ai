# magpie-intern-ai

书生端砚（[InternAI Discovery](https://discovery.intern-ai.org.cn)）的 [Magpie](https://usemagpie.ai) / [OpenCode](https://opencode.ai) 供应商插件。用你自己的书生端砚 API key，把它的模型接入 Magpie / OpenCode。

- **双协议两个供应商**：同一个 key，OpenAI 兼容与 Anthropic / SystemOne 协议各注册一个供应商
- **多账号**：每个账号独立登录、独立配置，互不干扰
- **模型列表动态获取**：登录后从 `/v1/models` 拉取账号实际可用的模型，不写死任何静态列表
- **零运行时依赖**

## 供应商

| id | 协议 | Base URL | AI SDK |
| --- | --- | --- | --- |
| `duanyan` | OpenAI 兼容（chat completions） | `https://discovery-api.intern-ai.org.cn/v1` | `@ai-sdk/openai-compatible` |
| `duanyan-claude` | Anthropic Messages / SystemOne | `https://discovery-api.intern-ai.org.cn` | `@ai-sdk/anthropic` |

> 注：如果供应商 id 在你的 Magpie 版本里与内置订阅冲突，宿主会自动改名为 `duanyan-plugin` 等形式，属于正常行为。

## 获取 API key

1. 打开 [discovery.intern-ai.org.cn](https://discovery.intern-ai.org.cn)，注册 / 登录你的账号。
2. 在控制台（API 管理）里生成 API key。
3. 复制 key（形如一串随机字符），后面登录时粘贴。

## 安装

### Magpie

```bash
# 从 GitHub 直接安装
magpie plugin add github:ca-x/magpie-intern-ai

# 或从 npm
magpie plugin add magpie-intern-ai
```

安装后登录（两个供应商各登录一次，key 相同）：

```bash
magpie plugin login duanyan         # OpenAI 兼容协议
magpie plugin login duanyan-claude  # Anthropic / SystemOne 协议（用 Claude 模型时）
```

验证：

```bash
magpie plugin --json        # 无加载错误
magpie provider test duanyan
magpie provider test duanyan-claude
```

### OpenCode

```bash
opencode plugin add ca-x/magpie-intern-ai
```

OpenCode 会忽略 Magpie 专属行为，登录方式与供应商配置照常可用。

### 应用内安装

Magpie → 设置 → 插件 → 发现/安装，粘贴本仓库地址或 npm 包名 `magpie-intern-ai`，然后在供应商页面添加账号。

## 多账号

在供应商设置里多次添加账号即可（或多次执行 `magpie plugin login <id>`）。每个账号存自己的 API key，账号间状态完全隔离；同一个人的不同 key、或团队成员的 key 都可以并存，按账号切换 / 排队使用。

## 模型列表说明

- 登录后插件调用 `GET https://discovery-api.intern-ai.org.cn/v1/models`（带该账号的 key）获取实际可用模型，**没有静态兜底列表**，模型完全以动态获取为准。
- `duanyan` 列出全部模型；`duanyan-claude` 只列出 id 含 `claude` 的模型（Anthropic 协议端点只服务 Claude 系）。
- 拉取失败（网络/平台问题）时保留宿主已有的模型配置；key 失效（401/403）时提示重新登录。

## 开发与测试

```bash
# 沙箱测试，绝不在日常使用的 magpie 上测
sb=$(mktemp -d)
m() { env HOME="$sb" XDG_CONFIG_HOME="$sb/.config" XDG_CACHE_HOME="$sb/.cache" magpie "$@"; }

m plugin add ./magpie-intern-ai    # 文件夹就地加载
m plugin --json                    # 检查加载错误
m plugin login duanyan             # 粘贴 API key
m provider test duanyan            # 每种 API 发一个小请求
m plugin login duanyan-claude
m provider test duanyan-claude
```

## 隐私

插件只把你的对话请求转发到书生端砚官方 API（`discovery-api.intern-ai.org.cn`），不记录、不上报任何内容。

## License

MIT
