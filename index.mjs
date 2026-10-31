/**
 * 书生端砚 (InternAI Discovery) —— Magpie / OpenCode provider 插件
 *
 * https://discovery.intern-ai.org.cn
 *
 * 单供应商 duanyan，一个 API key 登录：主走 OpenAI 兼容协议
 * （https://discovery-api.intern-ai.org.cn/v1）；动态清单里 id 含 claude 的
 * 模型自动分流到 Anthropic / SystemOne 原生协议端点
 * （https://discovery-api.intern-ai.org.cn，同域，模型级 provider 覆盖），
 * 对宿主只显示一个提供商。
 *
 * 模型列表：登录后从 /v1/models 动态拉取（账号相关），不做静态写死。
 *
 * 只有 DuanYanAuth 一个插件工厂被导出：宿主会把入口的
 * 每个导出函数都当作插件调用，辅助函数一律留在模块内部不导出。
 */

import {
  apiKeyName,
  fetchBalance,
  fetchPackages,
  fetchValidate,
  createApiKey,
  maskPhone,
  planNameFromPackages,
  readDesktopCredential,
  readLocalLogins,
  usageFromBalance,
} from "./src/inkstone.mjs"

const OPENAI_BASE = "https://discovery-api.intern-ai.org.cn/v1"
const PROVIDER_NAME = "书生·端砚 Intern InkStone"
const ANTHROPIC_BASE = "https://discovery-api.intern-ai.org.cn"
// 动态模型清单端点：标准 OpenAI 风格，返回 { data: [{ id, … }] }
const MODELS_URL = `${OPENAI_BASE}/models`

