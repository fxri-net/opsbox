// SQLite 状态库改写单测：以真实库文件验证 ItemTable 文本值改写、幂等与错误处理
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sqlite3 from "node-sqlite3-wasm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { rewriteDbPaths } from "../sqlite"

/** 当前用例的临时工作目录 */
let work: string
/** 状态库文件路径 */
let dbFile: string
/** 旧路径 */
const oldPath = "D:\\proj\\old"
/** 新路径 */
const newPath = "D:\\proj\\next"

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "opsbox-sqlite-"))
  dbFile = join(work, "state.vscdb")
  const db = new sqlite3.Database(dbFile)
  db.exec("CREATE TABLE ItemTable (key TEXT, value BLOB)")
  db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", ["json", JSON.stringify({ folder: oldPath })])
  db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", ["raw", `${oldPath}\\src\\x.ts`])
  db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", ["keep", "unchanged"])
  db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", ["num", 123])
  db.close()
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

/**
 * 读取库中全部键值。
 * @return 键值数组
 */
function readRows(): Array<{ key: string; value: unknown }> {
  const db = new sqlite3.Database(dbFile, { fileMustExist: true })
  try {
    return db.all("SELECT key, value FROM ItemTable") as Array<{ key: string; value: unknown }>
  } finally {
    db.close()
  }
}

describe("rewriteDbPaths", () => {
  it("改写含旧路径的文本值，非文本值原样保留", () => {
    expect(rewriteDbPaths(dbFile, oldPath, newPath)).toBe(2)
    const rows = new Map(readRows().map((row) => [row.key, row.value]))
    expect(JSON.parse(rows.get("json") as string)).toEqual({ folder: newPath })
    expect(rows.get("raw")).toBe(`${newPath}\\src\\x.ts`)
    expect(rows.get("keep")).toBe("unchanged")
    expect(rows.get("num")).toBe(123)
  })

  it("再次改写无变化时返回 0（幂等）", () => {
    rewriteDbPaths(dbFile, oldPath, newPath)
    expect(rewriteDbPaths(dbFile, oldPath, newPath)).toBe(0)
  })

  it("缺失文件报错", () => {
    expect(() => rewriteDbPaths(join(work, "nope.vscdb"), oldPath, newPath)).toThrow()
  })
})
