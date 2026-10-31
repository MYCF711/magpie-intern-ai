# 更新记录

## 0.3.1 — 2026-10-31

- **显示名改为 `magpie.name`**：包名保持 ASCII slug `magpie-intern-ai`，卡片标题写 `书生·端砚 Intern InkStone`（magpie 0.1.2404 的 `magpie.name` 修复）；provider 名同步为官方写法
- **官方名依据**：<https://discovery.intern-ai.org.cn/> 的 `<title>书生·端砚 Intern InkStone</title>`，meta description 也写作「书生·端砚（Intern InkStone）」
- 新增 `registry-entry.json`

## 0.3.0 — 2026-10-31

- **本机登录 + 自动建 key + 额度**：读 Edge/Chrome Local Storage 或端砚客户端的 `uaa-token`，调 token-plan API 读取额度，并自动创建 `magpie-<主机名>` API key
