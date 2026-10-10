// 恢复编排核心（平台无关）：依 DDL 产物把孤儿库文件重新挂回 MySQL 实例。
// 平台特有操作（服务控制 / 权限复位）一律经 PlatformAdapter，核心只用跨平台原语，故 Linux / macOS / Windows 同一份逻辑。
// 阶段划分：
//   Phase 0  停机冷备整目录 → 把孤儿库目录挪到 staging → 起服务
//   Phase 1  运行中建库建表（InnoDB 建表后追加 DISCARD TABLESPACE）
//   Phase 2  运行中把旧 .ibd 拷回并逐表 IMPORT TABLESPACE
//   Phase 3  停机把旧 MyISAM 的 .MYD/.MYI 换回 → 起服务
//   Phase 4  运行中校验（表数 / CHECK TABLE / 逐库体积 / 行数抽样）
import { existsSync } from "node:fs"
import { basename, dirname, join, parse } from "node:path"
import { copyFile, copyTree, dirSize, ensureDir, formatSize, freeSpace, isDir, listDir, movePath } from "../platform"
import type { PlatformAdapter } from "../platform"
import { readTextFile } from "../read-text"
import { MysqlClient } from "./mysql-client"
import { Reporter } from "./report"
import { quoteIdent, quoteStr } from "./sql"
import type { Manifest } from "./types"

// ---------- 类型定义 ----------

/** 恢复运行参数（已由 CLI 解析并填入默认值） */
export interface RecoverOptions {
  /** MySQL 数据目录 */
  dataDir: string
  /** MySQL 二进制目录 */
  binDir: string
  /** DDL 产物目录（含 manifest.json 与 ddl/） */
  workDir: string
  /** 整目录冷备目标 */
  backupDir: string
  /** 孤儿库目录临时停靠目录（须与数据目录同卷） */
  stagingDir: string
  /** MySQL 服务名 */
  serviceName: string
  /** 连接用户 */
  user: string
  /** 连接口令 */
  password: string
  /** 跳过整目录冷备 */
  skipBackup: boolean
  /** 跳过 Phase 4 校验 */
  skipValidate: boolean
  /** 仅做前置校验并打印计划 */
  dryRun: boolean
}

/** 恢复运行上下文 */
export interface RecoverContext {
  /** 平台适配器 */
  adapter: PlatformAdapter
  /** MySQL 客户端 */
  client: MysqlClient
  /** 运行参数 */
  opts: RecoverOptions
  /** 报告器 */
  report: Reporter
  /** DDL 产物清单 */
  manifest: Manifest
}

/** 前置校验得出的处理计划 */
export interface RecoverPlan {
  /** 数据目录中现存的孤儿库 */
  presentLibs: string[]
  /** 数据目录中已缺失的库（可能上次已挪走） */
  missingLibs: string[]
  /** 实际使用的冷备目标（目标盘不可用时回退） */
  effectiveBackupDir: string
}

// ---------- 常量 ----------

/** Phase 1 会话前缀：关闭引擎替换与外键检查，保证建表不因依赖缺失而中断 */
const PHASE1_PREFIX = ["SET SESSION sql_mode='NO_ENGINE_SUBSTITUTION';", "SET NAMES utf8mb4;", "SET SESSION foreign_key_checks=0;"]

/** Phase 2 会话前缀 */
const PHASE2_PREFIX = ["SET SESSION sql_mode='NO_ENGINE_SUBSTITUTION';", "SET SESSION foreign_key_checks=0;"]

// ---------- 函数（按英文首字母排序） ----------

/**
 * 生成 Phase 1 建库建表 SQL（含 InnoDB 建表后的 DISCARD TABLESPACE）。
 * @param ctx 运行上下文
 * @return SQL 文本
 */
