// project-rename 能力入口：注册单一子命令，路径解析与选项收口在此，编排逻辑在 engine
import { resolve } from "node:path"
import type { Command } from "commander"
import { getConfigString } from "../config"
import { printJson, assertJsonFormat } from "../json-output"
import { renameProject } from "./engine"

// ---------- 类型定义 ----------

/** project-rename 子命令参数 */
interface RenameCliOptions {
  /** 仅输出计划 */
  dryRun?: boolean
  /** 跳过确认 */
  yes?: boolean
  /** 限定宿主 id（可多次传入） */
  host: string[]
  /** 备份目录 */
  backupDir?: string
  /** 是否启用备份（--no-backup 置 false） */
  backup: boolean
  /** 执行第二趟 */
  resume?: boolean
  /** 输出格式 */
  format?: string
}

// ---------- 函数（按英文首字母排序） ----------

/**
 * 累积多次传入的 --host（commander collect 范式）。
 * @param value 本次取值
 * @param previous 已收集值
 * @return 累积后的数组
 */
function collectHost(value: string, previous: string[]): string[] {
  return [...previous, value]
}

/**
 * 注册 project-rename 能力。
 * @param program 顶层命令
 * @example registerProjectRename(program)
 */
export function registerProjectRename(program: Command): void {
  program
    .command("project-rename")
    .description("项目目录改名，并迁移各宿主中跟随目录名的关联状态（跨平台）")
    .argument("<old-path>", "旧目录路径")
    .argument("<new-path>", "新目录路径")
    .option("--dry-run", "仅输出迁移计划，不落盘")
    .option("--yes", "跳过交互确认")
    .option("--host <id>", "限定宿主（可多次传入；缺省迁移全部检出宿主）", collectHost, [])
    .option("--backup-dir <dir>", "备份目录（默认取配置 project-rename.backupDir，否则 <旧路径>/.opsbox/project-rename/<时间戳>）")
    .option("--no-backup", "跳过备份（危险：将无法回滚）")
    .option("--resume", "执行第二趟：复制二进制状态并清理旧工作区目录")
    .option("--format <format>", "输出格式（json，结果摘要输出到 stdout）")
    .action(async (oldPath: string, newPath: string, options: RenameCliOptions) => {
      try {
        if (!assertJsonFormat(options.format)) return
        const json = options.format === "json"
        const backupDir = options.backupDir ?? getConfigString("project-rename", "backupDir")
        const result = await renameProject({
          oldPath: resolve(oldPath),
          newPath: resolve(newPath),
          hosts: options.host,
          backupDir: backupDir ? resolve(backupDir) : undefined,
          noBackup: !options.backup,
          dryRun: Boolean(options.dryRun),
          yes: Boolean(options.yes),
          resume: Boolean(options.resume),
          quiet: json
        })
        if (json) printJson(result)
      } catch (e) {
        console.error(`⚠️ 目录改名失败：${(e as Error).message}`)
        process.exitCode = 1
      }
    })
}