const ICON = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNS4xMTQzNSIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTEyLjM1NTQgMTguMjg4OEMxMy4wNjYyIDE4LjI4ODggMTMuNjQyNCAxOC44NjUyIDEzLjY0MjQgMTkuNTc2VjIxLjI3QzEzLjY0MjQgMjEuOTgwOSAxMy4wNjYyIDIyLjU1NzIgMTIuMzU1NCAyMi41NTczQzExLjY0NDUgMjIuNTU3MyAxMS4wNjgxIDIxLjk4MDkgMTEuMDY4MSAyMS4yN1YxOS41NzZDMTEuMDY4MSAxOC44NjUxIDExLjY0NDUgMTguMjg4OCAxMi4zNTU0IDE4LjI4ODhaIiBmaWxsPSIjMTgzODg5Ii8+CjxwYXRoIGQ9Ik0yMC42MjkzIDE4LjI4ODhDMjEuMzQwMiAxOC4yODg4IDIxLjkxNjYgMTguODY1MiAyMS45MTY2IDE5LjU3NlYyMS4yN0MyMS45MTY2IDIxLjk4MDkgMjEuMzQwMiAyMi41NTcyIDIwLjYyOTMgMjIuNTU3M0MxOS45MTg0IDIyLjU1NzMgMTkuMzQyMSAyMS45ODA5IDE5LjM0MjEgMjEuMjdWMTkuNTc2QzE5LjM0MjEgMTguODY1MSAxOS45MTg0IDE4LjI4ODggMjAuNjI5MyAxOC4yODg4WiIgZmlsbD0iIzE4Mzg4OSIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTExLjIwMSA3Ljc1MTgxQzExLjMxIDcuNzA4NzUgMTEuNDIwOSA3LjY2NzA2IDExLjUzMzggNy42MjY4MUMxMS42NTAzIDcuNTg1MjUgMTEuNzY5IDcuNTQ1MjIgMTEuODg5OCA3LjUwNjc2QzEyLjEzMTQgNy40Mjk4MiAxMi4zODE1IDcuMzU5MjUgMTIuNjQwMyA3LjI5NTNDMTIuNzY5NyA3LjI2MzMzIDEyLjkwMTMgNy4yMzMgMTMuMDM1MSA3LjIwNDQyQzEzLjEwMiA3LjE5MDEzIDEzLjE2OTQgNy4xNzY0MyAxMy4yMzc0IDcuMTYzMDFDMTMuNDQxNCA3LjEyMjc1IDEzLjY1MDQgNy4wODYzOSAxMy44NjQ1IDcuMDU0MTVDMTQuMDA3MyA3LjAzMjY2IDE0LjE1MjMgNy4wMTI4NSAxNC4yOTk3IDYuOTk1MDRDMTQuNzQxNyA2Ljk0MTYxIDE1LjIwNDUgNi45MDUxOCAxNS42ODkgNi44ODY3MUMxNS45MzEyIDYuODc3NDcgMTYuMTc4OCA2Ljg3MjY1IDE2LjQzMTkgNi44NzI2NEMxNi42MjQxIDYuODcyNjQgMTYuODEzIDYuODc1NjMgMTYuOTk4OSA2Ljg4MDk4QzE3LjEzOCA2Ljg4NDk4IDE3LjI3NTQgNi44OTAyIDE3LjQxMTEgNi44OTcxMkMxNy42MTggNi45MDc2OCAxNy44MjA4IDYuOTIxODcgMTguMDE5NyA2LjkzOTA1QzE4LjEyNjEgNi45NDgyNCAxOC4yMzE0IDYuOTU3OTYgMTguMzM1NiA2Ljk2OUMxOC40NTEzIDYuOTgxMjcgMTguNTY1NiA2Ljk5NTEyIDE4LjY3ODYgNy4wMDk2MkMxOC43MTIyIDcuMDEzOTQgMTguNzQ1NyA3LjAxNzg3IDE4Ljc3OTEgNy4wMjIzOEMxOC43OTYxIDcuMDI0NjggMTguODEyOSA3LjAyNzMzIDE4LjgyOTkgNy4wMjk2OEMxOC45NTg2IDcuMDQ3NTIgMTkuMDg1NSA3LjA2NjUgMTkuMjEwNiA3LjA4NzIzQzE5LjMxMzQgNy4xMDQyNiAxOS40MTQ5IDcuMTIyNzIgMTkuNTE1MyA3LjE0MTY1QzE5LjYxODYgNy4xNjExMyAxOS43MjA3IDcuMTgxMTQgMTkuODIxNSA3LjIwMjU5QzE5Ljg0MDIgNy4yMDY1OCAxOS44NTg5IDcuMjEwNzggMTkuODc3NSA3LjIxNDgzQzE5Ljk5MTcgNy4yMzk2NiAyMC4xMDQzIDcuMjY1NjUgMjAuMjE1MyA3LjI5Mjk2QzIwLjIzODMgNy4yOTg2MiAyMC4yNjEyIDcuMzA0NjQgMjAuMjg0IDcuMzEwNEMyMC4zMjU2IDcuMzIwOSAyMC4zNjcxIDcuMzMxMzQgMjAuNDA4MiA3LjM0MjE4QzIwLjQzOTYgNy4zNTA0MiAyMC40NzA3IDcuMzU4OTkgMjAuNTAxNyA3LjM2NzQ0QzIwLjUzMDYgNy4zNzUyOSAyMC41NTk1IDcuMzgyODQgMjAuNTg4MiA3LjM5MDg3QzIwLjYzMzYgNy40MDM2IDIwLjY3ODcgNy40MTY3OCAyMC43MjM2IDcuNDI5OTRDMjAuNzM5OSA3LjQzNDcgMjAuNzU2MSA3LjQzOTQ0IDIwLjc3MjMgNy40NDQyNkMyMC44MTg3IDcuNDU4MDggMjAuODY0OCA3LjQ3MjQzIDIwLjkxMDYgNy40ODY3MUMyMC45MjQ3IDcuNDkxMTIgMjAuOTM4OSA3LjQ5NTI4IDIwLjk1MyA3LjQ5OTczQzIxLjAwMTggNy41MTUxMSAyMS4wNTAxIDcuNTMwOTcgMjEuMDk4MSA3LjU0Njg2QzIxLjEwOTMgNy41NTA1NyAyMS4xMjA1IDcuNTU0MDcgMjEuMTMxNyA3LjU1NzhDMjEuMTY5NSA3LjU3MDQ1IDIxLjIwNzEgNy41ODMzOCAyMS4yNDQ0IDcuNTk2MzRDMjEuMjY3OSA3LjYwNDQ4IDIxLjI5MTQgNy42MTIzIDIxLjMxNDggNy42MjA1NkMyMS4zNTYxIDcuNjM1MjEgMjEuMzk3MSA3LjY1MDMyIDIxLjQzNzkgNy42NjUzNUMyMS40NTI0IDcuNjcwNjYgMjEuNDY2OCA3LjY3NTg4IDIxLjQ4MTIgNy42ODEyNEMyMS41MTQ5IDcuNjkzODIgMjEuNTQ4MyA3LjcwNjk0IDIxLjU4MTcgNy43MTk3OEMyMS42MDk0IDcuNzMwNDQgMjEuNjM3IDcuNzQwOTggMjEuNjY0NSA3Ljc1MTgxQzIxLjY4MzggNy43NTk0NSAyMS43MDMxIDcuNzY3MjcgMjEuNzIyMyA3Ljc3NDk5QzIxLjc1ODQgNy43ODk0OSAyMS43OTQ0IDcuODAzOTMgMjEuODMwMSA3LjgxODc0QzIxLjg1MjkgNy44MjgxOCAyMS44NzU1IDcuODM3ODIgMjEuODk4MSA3Ljg0NzM4QzIxLjkzMDIgNy44NjA5NyAyMS45NjIyIDcuODc0NDQgMjEuOTkzOSA3Ljg4ODI3QzIyLjAxODkgNy44OTkxNSAyMi4wNDM2IDcuOTEwMzEgMjIuMDY4NCA3LjkyMTM0QzIyLjA5NSA3LjkzMzE5IDIyLjEyMTUgNy45NDUgMjIuMTQ3OCA3Ljk1NzAyQzIyLjE3NzIgNy45NzA0NCAyMi4yMDY1IDcuOTg0MDEgMjIuMjM1NiA3Ljk5NzY0QzIyLjI2MTIgOC4wMDk2NSAyMi4yODY4IDguMDIxNjggMjIuMzEyMiA4LjAzMzg0QzIyLjMzNjggOC4wNDU2MyAyMi4zNjEyIDguMDU3NTggMjIuMzg1NiA4LjA2OTUyQzIyLjQxMTMgOC4wODIxMSAyMi40MzY5IDguMDk0NzggMjIuNDYyNCA4LjEwNzU0QzIyLjQ4NzYgOC4xMjAxNCAyMi41MTI1IDguMTMzMDYgMjIuNTM3NCA4LjE0NTgyQzIyLjU2NDcgOC4xNTk3OCAyMi41OTE5IDguMTczNTkgMjIuNjE4OSA4LjE4Nzc1QzIyLjY0NzMgOC4yMDI2NSAyMi42NzU1IDguMjE3OTQgMjIuNzAzNiA4LjIzMzA2QzIyLjcyMTggOC4yNDI4OCAyMi43NDAxIDguMjUyNTggMjIuNzU4MiA4LjI2MjQ5QzIyLjc4NjIgOC4yNzc3NSAyMi44MTQgOC4yOTMxMSAyMi44NDE2IDguMzA4NThDMjIuODY3OSA4LjMyMzM0IDIyLjg5NDIgOC4zMzgxNyAyMi45MjAyIDguMzUzMTFDMjIuOTMxNiA4LjM1OTY2IDIyLjk0MyA4LjM2NjMyIDIyLjk1NDMgOC4zNzI5QzIyLjk4ODIgOC4zOTI1MyAyMy4wMjIgOC40MTIwOCAyMy4wNTU0IDguNDMyMDJDMjMuMDc4MiA4LjQ0NTYyIDIzLjEwMDggOC40NTk0MiAyMy4xMjMzIDguNDczMTdDMjMuMTQ5OSA4LjQ4OTMyIDIzLjE3NjMgOC41MDU1MSAyMy4yMDI1IDguNTIxODZDMjMuMjE0OCA4LjUyOTUzIDIzLjIyNyA4LjUzNzMzIDIzLjIzOTIgOC41NDUwNEMyMy4yNzAyIDguNTY0NTQgMjMuMzAwOSA4LjU4NDEyIDIzLjMzMTQgOC42MDM4OUMyMy4zNTE5IDguNjE3MTggMjMuMzcyMyA4LjYzMDU5IDIzLjM5MjYgOC42NDRDMjMuNDIwOCA4LjY2MjYgMjMuNDQ4OSA4LjY4MTE1IDIzLjQ3NjcgOC42OTk5OUMyMy40OTE2IDguNzEwMDQgMjMuNTA2MyA4LjcyMDMzIDIzLjUyMSA4LjczMDQ2QzIzLjU0NzkgOC43NDg4OSAyMy41NzQ3IDguNzY3MjcgMjMuNjAxMiA4Ljc4NTkzQzIzLjYyMjUgOC44MDA5MiAyMy42NDM3IDguODE2MTEgMjMuNjY0OCA4LjgzMTI0QzIzLjY4NzYgOC44NDc2MSAyMy43MTA0IDguODYzOTMgMjMuNzMzIDguODgwNDZDMjMuNzQ5OSA4Ljg5Mjg2IDIzLjc2NjcgOC45MDU0NiAyMy43ODM1IDguOTE3OTZDMjMuODA5MSA4LjkzNjk4IDIzLjgzNDYgOC45NTYwMiAyMy44NTk4IDguOTc1MjVDMjMuODc4NCA4Ljk4OTQxIDIzLjg5NjkgOS4wMDM2OSAyMy45MTUzIDkuMDE3OTZDMjMuOTM3NSA5LjAzNTE4IDIzLjk1OTcgOS4wNTI0IDIzLjk4MTcgOS4wNjk3OEMyMy45OTk4IDkuMDg0MTMgMjQuMDE3OSA5LjA5ODU1IDI0LjAzNTggOS4xMTMwMUMyNC4wNTk1IDkuMTMyMDQgMjQuMDgzMSA5LjE1MTA5IDI0LjEwNjQgOS4xNzAzQzI0LjEyMTcgOS4xODI4OSAyNC4xMzY4IDkuMTk1NjYgMjQuMTUyIDkuMjA4MzJDMjQuMTc3MyA5LjIyOTQxIDI0LjIwMjQgOS4yNTA1NyAyNC4yMjczIDkuMjcxODZDMjQuMjQxNCA5LjI4Mzk2IDI0LjI1NTQgOS4yOTYxNiAyNC4yNjk0IDkuMzA4MzJDMjQuMjkyMiA5LjMyODA3IDI0LjMxNDkgOS4zNDc3OCAyNC4zMzc0IDkuMzY3N0MyNC4zNTYzIDkuMzg0NDggMjQuMzc1MiA5LjQwMTMxIDI0LjM5MzkgOS40MTgyMkMyNC40MTIzIDkuNDM0OCAyNC40MzA1IDkuNDUxNTIgMjQuNDQ4NiA5LjQ2ODIyQzI0LjQ2OTYgOS40ODc1IDI0LjQ5MDQgOS41MDY4NSAyNC41MTExIDkuNTI2MjlDMjQuNTI2NyA5LjU0MDk0IDI0LjU0MjMgOS41NTU1NyAyNC41NTc3IDkuNTcwM0MyNC41Nzc1IDkuNTg5MTUgMjQuNTk3MSA5LjYwODA5IDI0LjYxNjYgOS42MjcwN0MyNC42MzUzIDkuNjQ1MjUgMjQuNjUzOSA5LjY2MzQ1IDI0LjY3MjMgOS42ODE3NkMyNC42ODc0IDkuNjk2NzggMjQuNzAyNCA5LjcxMTk3IDI0LjcxNzQgOS43MjcwN0MyNC43MzY0IDkuNzQ2MjcgMjQuNzU1NiA5Ljc2NTI5IDI0Ljc3NDQgOS43ODQ2MkMyNC43OTI0IDkuODAzMDkgMjQuODEgOS44MjE3NyAyNC44Mjc4IDkuODQwMzVDMjQuODQ1NiA5Ljg1ODk5IDI0Ljg2MzMgOS44Nzc1OSAyNC44ODA5IDkuODk2MzRDMjQuODkzMSA5LjkwOTQgMjQuOTA1MiA5LjkyMjU1IDI0LjkxNzQgOS45MzU2N0MyNC45NDE3IDkuOTYyMDIgMjQuOTY1OCA5Ljk4ODUxIDI0Ljk4OTggMTAuMDE1MUMyNC45OTU4IDEwLjAyMTkgMjUuMDAxOSAxMC4wMjg2IDI1LjAwOCAxMC4wMzU0QzI1LjAzMzQgMTAuMDYzOCAyNS4wNTg2IDEwLjA5MjQgMjUuMDgzNSAxMC4xMjExQzI1LjA5MjcgMTAuMTMxNiAyNS4xMDE3IDEwLjE0MjMgMjUuMTEwOCAxMC4xNTI5QzI1LjEzMzcgMTAuMTc5NCAyNS4xNTY0IDEwLjIwNTggMjUuMTc4OCAxMC4yMzI1QzI1LjE5MDcgMTAuMjQ2NyAyNS4yMDI1IDEwLjI2MSAyNS4yMTQyIDEwLjI3NTJDMjUuMjMxNiAxMC4yOTYzIDI1LjI0ODkgMTAuMzE3NCAyNS4yNjYxIDEwLjMzODVDMjUuMzE0OSAxMC4zOTg4IDI1LjM2MjUgMTAuNDU5NiAyNS40MDkzIDEwLjUyMDhDMjUuNDIwOCAxMC41MzU4IDI1LjQzMjMgMTAuNTUwOCAyNS40NDM3IDEwLjU2NTlDMjUuNDU2NyAxMC41ODMyIDI1LjQ2OTYgMTAuNjAwNiAyNS40ODI1IDEwLjYxOEMyNS40OTc0IDEwLjYzODEgMjUuNTEyMyAxMC42NTgyIDI1LjUyNyAxMC42Nzg0QzI1LjU0MzcgMTAuNzAxNCAyNS41NjAzIDEwLjcyNDUgMjUuNTc2NyAxMC43NDc2QzI1LjU5MDcgMTAuNzY3MiAyNS42MDQ2IDEwLjc4NjggMjUuNjE4NCAxMC44MDY1QzI1LjYyOTMgMTAuODIyMiAyNS42NDAxIDEwLjgzNzkgMjUuNjUxIDEwLjg1MzZDMjUuNjY3OCAxMC44NzgxIDI1LjY4NDYgMTAuOTAyNyAyNS43MDEyIDEwLjkyNzNDMjUuNzEzMyAxMC45NDUzIDI1LjcyNTIgMTAuOTYzNCAyNS43MzcyIDEwLjk4MTVDMjUuNzQ5MyAxMC45OTk4IDI1Ljc2MTYgMTEuMDE4IDI1Ljc3MzYgMTEuMDM2NEMyNS43ODgzIDExLjA1ODkgMjUuODAyNyAxMS4wODE2IDI1LjgxNzEgMTEuMTA0MkMyNS44MyAxMS4xMjQzIDI1Ljg0MjcgMTEuMTQ0NiAyNS44NTU0IDExLjE2NDhDMjUuODY3NiAxMS4xODQ0IDI1Ljg3OTggMTEuMjA0IDI1Ljg5MTggMTEuMjIzN0MyNS45MDM3IDExLjI0MjkgMjUuOTE1NiAxMS4yNjIyIDI1LjkyNzMgMTEuMjgxNUMyNS45Mzc2IDExLjI5ODYgMjUuOTQ3OCAxMS4zMTU3IDI1Ljk1OCAxMS4zMzI4QzI1Ljk5NyAxMS4zOTg0IDI2LjAzNTIgMTEuNDY0NCAyNi4wNzIzIDExLjUzMDdDMjYuMDgzMSAxMS41NTAxIDI2LjA5MzkgMTEuNTY5NCAyNi4xMDQ2IDExLjU4ODhDMjYuMTE3OCAxMS42MTI5IDI2LjEzMDkgMTEuNjM3IDI2LjE0MzkgMTEuNjYxMkMyNi4xNTE4IDExLjY3NTggMjYuMTU5NiAxMS42OTA1IDI2LjE2NzQgMTEuNzA1MkMyNi4yMDI5IDExLjc3MjIgMjYuMjM3NSAxMS44Mzk2IDI2LjI3MTMgMTEuOTA3M0MyNi4yODM1IDExLjkzMTkgMjYuMjk1NyAxMS45NTY1IDI2LjMwNzcgMTEuOTgxMkMyNi4zMTQ3IDExLjk5NTYgMjYuMzIxNyAxMi4wMDk5IDI2LjMyODYgMTIuMDI0MkMyNi4zMzkxIDEyLjA0NjEgMjYuMzQ5NCAxMi4wNjgxIDI2LjM1OTggMTIuMDkwMUMyNi4zNzE4IDEyLjExNTYgMjYuMzg0IDEyLjE0MTEgMjYuMzk1NyAxMi4xNjY3QzI2LjQwMyAxMi4xODI0IDI2LjQxMDIgMTIuMTk4MiAyNi40MTc0IDEyLjIxNDFDMjYuNDI5MSAxMi4yNCAyNi40NDA3IDEyLjI2NjEgMjYuNDUyMyAxMi4yOTIyQzI2LjQ2MDcgMTIuMzExMyAyNi40NjkyIDEyLjMzMDUgMjYuNDc3NSAxMi4zNDk3QzI2LjQ4NzQgMTIuMzcyNCAyNi40OTczIDEyLjM5NSAyNi41MDY5IDEyLjQxNzdDMjYuNTE0MiAxMi40MzQ4IDI2LjUyMTQgMTIuNDUxOSAyNi41Mjg2IDEyLjQ2OUMyNi41MzY3IDEyLjQ4ODUgMjYuNTQ0NSAxMi41MDgxIDI2LjU1MjUgMTIuNTI3NkMyNi41ODA0IDEyLjU5NTUgMjYuNjA3MyAxMi42NjM3IDI2LjYzMzUgMTIuNzMyQzI2LjY1MyAxMi43ODI3IDI2LjY3MTcgMTIuODMzNSAyNi42OTAzIDEyLjg4NDRDMjYuNzAzOCAxMi45MjE0IDI2LjcxNzYgMTIuOTU4MiAyNi43MzA2IDEyLjk5NTNDMjYuNzQ2OCAxMy4wNDEzIDI2Ljc2MiAxMy4wODc1IDI2Ljc3NzUgMTMuMTMzNkMyNi43OTIgMTMuMTc2NyAyNi44MDY2IDEzLjIxOTggMjYuODIwNSAxMy4yNjNDMjYuODMxNyAxMy4yOTgxIDI2Ljg0MjQgMTMuMzMzMyAyNi44NTMzIDEzLjM2ODVDMjYuODY5NiAxMy40MjEyIDI2Ljg4NiAxMy40NzM5IDI2LjkwMTUgMTMuNTI2OEMyNi45MTUyIDEzLjU3NCAyNi45MjgyIDEzLjYyMTIgMjYuOTQxMyAxMy42Njg1QzI2Ljk1MjIgMTMuNzA4IDI2Ljk2MzEgMTMuNzQ3NCAyNi45NzM2IDEzLjc4N0MyNi45ODc1IDEzLjgzOTYgMjcuMDAwNiAxMy44OTIzIDI3LjAxMzcgMTMuOTQ1QzI3LjAyMjIgMTMuOTc5MyAyNy4wMzExIDE0LjAxMzQgMjcuMDM5MiAxNC4wNDc2QzI3LjA1MjkgMTQuMTA1MSAyNy4wNjU4IDE0LjE2MjcgMjcuMDc4NiAxNC4yMjAzQzI3LjA4NTUgMTQuMjUxNyAyNy4wOTI3IDE0LjI4MzEgMjcuMDk5NCAxNC4zMTQ2QzI3LjExMTggMTQuMzcyOCAyNy4xMjM0IDE0LjQzMTEgMjcuMTM0OCAxNC40ODkzQzI3LjE0MSAxNC41MjA5IDI3LjE0NzQgMTQuNTUyNSAyNy4xNTMzIDE0LjU4NDFDMjcuMTYyMyAxNC42MzE5IDI3LjE3MDUgMTQuNjc5OCAyNy4xNzg4IDE0LjcyNzZDMjcuMTg1OSAxNC43Njc4IDI3LjE5MzMgMTQuODA3OSAyNy4xOTk5IDE0Ljg0ODJDMjcuMjA4OCAxNC45MDI0IDI3LjIxNjggMTQuOTU2NyAyNy4yMjQ5IDE1LjAxMDlDMjcuMjMgMTUuMDQ0OCAyNy4yMzUyIDE1LjA3ODYgMjcuMjQgMTUuMTEyNUMyNy4yNDc3IDE1LjE2NjkgMjcuMjU0NyAxNS4yMjEyIDI3LjI2MTYgMTUuMjc1NUMyNy4yNjYzIDE1LjMxMjMgMjcuMjcxMSAxNS4zNDkgMjcuMjc1NCAxNS4zODU3QzI3LjI5MzEgMTUuNTM1MiAyNy4zMDggMTUuNjg0MiAyNy4zMjAyIDE1LjgzMjVDMjcuMzIyMiAxNS44NTY5IDI3LjMyNDQgMTUuODgxMiAyNy4zMjYyIDE1LjkwNTVDMjcuMzMgMTUuOTU1NSAyNy4zMzMxIDE2LjAwNTQgMjcuMzM2NCAxNi4wNTUyQzI3LjMzODggMTYuMDkyNCAyNy4zNDEzIDE2LjEyOTYgMjcuMzQzNCAxNi4xNjY3QzI3LjM0NjYgMTYuMjIyOSAyNy4zNDg4IDE2LjI3OTEgMjcuMzUxMiAxNi4zMzUxQzI3LjM1MjYgMTYuMzY3MyAyNy4zNTQ1IDE2LjM5OTQgMjcuMzU1NiAxNi40MzE1QzI3LjM1NzYgMTYuNDg1IDI3LjM1ODggMTYuNTM4NCAyNy4zNjAxIDE2LjU5MTdDMjcuMzYwOCAxNi42MjI4IDI3LjM2MTkgMTYuNjUzOSAyNy4zNjI0IDE2LjY4NDlDMjcuMzgwOSAxNy43OTY0IDI3LjI1ODkgMTguODM5IDI3LjA2NTMgMTkuNzA2QzI4LjE2NTMgMjAuMDA2IDI5Ljg5NDYgMjAuOTU5NiAyOS4wOTg2IDIzLjQzOTNMMjkuMDY0OCAyMy41Mzk2QzI4LjMzNjIgMjUuNjI4MyAyNi4xNzI2IDI2LjUzNTYgMjQuNTMxOSAyNi4zMDZDMjMuNzQzIDI3LjU5NDkgMjEuMDE4NSAzMC4xNzI2IDE2LjQzMTkgMzAuMTcyNkwxNi4yMTgxIDMwLjE3MDhDMTEuNzU3OSAzMC4wOTI0IDkuMDE4OTYgMjcuNTc0NyA4LjE5ODYxIDI2LjMwNkM3LjEyNjY3IDI2LjM5MzQgNC43ODYzMSAyNS45NTk4IDMuODc0MTMgMjMuNTU1MkwzLjgzMTk0IDIzLjQzOTNDMi45NTIwMiAyMC45MzI3IDQuNzk4NTkgMTkuOTA2IDUuODMxOTQgMTkuNzA2QzUuNzg2NjMgMTkuNTA1NSA1Ljc0NTA4IDE5LjI5NTYgNS43MDgyNCAxOS4wNzc2QzUuNjU5MTIgMTguNzg2OSA1LjYxODQ1IDE4LjQ4MTkgNS41ODc5MyAxOC4xNjU2QzUuNTY1MDUgMTcuOTI4NCA1LjU0NzgzIDE3LjY4NDkgNS41Mzc0MSAxNy40MzY0QzUuNTIzNTEgMTcuMTA1MSA1LjUyMTQ0IDE2Ljc2NDkgNS41MzMyNCAxNi40MTlDNS41NDUwNSAxNi4wNzMgNS41NzA4NSAxNS43MjEzIDUuNjEyNDEgMTUuMzY2OUM1LjY1Mzk2IDE1LjAxMjcgNS43MTEyOSAxNC42NTU4IDUuNzg2NjMgMTQuMjk5NUM1LjgwNTQ3IDE0LjIxMDQgNS44MjU0MSAxNC4xMjEzIDUuODQ2NTMgMTQuMDMyM0M1Ljg4ODc1IDEzLjg1NDMgNS45MzU3MiAxMy42NzY3IDUuOTg3NDEgMTMuNDk5N0M2LjAxMzI1IDEzLjQxMTMgNi4wNDAxIDEzLjMyMjkgNi4wNjg0IDEzLjIzNDlDNi4xMzkxNyAxMy4wMTQ3IDYuMjE3NzUgMTIuNzk2IDYuMzA0NiAxMi41Nzk0QzYuMzIxOTQgMTIuNTM2MiA2LjMzOTcxIDEyLjQ5MzEgNi4zNTc3MiAxMi40NUM2LjM5Mzc5IDEyLjM2MzcgNi40MzExOCAxMi4yNzc5IDYuNDY5OTYgMTIuMTkyNEM2LjQ4OTM3IDEyLjE0OTcgNi41MDkyNCAxMi4xMDcxIDYuNTI5MzQgMTIuMDY0NkM2LjU2OTQ5IDExLjk3OTYgNi42MTA4NiAxMS44OTUgNi42NTM4MiAxMS44MTA5QzYuNjc1MzIgMTEuNzY4OSA2LjY5NzIzIDExLjcyNyA2LjcxOTQ0IDExLjY4NTFDNi44MDgyMyAxMS41MTgxIDYuOTAyNzcgMTEuMzUzMSA3LjAwMzMgMTEuMTkwNkM3LjAyODQ2IDExLjE0OTkgNy4wNTM5NCAxMS4xMDk0IDcuMDc5ODYgMTEuMDY5QzcuMTMxNjMgMTAuOTg4NCA3LjE4NDkzIDEwLjkwODQgNy4yMzk3NSAxMC44MjkyQzcuMjc0NzQgMTAuNzc4NiA3LjMxMDUzIDEwLjcyODQgNy4zNDY3OSAxMC42Nzg0TDIuNjk4NjEgMTEuNTM5M0wzLjgzMTk0IDcuODA1OThMOC43MzUzMyA5LjE5Mzc0QzguNzcxNDkgOS4xNjM2NiA4LjgwNzgxIDkuMTMzNTQgOC44NDQ3IDkuMTAzODlMNi45OTg2MSA3LjgwNTk4TDkuMzY1MjggNS4wMzkzMUwxMS4yMDEgNy43NTE4MVpNMjIuOTY1MyAxMy4yMDZDMjAuMTMxOSAxMi4xMzkzIDE4LjQzMTkgMTQuMzA2IDE2LjQzMTkgMTQuMTA2QzE0LjQzMTkgMTMuOTA2IDEyLjk2NTMgMTIuMzA2IDEwLjAzMTkgMTMuMjA2QzcuMDk4NjEgMTQuMTA2IDcuMzMxOTQgMTcuODcyNiA3LjY2NTI4IDE5LjcwNkM3LjkzMTk0IDIxLjE3MjYgOC4yMzE5NCAyMy4zMDYgOC4yMzE5NCAyMy4zMDZDNy43NzgyNSAyMy4zMTU0IDYuODIzMjcgMjIuODA2OSA2LjE1NDA4IDIwLjg2NTZMNi4wNTk4MSAyMC44ODQxQzUuNzM0MzQgMjAuOTQ3MSA1LjMwMjA4IDIxLjE0NyA1LjA0NzU3IDIxLjQ2MkM0Ljg1ODU2IDIxLjY5NTkgNC42NDUwNCAyMi4xMzM0IDQuOTYzOTcgMjMuMDQxOUM1LjU4OTIyIDI0LjgyMjkgNy4yOTU2MiAyNS4xNzU2IDguMTAwOTUgMjUuMTA5OUw4LjgxNjMyIDI1LjA1MTZMOS4yMDYxNiAyNS42NTQ0QzkuODQ4NTYgMjYuNjQ4IDEyLjMwNTEgMjguOTcyNiAxNi40MzE5IDI4Ljk3MjZDMjAuNTUzOCAyOC45NzI2IDIyLjkxMTcgMjYuNjU0IDIzLjUwODIgMjUuNjc5NEwyMy45MTg5IDI1LjAwODZMMjQuNjk4MSAyNS4xMTc3QzI1Ljg5IDI1LjI4NDYgMjcuNDcxIDI0LjU4MjkgMjcuOTU1OSAyMy4wNzI2QzI4LjI0OSAyMi4xNTk2IDI4LjAzOTcgMjEuNzM0MiAyNy44NTY5IDIxLjUwNjVDMjcuNjExIDIxLjIwMDIgMjcuMTgxIDIwLjk4MTUgMjYuNzQ5NCAyMC44NjM4TDI2LjY5OTQgMjAuODVDMjYuMjczMSAyMS45NjQxIDI1LjU4MTkgMjMuMjA5NCAyNC43MzE5IDIzLjMwNkMyNC43MzE5IDIzLjMwNiAyNS4wMTg2IDIxLjY1MjYgMjUuMjMxOSAxOS43MDZDMjUuNDk4NiAxNy4yNzI2IDI1Ljc5ODYgMTQuMjcyNiAyMi45NjUzIDEzLjIwNloiIGZpbGw9IiMxODM4ODkiLz4KPHBhdGggZD0iTTE2LjUxNSAxLjgyNzMzQzE5LjIzMDIgMS44MjczNSAyMS40MzE0IDMuNzY3NDUgMjEuNDMxNCA2LjE2MDY3QzIxLjQzMTQgNi40MDE2NSAyMS40MDg1IDYuNjM3OTQgMjEuMzY1NSA2Ljg2ODIyQzIwLjQ4NTkgNi4zMzc5IDE4LjY0NDQgNS45NzI2NSAxNi41MTUgNS45NzI2NEMxNC4zODU1IDUuOTcyNjQgMTIuNTQzOSA2LjMzNzg2IDExLjY2NDIgNi44NjgyMkMxMS42MjEzIDYuNjM3OTUgMTEuNTk4NiA2LjQwMTY0IDExLjU5ODYgNi4xNjA2N0MxMS41OTg2IDMuNzY3NDMgMTMuNzk5OCAxLjgyNzMzIDE2LjUxNSAxLjgyNzMzWiIgZmlsbD0iIzE4Mzg4OSIvPgo8L3N2Zz4K"