function buildPhase1Sql(ctx: RecoverContext): string {
  const { manifest, opts } = ctx
  const parts = [...PHASE1_PREFIX]

  for (const lib of manifest.libs) parts.push(`CREATE DATABASE IF NOT EXISTS ${wrap(lib)};`)
  for (const lib of manifest.libs) {
    parts.push(`USE ${wrap(lib)};`)
    for (const t of manifest.tables) {
      if (t.lib !== lib) continue
      // 产物路径按 posix 记录，Windows 下需拆分后重新拼接
      const body = readTextFile(join(opts.workDir, ...t.ddl.split("/")))
      // 去掉脚本自带的注释首行，只保留 CREATE TABLE 语句
      const stmt = body
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("-- "))
        .join("\n")
        .trim()
      parts.push(stmt)
      if (t.kind === "innodb") parts.push(`ALTER TABLE ${wrap(t.name)} DISCARD TABLESPACE;`)
    }
  }
  return parts.join("\r\n")
}

/**
 * 生成 Phase 2 的 IMPORT TABLESPACE SQL（仅 InnoDB）。
 * @param manifest DDL 产物清单
 * @return SQL 文本
 */
function buildPhase2Sql(manifest: Manifest): string {
  const parts = [...PHASE2_PREFIX]
  for (const lib of manifest.libs) {
    parts.push(`USE ${wrap(lib)};`)
    for (const t of manifest.tables) {
      if (t.lib !== lib || t.kind !== "innodb") continue
      parts.push(`ALTER TABLE ${wrap(t.name)} IMPORT TABLESPACE;`)
    }
  }
  return parts.join("\r\n")
}

/**
 * 生成 Phase 4 的 CHECK TABLE SQL。
 * @param manifest DDL 产物清单
 * @return SQL 文本
 */
function buildPhase4CheckSql(manifest: Manifest): string {
  const parts: string[] = []
  for (const lib of manifest.libs) {
    for (const t of manifest.tables) {
      if (t.lib !== lib) continue
      parts.push(`CHECK TABLE ${wrap(lib)}.${wrap(t.name)};`)
    }
  }
  return parts.join("\r\n")
}

/**
 * Phase 0：停机冷备整目录，并把孤儿库目录挪到 staging，随后起服务。
 * @param ctx 运行上下文
 * @param plan 处理计划
 */
async function phase0(ctx: RecoverContext, plan: RecoverPlan): Promise<void> {
  const { adapter, client, opts, report } = ctx
  report.step("Phase 0 冷备与腾挪（停机）")

  report.info(`停止服务：${opts.serviceName}`)
  await adapter.stopService(opts.serviceName)
  report.info("服务已停止", "OK")

  try {
    if (!opts.skipBackup) {
      report.info(`冷备整目录 → ${plan.effectiveBackupDir}`)
      copyTree(opts.dataDir, plan.effectiveBackupDir)
      report.info("冷备完成", "OK")
    } else {
      report.info("已跳过冷备", "WARN")
    }

    if (plan.presentLibs.length === 0) {
      report.info("数据目录中已无孤儿库目录，跳过腾挪", "WARN")
    } else {
      ensureDir(opts.stagingDir)
      for (const lib of plan.presentLibs) {
        movePath(join(opts.dataDir, lib), join(opts.stagingDir, lib))
        report.info(`已挪出孤儿库目录：${lib}`)
      }
      report.info(`共挪出 ${plan.presentLibs.length} 个库目录到 staging`, "OK")
    }
  } finally {
    report.info("启动服务")
    await adapter.startService(opts.serviceName)
    await client.waitReady()
    report.info("服务已就绪", "OK")
  }
}

/**
 * Phase 1：运行中建库建表（InnoDB 建表后 DISCARD TABLESPACE）。
 * @param ctx 运行上下文
 */
function phase1(ctx: RecoverContext): void {
  const { client, report, manifest } = ctx
  report.step("Phase 1 建库建表（运行中）")
  report.info(`执行建库建表（${manifest.tableCount} 张表）`)
  const result = client.exec(buildPhase1Sql(ctx), { force: true })
  const errors = client.errors(result)
  if (errors.length > 0) {
    for (const line of errors.slice(0, 50)) report.note(`  ${line}`)
    throw new Error(`Phase 1 出现 ${errors.length} 处报错，已中止；详见报告`)
  }
  report.info("全部建表语句执行成功", "OK")
}

/**
 * Phase 2：把旧 .ibd 从 staging 拷回数据目录并逐表 IMPORT TABLESPACE。
 * @param ctx 运行上下文
 */
