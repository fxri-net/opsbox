// SQLite 状态库改写：VS Code 系宿主把「项目关联引用」存于 globalStorage/state.vscdb 的 ItemTable，
// 目录改名后须把其中含旧路径的键值改写为新路径，宿主方有望把新路径识别为同一项目（实验性重关联）
import sqlite3 from "node-sqlite3-wasm"
import { replacePaths } from "./paths"

// ---------- 函数（按英文首字母排序） ----------

/**
 * 改写 SQLite 状态库（ItemTable）中含旧路径的文本值（非文本值跳过；缺失文件报错）。
 * @param dbFile 数据库文件绝对路径
 * @param oldPath 旧路径
 * @param newPath 新路径
 * @return 发生改写的键数
 */
export function rewriteDbPaths(dbFile: string, oldPath: string, newPath: string): number {
  // fileMustExist 防止误把不存在的路径建成空库；非 SQLite 文件会在此抛错，由上层吞掉并告警
  const db = new sqlite3.Database(dbFile, { fileMustExist: true })
  let changed = 0
  try {
    const rows = db.all("SELECT key, value FROM ItemTable") as Array<{ key: string; value: unknown }>
    for (const row of rows) {
      if (typeof row.value !== "string") continue
      const next = replacePaths(row.value, oldPath, newPath)
      if (next === row.value) continue
      db.run("UPDATE ItemTable SET value = ? WHERE key = ?", [next, row.key])
      changed += 1
    }
  } finally {
    db.close()
  }
  return changed
}