const SIGN_IN_LABEL = "书生端砚 API key"

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
 * 合并动态模型清单。models 钩子返回的是 OpenCode Model 形状：
 * 协议分流用 api: { id, url, npm }（社区 Zed/ZCode 同款写法）；
 * 能力/价格平台清单里没有，给中性默认，避免宿主显示错误信息。
 */
function mergeModels(providerModels, ids) {
  const merged = {}
  for (const id of ids) {
    const base = providerModels?.[id] ?? {}
    // claude 系模型分流到 Anthropic 原生协议端点（同域），保留
    // server-side cache 等 Anthropic 特性；其余模型走 OpenAI 兼容端点。
    const claude = /claude/i.test(id)
    merged[id] = {
      ...base,
      id,
      name: base.name ?? prettify(id),
      api: {
        id,
        url: claude ? ANTHROPIC_BASE : OPENAI_BASE,
        npm: claude ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible",
      },
      status: "active",
      cost: base.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
      capabilities: base.capabilities ?? {
        temperature: true,
        reasoning: false,
        toolcall: true,
        attachment: false,
        input: { text: true },
        output: { text: true },
      },
    }
  }
  return merged
}

function makeModelsHook() {
  return async (provider, { auth }) => {
    const key = typeof auth?.key === "string" ? auth.key : ""
    if (!key) return provider.models
    const result = await listRemoteModelIds(key)
    if (result.unauthorized) throw signInExpiredError()
    if (!result.ok) return provider.models
    if (result.ids.length === 0) return provider.models
    return mergeModels(provider.models, result.ids)
  }
}