async function phase2(ctx: RecoverContext): Promise<void> {
  const { adapter, client, opts, report, manifest } = ctx
  report.step("Phase 2 回填 InnoDB 表空间（运行中）")

  let moved = 0
  for (const t of manifest.tables) {
    if (t.kind !== "innodb") continue
    const src = t.dataFiles[0]
    if (!src) continue
    // dataFiles 记录的是原始数据目录路径，同名的旧文件此刻停在 staging
    const fileName = basename(src)
    const stageFile = join(opts.stagingDir, t.lib, fileName)
    if (!existsSync(stageFile)) throw new Error(`staging 中缺少表空间文件：${stageFile}`)
    const dst = join(opts.dataDir, t.lib, fileName)
    copyFile(stageFile, dst)
    // 复位权限，令服务账号可读（Windows 继承数据目录 ACL / unix chown）
    await adapter.resetPermissions(dst)
    moved++
  }
  report.info(`已拷回 ${moved} 个 .ibd 文件`)

  const result = client.exec(buildPhase2Sql(manifest), { force: true })
  const errors = client.errors(result)
  if (errors.length > 0) {
    for (const line of errors.slice(0, 50)) report.note(`  ${line}`)
    throw new Error(`Phase 2 出现 ${errors.length} 处报错，已中止；详见报告`)
  }
  report.info(`全部 ${moved} 张 InnoDB 表空间导入成功`, "OK")
}

/**
 * Phase 3：停机把旧 MyISAM 的 .MYD/.MYI 换回数据目录，随后起服务。
 * @param ctx 运行上下文
 */
async function phase3(ctx: RecoverContext): Promise<void> {
  const { adapter, client, opts, report, manifest } = ctx
  report.step("Phase 3 回填 MyISAM 数据文件（停机）")

  report.info(`停止服务：${opts.serviceName}`)
  await adapter.stopService(opts.serviceName)
  try {
    let moved = 0
    for (const t of manifest.tables) {
      if (t.kind !== "myisam") continue
      for (const src of t.dataFiles) {
        const fileName = basename(src)
        const stageFile = join(opts.stagingDir, t.lib, fileName)
        if (!existsSync(stageFile)) throw new Error(`staging 中缺少 MyISAM 文件：${stageFile}`)
        const dst = join(opts.dataDir, t.lib, fileName)
        copyFile(stageFile, dst)
        await adapter.resetPermissions(dst)
      }
      moved++
    }
    report.info(`已换回 ${moved} 张 MyISAM 表的数据与索引文件`, "OK")
  } finally {
    report.info("启动服务")
    await adapter.startService(opts.serviceName)
    await client.waitReady()
    report.info("服务已就绪", "OK")
  }
}

/**
 * Phase 4：校验表数、CHECK TABLE、逐库体积与行数抽样。
 * @param ctx 运行上下文
 * @return 异常类别计数（0 表示全部通过）
 */
