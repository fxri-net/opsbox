// mysql-recover 能力入口：注册 ddl / restore 两个子命令，平台默认值由适配器提供，可经选项覆盖
import { join, resolve } from "node:path"
import type { Command } from "commander"
import { resolveAdapter } from "../platform"
import { promptPassword } from "../prompt"
import { resolveTool } from "./mysql-client"
import { recover } from "./recover"
import { generateDdl } from "./sdi-to-ddl"

// ---------- 类型定义 ----------

/** ddl 子命令参数 */
interface DdlCliOptions {
  /** 数据目录 */
  data?: string
  /** 产物输出目录 */
  out: string
  /** ibd2sdi 可执行文件路径 */
  ibd2sdi?: string
  /** ibd2sdi 结果缓存目录 */
  cache?: string
  /** 仅处理的库（可多次传入） */
  only: string[]
}

/** restore 子命令参数 */
interface RestoreCliOptions {
  /** 数据目录 */
  data?: string
  /** 二进制目录 */
  bin?: string
  /** 产物目录 */
  work: string
  /** 冷备目标 */
  backup?: string
  /** 孤儿库临时停靠目录 */
  staging?: string
  /** 服务名 */
  service?: string
  /** 连接用户 */
  user: string
  /** 连接口令 */
  password?: string
  /** 跳过冷备 */
  skipBackup?: boolean
  /** 跳过校验 */
  skipValidate?: boolean
  /** 仅预览 */
  dryRun?: boolean
}

// ---------- 函数（按英文首字母排序） ----------

/**
 * 累积多次传入的 --only（commander collect 范式）。
 * @param value 本次取值
 * @param previous 已收集值
 * @return 累积后的数组
 */
function collectLib(value: string, previous: string[]): string[] {
  return [...previous, value]
}

/**
 * 取生效路径：显式选项优先，其次平台推导值，两者皆空时明确报错。
 * @param explicit 显式传入值
 * @param derived 平台推导值
 * @param hint 缺失时的提示语
 * @return 生效路径
 */
function pickPath(explicit: string | undefined, derived: string, hint: string): string {
  const value = (explicit ?? derived).trim()
  if (!value) throw new Error(`无法从当前环境自动推导该路径，${hint}`)
  return value
}

/**
 * 注册 mysql-recover 能力。
 * @param program 顶层命令
 * @example registerMysqlRecover(program)
 */
export function registerMysqlRecover(program: Command): void {
  const group = program.command("mysql-recover").description("从重装后遗留的数据目录恢复 MySQL 库（跨平台）")

  group
    .command("ddl")
    .description("从数据目录的 SDI 还原建表 DDL 与产物清单")
    .option("--data <dir>", "MySQL 数据目录（默认取当前平台约定）")
    .option("--out <dir>", "产物输出目录", ".opsbox")
    .option("--ibd2sdi <path>", "ibd2sdi 可执行文件路径（默认取二进制目录）")
    .option("--cache <dir>", "ibd2sdi 结果缓存目录（默认 <out>/.cache）")
    .option("--only <lib>", "仅处理指定库（可多次传入；缺省处理全部）", collectLib, [])
    .action((options: DdlCliOptions) => {
      try {
        const adapter = resolveAdapter()
        const dataDir = pickPath(options.data, adapter.defaults.dataDir, "请用 --data 指定 MySQL 数据目录")
        const outDir = resolve(options.out)
        const cacheDir = options.cache ? resolve(options.cache) : join(outDir, ".cache")
        const binDir = pickPath(undefined, adapter.defaults.binDir, "请用 --ibd2sdi 指定 ibd2sdi 可执行文件路径")
        const ibd2sdiExe = options.ibd2sdi ?? resolveTool(binDir, "ibd2sdi")
        console.log(`平台：${adapter.label}`)
        console.log(`数据目录：${dataDir}`)
        const manifest = generateDdl({ dataDir, outDir, ibd2sdiExe, cacheDir, only: options.only })
        console.log(`已生成 ${manifest.tableCount} 张表的 DDL，覆盖 ${manifest.libs.length} 个库 → ${join(outDir, "ddl")}`)
        if (manifest.warnings.length > 0) {
          console.warn(`⚠️ ${manifest.warnings.length} 条告警：`)
          for (const w of manifest.warnings.slice(0, 50)) console.warn(`  - ${w}`)
        }
      } catch (e) {
        console.error(`⚠️ DDL 生成失败：${(e as Error).message}`)
        process.exitCode = 1
      }
    })

  group
    .command("restore")
    .description("依 DDL 产物把孤儿库文件重新挂回 MySQL 实例")
    .option("--data <dir>", "MySQL 数据目录（默认取当前平台约定）")
    .option("--bin <dir>", "MySQL 二进制目录（默认取当前平台约定）")
    .option("--work <dir>", "DDL 产物目录（含 manifest.json 与 ddl/）", ".opsbox")
    .option("--backup <dir>", "整目录冷备目标（默认取当前平台约定）")
    .option("--staging <dir>", "孤儿库临时停靠目录（默认取当前平台约定）")
    .option("--service <name>", "MySQL 服务名（默认取当前平台约定）")
    .option("--user <name>", "连接用户", "root")
    .option("--password <pwd>", "连接口令（缺省则交互式输入）")
    .option("--skip-backup", "跳过整目录冷备")
    .option("--skip-validate", "跳过恢复后校验")
    .option("--dry-run", "仅做前置校验并打印执行计划")
    .action(async (options: RestoreCliOptions) => {
      try {
        const adapter = resolveAdapter()
        const password = options.password ?? (await promptPassword(`请输入 MySQL ${options.user} 口令：`))
        console.log(`平台：${adapter.label}`)
        await recover(
          {
            dataDir: pickPath(options.data, adapter.defaults.dataDir, "请用 --data 指定 MySQL 数据目录"),
            binDir: pickPath(options.bin, adapter.defaults.binDir, "请用 --bin 指定 MySQL 二进制目录"),
            workDir: resolve(options.work),
            backupDir: pickPath(options.backup, adapter.defaults.backupDir, "请用 --backup 指定整目录冷备目标"),
            stagingDir: pickPath(options.staging, adapter.defaults.stagingDir, "请用 --staging 指定孤儿库临时停靠目录"),
            serviceName: options.service ?? adapter.defaults.serviceName,
            user: options.user,
            password,
            skipBackup: Boolean(options.skipBackup),
            skipValidate: Boolean(options.skipValidate),
            dryRun: Boolean(options.dryRun)
          },
          adapter
        )
      } catch (e) {
        console.error(`⚠️ 恢复失败：${(e as Error).message}`)
        process.exitCode = 1
      }
    })

  // 裸命令（无子命令）打印本域帮助，而非静默无输出
  group.action(() => group.help())
}
