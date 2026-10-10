// 原子写文件：先写同目录临时文件再 rename，降低写一半进程崩溃产生半截文件的风险
import { writeFileSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * 原子写文件（先写临时文件再重命名）。
 * @param file 目标文件绝对路径
 * @param content 写入内容
 */
export function writeFileAtomic(file: string, content: string | Buffer): void {
  const tmp = join(dirname(file), `.tmp-${process.pid}-${Date.now().toString(36)}`)
  writeFileSync(tmp, content)
  renameSync(tmp, file)
}
