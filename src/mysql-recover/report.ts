// 恢复流程报告器：终端输出与落盘报告同源，避免两处文案漂移
import { writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { ensureDir } from "../platform"

/** 信息级别 */
export type ReportLevel = "INFO" | "WARN" | "ERROR" | "OK"

/** 级别 → 终端前景色（ANSI） */
const LEVEL_COLOR: Record<ReportLevel, string> = {
  INFO: "\u001b[90m",
  WARN: "\u001b[33m",
  ERROR: "\u001b[31m",
  OK: "\u001b[32m"
}

/** ANSI 复位序列 */
const RESET = "\u001b[0m"

/** 恢复流程报告器 */
export class Reporter {
  /** 报告文本行（终端与落盘共用） */
  private readonly lines: string[] = []

  /**
   * 打印并记录一行明细（不带级别前缀）。
   * @param text 明细文本
   */
  detail(text: string): void {
    console.log(text)
    this.lines.push(text)
  }

  /**
   * 打印并记录一条带级别的信息。
   * @param text 信息文本
   * @param level 级别
   */
  info(text: string, level: ReportLevel = "INFO"): void {
    console.log(`${LEVEL_COLOR[level]}[${level}] ${text}${RESET}`)
    this.lines.push(`[${level}] ${text}`)
  }

  /**
   * 仅记入报告（不打印终端），用于批量明细避免刷屏。
   * @param text 文本
   */
  note(text: string): void {
    this.lines.push(text)
  }

  /**
   * 落盘报告。
   * @param file 目标文件路径
   */
  save(file: string): void {
    ensureDir(dirname(file))
    writeFileSync(file, this.lines.join("\r\n"), "utf8")
  }

  /**
   * 打印并记录一个步骤标题。
   * @param text 标题文本
   */
  step(text: string): void {
    console.log(`\n=== ${text} ===`)
    this.lines.push("", `=== ${text} ===`)
  }

  /**
   * 取报告全文。
   * @return 报告文本
   */
  toString(): string {
    return this.lines.join("\r\n")
  }
}
