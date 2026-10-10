// 文本读取与 BOM 剥离的单一入口
// Windows 下 PowerShell 的 Set-Content / 重定向默认写 UTF-8 BOM，散落各处的剥离逻辑容易漏写，统一收敛到此
import { readFileSync } from "node:fs"

/**
 * 剥离文本开头的 UTF-8 BOM（无 BOM 时原样返回）。
 * @param text 原始文本
 * @return 去 BOM 文本
 */
export function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "")
}

/**
 * 读文本文件并剥离 BOM。
 * @param file 文件绝对路径
 * @return 去 BOM 的文件内容
 */
export function readTextFile(file: string): string {
  return stripBom(readFileSync(file, "utf8"))
}
