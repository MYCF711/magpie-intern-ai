// 读 Chromium（Edge / Chrome / Brave）Local Storage 的 LevelDB —— 只找登录 token。
//
// Chromium 的 Local Storage 是标准 LevelDB：`.ldb` 是 SSTable（块可能用 Snappy
// 压缩），当前写入在 `.log`。这里只实现「读」所需的最小 SSTable 解析，不写、
// 不加锁；不接受任何来自网络的输入。

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import snappy from "snappyjs"

const TABLE_MAGIC = 0xdb4775248b80fb57n

function readVarint(buf, pos) {
  let value = 0
  let shift = 0
  for (let i = 0; i < 10; i++) {
    const byte = buf[pos + i]
    if (byte === undefined) throw new Error("LevelDB varint 越界")
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return [value, pos + i + 1]
    shift += 7
  }
  throw new Error("LevelDB varint 过长")
}

function readBlock(file, offset, size) {
  // LevelDB 的块句柄只给内容长度；后面还有 5 字节 trailer（压缩类型 + CRC32）。
  const raw = file.subarray(offset, offset + size + 5)
  if (raw.length !== size + 5) throw new Error("LevelDB 块越界")
  const compression = raw[size]
  const payload = raw.subarray(0, size)
  if (compression === 0) return payload
  if (compression === 1) return Buffer.from(snappy.uncompress(payload))
  throw new Error(`LevelDB 不认识的压缩类型 ${compression}`)
}

function blockEntries(block) {
  if (block.length < 4) return []
  const restartCount = block.readUInt32LE(block.length - 4)
  const end = block.length - 4 - restartCount * 4
  const entries = []
  let pos = 0
  let lastKey = Buffer.alloc(0)
  while (pos < end) {
    let shared
    let unshared
    let valueLength
    ;[shared, pos] = readVarint(block, pos)
    ;[unshared, pos] = readVarint(block, pos)
    ;[valueLength, pos] = readVarint(block, pos)
    const keyDelta = block.subarray(pos, pos + unshared)
    pos += unshared
    const value = block.subarray(pos, pos + valueLength)
    pos += valueLength
    lastKey = Buffer.concat([lastKey.subarray(0, shared), keyDelta])
    entries.push([lastKey, value])
  }
  return entries
}

function readTable(file) {
  if (file.length < 48) return []
  const footer = file.subarray(file.length - 48)
  if (footer.readBigUInt64LE(40) !== TABLE_MAGIC) throw new Error("LevelDB 表尾 magic 不对")
  let pos = 0
  let metaOffset
  let metaSize
  let indexOffset
  let indexSize
  ;[metaOffset, pos] = readVarint(footer, pos)
  ;[metaSize, pos] = readVarint(footer, pos)
  ;[indexOffset, pos] = readVarint(footer, pos)
  ;[indexSize, pos] = readVarint(footer, pos)
  const indexEntries = blockEntries(readBlock(file, indexOffset, indexSize))
  const out = []
  for (const [, handle] of indexEntries) {
    let off
    let size
    let p = 0
    ;[off, p] = readVarint(handle, p)
    ;[size, p] = readVarint(handle, p)
    try {
      for (const [key, value] of blockEntries(readBlock(file, off, size))) out.push([key, value])
    } catch {
      // 损坏/不完整的块不拖垮整次查找：Local Storage 里可能还有旧表。
    }
  }
  return out
}

function decodeValue(value) {
  if (!value || value.length === 0) return ""
  if (value[0] === 1) return value.subarray(1).toString("utf8")
  if (value[0] === 0) return value.subarray(1).toString("utf16le")
  return value.toString("utf8")
}

function tokenFromEntries(entries) {
  const found = []
  for (const [key, value] of entries) {
    const textKey = String(key)
    if (!textKey.includes("uaa-token")) continue
    if (!/intern-ai|openxlab/i.test(textKey)) continue
    const token = decodeValue(value)
    if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token.trim())) {
      found.push({ token: token.trim(), key: textKey })
    }
  }
  return found
}

/** 从一个 `Local Storage/leveldb` 目录里读所有 uaa-token（JWT）。 */
export function readTokensFromLeveldb(dir) {
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter((name) => name.endsWith(".ldb") || name.endsWith(".log"))
  const out = []
  for (const name of files) {
    const path = join(dir, name)
    try {
      const buf = readFileSync(path)
      if (name.endsWith(".ldb")) {
        out.push(...tokenFromEntries(readTable(buf)))
      } else {
        // 日志里未压缩的记录：直接找 `uaa-token` 后面紧跟的 JWT。
        const text = buf.toString("latin1")
        const re = /uaa-token[\s\S]{0,400}?(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g
        let match
        while ((match = re.exec(text))) out.push({ token: match[1], key: "log:uaa-token" })
      }
    } catch {
      // 单个文件读不了就跳过，别让一个旧表挡住其它 profile。
    }
  }
  return out
}

/** 本机 Chromium 浏览器的 User Data 目录（存在的才返回）。 */
export function browserUserDataDirs(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir()
  const local = env.LOCALAPPDATA || ""
  const candidates = []
  if (process.platform === "win32" && local) {
    candidates.push(
      join(local, "Microsoft", "Edge", "User Data"),
      join(local, "Google", "Chrome", "User Data"),
      join(local, "BraveSoftware", "Brave-Browser", "User Data"),
    )
  } else if (process.platform === "darwin") {
    candidates.push(
      join(home, "Library", "Application Support", "Microsoft Edge"),
      join(home, "Library", "Application Support", "Google", "Chrome"),
      join(home, "Library", "Application Support", "BraveSoftware", "Brave-Browser"),
    )
  } else {
    candidates.push(
      join(home, ".config", "microsoft-edge"),
      join(home, ".config", "google-chrome"),
      join(home, ".config", "BraveSoftware", "Brave-Browser"),
    )
  }
  return candidates.filter((dir) => existsSync(dir))
}

/** 扫本机所有 Chromium profile 的 Local Storage，返回去重后的 token。 */
export function readBrowserTokens(env = process.env) {
  const out = []
  const seen = new Set()
  for (const userData of browserUserDataDirs(env)) {
    let profiles = []
    try {
      profiles = readdirSync(userData)
    } catch {
      continue
    }
    for (const profile of profiles) {
      if (profile !== "Default" && !/^Profile \d+$/.test(profile)) continue
      const leveldb = join(userData, profile, "Local Storage", "leveldb")
      for (const hit of readTokensFromLeveldb(leveldb)) {
        if (seen.has(hit.token)) continue
        seen.add(hit.token)
        out.push({ ...hit, source: `${userData}\\${profile}`, mtime: statSync(join(userData, profile, "Local Storage", "leveldb")).mtimeMs })
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}
