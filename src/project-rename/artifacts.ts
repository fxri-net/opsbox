// 迁移载体抽象：把「跟随目录名的关联状态」按文本 / 二进制 / 状态库 / 缓存 / 目录五类收口，动作随之确定
import { existsSync, readFileSync, rmSync } from "node:fs"
import { readTextFile } from "../read-text"
import { writeFileAtomic } from "../write-atomic"
import { replaceUri } from "./paths"

// ---------- 类型定义 ----------

/** 载体种类：text 改写路径／binary 整文件搬迁或让宿主重生成／sqlite 解析改写状态库／cache 直接丢弃／dir 目录改名 */
export type ArtifactKind = "text" | "binary" | "sqlite" | "cache" | "dir"

/** 双趟迁移元数据：二进制工作区状态须等宿主生成新 id 目录后再复制 */
export interface TwoPassMeta {
  /** 旧工作区 id 目录名 */
  oldId: string
  /** 旧工作区 id 目录绝对路径 */
  oldDir: string
  /** 宿主 User 根（workspaceStorage 的父目录） */
  workspaceRoot: string
  /** 旧 state.vscdb 绝对路径（第一趟备份来源） */
  dbFile: string
}

/** 单个待迁移载体 */
export interface Artifact {
  /** 所属宿主标识 */
  host: string
  /** 载体种类 */
  kind: ArtifactKind
  /** 载体绝对路径 */
  path: string
  /** 人类可读说明（用于计划打印） */
  note: string
  /** 双趟迁移元数据（仅工作区二进制状态携带） */
  twoPass?: TwoPassMeta
}

// ---------- 函数（按英文首字母排序） ----------

/**
 * 丢弃缓存路径（文件或目录）。
 * @param p 路径
 */
export function discardPath(p: string): void {
  rmSync(p, { recursive: true, force: true })
}

/**
 * 判断文件原始字节是否包含任一特征串（缺失文件视为未命中）。
 * @param file 文件绝对路径
 * @param needles 待匹配特征串
 * @return 命中任一返回 true
 */
export function fileContains(file: string, needles: string[]): boolean {
  if (!existsSync(file)) return false
  const buf = readFileSync(file)
  return needles.some((needle) => buf.includes(Buffer.from(needle, "utf8")))
}

/**
 * 读取 JSON 文件的某个字符串字段（去 BOM；文件缺失、解析失败或字段非字符串均返回 null）。
 * @param file 文件绝对路径
 * @param field 字段名
 * @return 字段值或 null
 */
export function readJsonField(file: string, field: string): string | null {
  if (!existsSync(file)) return null
  try {
    const data = JSON.parse(readTextFile(file)) as Record<string, unknown>
    const value = data[field]
    return typeof value === "string" ? value : null
  } catch {
    return null
  }
}

/**
 * 把文本文件中的旧 URI 改写为新 URI（无变化不落盘）。
 * @param file 文件绝对路径
 * @param oldUri 旧 file URI
 * @param newUri 新 file URI
 * @return 发生改写返回 true
 */
export function rewriteTextFile(file: string, oldUri: string, newUri: string): boolean {
  const text = readTextFile(file)
  const next = replaceUri(text, oldUri, newUri)
  if (next === text) return false
  writeFileAtomic(file, next)
  return true
}