/**
 * 每个账号共用的 loader：把请求发往指定 base，并附上该账号的 API key。
 * 多账号由宿主管理（auth 作用域隔离），这里不持有任何模块级状态。
 */
function makeLoader(base) {
  return (getAuth) =>
    getAuth().then((auth) => {
      if (auth?.type !== "api" || typeof auth.key !== "string" || !auth.key) return {}
      const key = auth.key
      return {
        baseURL: base,
        // apiKey 只是占位：宿主会把这个 fetch 连同 loader options 交给
        // 其他插件（chat.headers 钩子），真 key 绝不出现在这里，
        // 只在下面的 fetch 里按请求注入请求头。
        apiKey: "magpie-intern-ai",
        async fetch(input, init) {
          // 宿主会把这个 fetch 交给其他插件用：只允许把 key 发往书生端砚自己的域名
          let origin = ""
          try {
            origin = new URL(String(input)).origin
          } catch {
            throw new Error("书生端砚插件：拒绝向无法识别的 URL 发送请求")
          }
          if (origin !== "https://discovery-api.intern-ai.org.cn") {
            throw new Error(`书生端砚插件：拒绝把 API key 发往 ${origin}`)
          }
          const headers = new Headers(init?.headers)
          headers.set("authorization", `Bearer ${key}`)
          // claude 系模型经模型级分流发往 Anthropic 协议端点，那里认 x-api-key；
          // OpenAI 兼容端点忽略这个多余的头，可以始终带上。
          headers.set("x-api-key", key)
          return fetch(input, { ...init, headers })
        },
      }
    })
}

