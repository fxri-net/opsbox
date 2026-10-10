// 跨平台文件系统原语：纯 Node 实现，各端行为一致，供平台无关核心直接使用
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * 确保目录存在（递归创建）。
 * @param dir 目录路径
 */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

/**
 * 递归拷贝目录树到目标（目标不存在则创建，已存在文件被覆盖）。
 * @param src 源目录
 * @param dst 目标目录
 */
export function copyTree(src: string, dst: string): void {
  ensureDir(dirname(dst))
  cpSync(src, dst, { recursive: true, force: true })
}

/**
 * 移动路径：优先尝试同卷瞬时重命名，跨卷时回退为拷贝后删除。
 * @param src 源路径
 * @param dst 目标路径
 */
export function movePath(src: string, dst: string): void {
  ensureDir(dirname(dst))
  try {
    renameSync(src, dst)
  } catch {
    copyTree(src, dst)
    rmSync(src, { recursive: true, force: true })
  }
}

/**
 * 拷贝单个文件（覆盖已存在目标）。
 * @param src 源文件
 * @param dst 目标文件
 */
export function copyFile(src: string, dst: string): void {
  ensureDir(dirname(dst))
  copyFileSync(src, dst)
}

/**
 * 计算目录总字节数（递归；路径不存在返回 0）。
 * @param dir 目录路径
 * @return 总字节数
 */
export function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(full)
    else if (entry.isFile()) total += statSync(full).size
  }
  return total
}

/**
 * 目标路径所在文件系统的可用字节数。
 * @param target 目标路径（可尚不存在，逐级上溯到最近的存在祖先）
 * @return 可用字节数
 */
export function freeSpace(target: string): number {
  let probe = target
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  const st = statfsSync(probe)
  return Number(st.bavail) * Number(st.bsize)
}

/**
 * 判断路径是否为已存在的目录。
 * @param p 路径
 * @return 是目录返回 true
 */
export function isDir(p: string): boolean {
  return existsSync(p) && statSync(p).isDirectory()
}

/**
 * 列举目录下的条目名（含隐藏项；路径不存在返回空数组）。
 * @param dir 目录路径
 * @return 条目名数组
 */
export function listDir(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
}

/**
 * 字节数格式化为易读文本。
 * @param bytes 字节数
 * @return 形如 1.23 GB 的文本
 */
export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value.toFixed(2)} ${units[index] ?? "B"}`
}