function phase4(ctx: RecoverContext): number {
  const { client, report, manifest } = ctx
  report.step("Phase 4 校验（运行中）")
  let badCount = 0

  // 1. 逐库表数比对
  for (const lib of manifest.libs) {
    const expect = manifest.tables.filter((t) => t.lib === lib).length
    const rows = client.query(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${quoteStr(lib)}';`)
    const actual = Number(rows[0] ?? "0")
    if (actual !== expect) {
      report.info(`${lib} 表数不符：期望 ${expect}，实际 ${actual}`, "ERROR")
      badCount++
    } else {
      report.info(`${lib} 表数 ${actual} ✓`)
    }
  }

  // 2. 逐库体积（非零即说明 .ibd 已带数据回挂）
  report.info("逐库体积（数据+索引）：")
  const libList = manifest.libs.map((lib) => `'${quoteStr(lib)}'`).join(",")
  const sizeRows = client.query(
    `SELECT table_schema, SUM(data_length+index_length) FROM information_schema.tables WHERE table_schema IN (${libList}) GROUP BY table_schema ORDER BY table_schema;`
  )
  for (const line of sizeRows) {
    const cells = line.split("\t")
    if (cells.length >= 2) report.detail(`  ${cells[0]} = ${formatSize(Number(cells[1] ?? "0"))}`)
  }

  // 3. CHECK TABLE 全量（输出列：Table / Op / Msg_type / Msg_text，判第 3 列为 error）
  const result = client.exec(buildPhase4CheckSql(manifest), { force: true })
  const notOk = result.stdout.split(/\r?\n/).filter((line) => {
    if (line.trim() === "") return false
    const cells = line.split("\t")
    return cells.length >= 4 && cells[2] === "error"
  })
  if (notOk.length > 0) {
    for (const line of notOk.slice(0, 50)) report.note(`  ${line}`)
    report.info(`CHECK TABLE 异常 ${notOk.length} 处`, "ERROR")
    badCount++
  } else {
    report.info("CHECK TABLE 全部通过", "OK")
  }

  // 4. 每库首表行数抽样
  report.info("每库首表行数抽样：")
  for (const lib of manifest.libs) {
    const first = manifest.tables.filter((t) => t.lib === lib).sort((a, b) => a.name.localeCompare(b.name))[0]
    if (!first) continue
    const rows = client.query(`SELECT COUNT(*) FROM ${wrap(lib)}.${wrap(first.name)};`)
    report.detail(`  ${lib}.${first.name} = ${rows[0] ?? "0"} 行`)
  }

  return badCount
}

/**
 * 前置校验：核对产物、数据目录、staging、冷备空间与服务端冲突。
 * @param ctx 运行上下文
 * @return 处理计划
 */
async function preflight(ctx: RecoverContext): Promise<RecoverPlan> {
  const { client, opts, report, manifest } = ctx
  report.step("Phase 前置校验")
  report.info(`产物清单：${manifest.tableCount} 张表 / ${manifest.libs.length} 个库`)

  // 1. 数据目录与孤儿库目录
  if (!isDir(opts.dataDir)) throw new Error(`找不到数据目录：${opts.dataDir}`)
  const presentLibs: string[] = []
  const missingLibs: string[] = []
  for (const lib of manifest.libs) {
    if (isDir(join(opts.dataDir, lib))) presentLibs.push(lib)
    else missingLibs.push(lib)
  }
  if (missingLibs.length > 0) {
    report.info(`数据目录中已不存在以下库目录（可能上次已挪走）：${missingLibs.join("、")}`, "WARN")
  }

  // 2. staging 允许为空（首次运行）或仅含本清单内的库目录（上次中断续跑），含其它内容才拒绝
  if (isDir(opts.stagingDir)) {
    const left = listDir(opts.stagingDir)
    const unexpected = left.filter((n) => !manifest.libs.includes(n))
    if (unexpected.length > 0) {
      throw new Error(`staging 目录含非预期内容，请先人工确认并清空：${opts.stagingDir} → ${unexpected.join("、")}`)
    }
    if (left.length > 0) {
      report.info(`检测到上次中断遗留的暂存库目录，将直接复用：${left.join("、")}`, "WARN")
    }
  }

  // 3. staging 须与数据目录同卷（保证挪动为瞬时重命名）
  if (!sameVolume(opts.dataDir, opts.stagingDir)) {
    report.info(`staging 与数据目录不同卷（${root(opts.stagingDir)} vs ${root(opts.dataDir)}），挪动将是整目录拷贝，耗时较长`, "WARN")
  }

  // 4. 冷备目标可用性与空间
  let effectiveBackupDir = opts.backupDir
  if (!opts.skipBackup) {
    if (!isDir(root(effectiveBackupDir))) {
      const fallback = join(dirname(opts.dataDir), "opsbox-backup", "data")
      report.info(`冷备目标盘不可用，回退到：${fallback}`, "WARN")
      effectiveBackupDir = fallback
    }
    // 冷备副本按数据目录体积上浮 10% 估算所需空间
    const need = Math.ceil(dirSize(opts.dataDir) * 1.1)
    const free = freeSpace(effectiveBackupDir)
    if (free < need) {
      throw new Error(`冷备空间不足：需要约 ${formatSize(need)}，可用 ${formatSize(free)}`)
    }
    report.info(`冷备目标：${effectiveBackupDir}，预计需要 ${formatSize(need)}，可用 ${formatSize(free)}`)
  } else {
    report.info("已按参数跳过整目录冷备", "WARN")
  }

  // 5. 服务端不得已存在同名库，否则说明处于半完成状态
  const existing = client.query("SHOW DATABASES;")
  const conflict = manifest.libs.filter((lib) => existing.includes(lib))
  if (conflict.length > 0) {
    throw new Error(`服务端已存在待恢复的库：${conflict.join("、")}；请先确认并清理后再执行`)
  }
  report.info("服务端无同名库冲突")

  return { presentLibs, missingLibs, effectiveBackupDir }
}

/**
 * 打印 DryRun 计划预览。
 * @param ctx 运行上下文
 * @param plan 处理计划
 */
function printPlan(ctx: RecoverContext, plan: RecoverPlan): void {
  const { opts, report, manifest } = ctx
  report.step("DryRun 计划预览")
  report.info(`待冷备目录：${opts.dataDir} → ${plan.effectiveBackupDir}`)
  report.info(`待挪出库目录：${plan.presentLibs.join("、")}`)
  const innodb = manifest.tables.filter((t) => t.kind === "innodb").length
  const myisam = manifest.tables.filter((t) => t.kind === "myisam").length
  report.info(`待重建表数：${manifest.tableCount}（InnoDB ${innodb} / MyISAM ${myisam}）`)
  report.info("DryRun 结束，未做任何变更", "WARN")
}

/**
 * 恢复入口：串联前置校验与四个阶段，落盘运行报告。
 * @param opts 运行参数
 * @param adapter 平台适配器
 * @example await recover({ dataDir, binDir, workDir, ... }, resolveAdapter())
 */
export async function recover(opts: RecoverOptions, adapter: PlatformAdapter): Promise<void> {
  const report = new Reporter()
  const client = new MysqlClient({ binDir: opts.binDir, user: opts.user, password: opts.password })
  const runDir = join(opts.workDir, `run-${timestamp()}`)
  const reportPath = join(runDir, "restore-report.txt")
  console.log(`旧库恢复  运行目录：${runDir}`)

  try {
    report.info(`已连接 MySQL ${client.version()}`, "OK")

    const manifestPath = join(opts.workDir, "manifest.json")
    if (!existsSync(manifestPath)) {
      throw new Error(`找不到 manifest：${manifestPath}（请先执行 opsbox mysql-recover ddl 生成产物）`)
    }
    const manifest = JSON.parse(readTextFile(manifestPath)) as Manifest
    const ctx: RecoverContext = { adapter, client, opts, report, manifest }

    const plan = await preflight(ctx)
    if (opts.dryRun) {
      printPlan(ctx, plan)
      return
    }

    await phase0(ctx, plan)
    phase1(ctx)
    await phase2(ctx)
    await phase3(ctx)

    let bad = 0
    if (!opts.skipValidate) bad = phase4(ctx)

    report.step("完成")
    if (bad === 0) {
      report.info("恢复完成，校验全部通过", "OK")
      report.info("后续请到宝塔面板执行「从服务器获取」重建库记录，并重新授予旧应用账号权限", "WARN")
    } else {
      report.info(`恢复流程结束，但校验存在 ${bad} 类异常，请查阅报告`, "ERROR")
    }
  } finally {
    client.dispose()
    report.save(reportPath)
    console.log(`报告已写入：${reportPath}`)
  }
}

/**
 * 取路径所在卷根。
 * @param p 路径
 * @return 卷根（Windows 下统一小写以便比较）
 */
function root(p: string): string {
  const r = parse(p).root
  return process.platform === "win32" ? r.toLowerCase() : r
}

/**
 * 判断两路径是否同卷。
 * @param a 路径一
 * @param b 路径二
 * @return 同卷返回 true
 */
function sameVolume(a: string, b: string): boolean {
  return root(a) === root(b)
}

/**
 * 生成 yyyyMMdd-HHmmss 时间戳。
 * @return 时间戳文本
 */
function timestamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, "0")
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * 用反引号包裹标识符（内部反引号加倍转义）。
 * @param name 原始标识符
 * @return 可安全嵌入 SQL 的标识符
 */
function wrap(name: string): string {
  return "`" + quoteIdent(name) + "`"
}
