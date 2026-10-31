// 发布到 npm 的包装器 —— 用 `npm run publish:npm`。
//
// package.json 的 name 是 ASCII slug（magpie-intern-ai），也就是 npm 包名；
// 卡片标题用的是 magpie.name。发布时不需要临时换 name；包名不同时再临时换。

import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const PUBLISH_AS = "magpie-intern-ai"
const FILE = fileURLToPath(new URL("./package.json", import.meta.url))
const orig = fs.readFileSync(FILE, "utf8")
const pkg = JSON.parse(orig)

const renamed = pkg.name !== PUBLISH_AS
if (renamed) {
  pkg.name = PUBLISH_AS
  fs.writeFileSync(FILE, JSON.stringify(pkg, null, 2) + "\n")
}

try {
  execSync(process.argv[2] || "npm publish --access public", { stdio: "inherit" })
} finally {
  if (renamed) {
    fs.writeFileSync(FILE, orig)
    console.log("name 已还原为 " + JSON.parse(orig).name)
  }
}