// ---------------------------------------------------------------------------
// 书生端砚：单供应商。主走 OpenAI 兼容协议，claude 系模型在 models 钩子里
// 用模型级 provider 覆盖分流到 Anthropic 原生协议端点（同域）。
// ---------------------------------------------------------------------------

export const DuanYanAuth = async (_ctx, options = {}) => ({
  config: async (cfg) => {
    cfg.provider ??= {}
    // 默认值在前、用户在 plugins.json 里的配置在后：补齐字段但不覆盖用户改动
    const was = cfg.provider["duanyan"] ?? {}
    cfg.provider["duanyan"] = {
      name: PROVIDER_NAME,
      npm: "@ai-sdk/openai-compatible",
      api: OPENAI_BASE,
      models: {}, // 纯动态：登录后由 provider.models 从 /v1/models 拉取
      ...was,
    }
  },
  auth: {
    provider: "duanyan",
    icon: ICON,
    maxConcurrency: 4, // 单账号并发上限，防触发平台限流；用户在供应商设置里可覆盖
    methods: [
      {
        type: "api",
        label: SIGN_IN_LABEL,
        placeholder: "在 discovery.intern-ai.org.cn 的控制台生成 API key",
        // 多账号备注名：回答自动存进 metadata.email，宿主用它给账号命名
        // （命名优先级 accountId → metadata.email），列表里一眼分清哪个 key 是谁；
        // 不填则宿主用 key 尾几位命名。同备注名再次登录会替换原账号。
        prompts: [
          {
            type: "text",
            key: "email",
            message: "账号备注名（可选，多账号时便于区分，如：公司号）",
            placeholder: "留空则用 key 尾几位命名",
          },
        ],
      },
      {
        type: "api",
        keyless: true,
        label: "本机登录（读取浏览器 / 端砚客户端）",
        // 不需要用户粘贴 key：读浏览器 Local Storage / 端砚客户端里已登录的 token，
        // 自动读额度、自动建一个 magpie 专用的 API key。没登录时让用户先登录一次。
        prompts: [
          {
            type: "text",
            key: "email",
            message: "账号备注名（可选，多账号时便于区分，如：公司号）",
            placeholder: "留空则用手机号打码命名",
          },
        ],
        async authorize(inputs = {}) {
          const readLocal = options.readLocalCredential ?? options.readLocalCredentials ?? readLocalLogins
          const found = await readLocal(options)
          const candidates = Array.isArray(found) ? found : [found]
          if (candidates.length === 0) {
            throw new Error("没有找到书生端砚登录态：请先在 Edge / Chrome 打开 discovery.intern-ai.org.cn 登录一次，或在书生端砚客户端登录")
          }
          let lastError = null
          let created = null
          let phone = ""
          for (const local of candidates) {
            if (!local?.token) continue
            try {
              const who = await fetchValidate(local.token, options.fetcher)
              phone = maskPhone(who?.phone)
              created = await createApiKey(local.token, apiKeyName(), { fetcher: options.fetcher })
              if (!created?.key) throw new Error("书生端砚没有返回 API key")
              return {
                type: "success",
                key: created.key,
                metadata: {
                  ...(inputs.email ? { email: inputs.email } : phone ? { email: phone } : {}),
                  uaaToken: local.token,
                  keyId: created.id,
                  ...(phone ? { phone } : {}),
                  ...(local.expiresAtMs ? { tokenExpiresAt: local.expiresAtMs } : {}),
                },
              }
            } catch (e) {
              lastError = e
              if (e?.signIn !== "expired") break
            }
          }
          throw lastError ?? new Error("书生端砚登录态不可用")
        },
      },
    ],
    loader: makeLoader(OPENAI_BASE),
    // 额度：本机登录的账号在 metadata 里带着 uaa-token；手动 key 的账号没有，
    // 只能如实说看不到额度，不能编造。
    async usage(getAuth) {
      const auth = await getAuth()
      const token = auth?.metadata?.uaaToken
      if (!token) {
        return { error: "这个账号是手动 API key，未保存书生端砚登录态，看不到额度", windows: [] }
      }
      try {
        const [balance, packages] = await Promise.all([
          fetchBalance(token, options.fetcher),
          fetchPackages(token, options.fetcher).catch(() => null),
        ])
        return usageFromBalance(balance, {
          user: auth.metadata.phone || undefined,
          plan: planNameFromPackages(packages),
        })
      } catch (e) {
        const out = { error: e?.message ?? String(e), windows: [] }
        if (e?.signIn === "expired") out.signIn = "expired"
        return out
      }
    },
  },
  provider: {
    id: "duanyan",
    models: makeModelsHook(),
  },
})

// for tests (a plain object is not treated as a plugin by the host)
export const _internal = {
  maskPhone,
  usageFromBalance,
  readDesktopCredential,
  readLocalLogins,
}

