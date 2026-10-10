// project-rename 编排核心：两趟完成目录改名与宿主状态迁移
// 阶段划分：
//   第一趟（宿主全关）：构建计划 → 前置校验 → 打印 → 备份 → 文本改写 + 状态库改写 + 目录改名 + 缓存丢弃 → 项目目录改名 → 落续迁清单
//   第二趟（用户重开宿主生成新 id 后）：按新 URI 反查新 id 目录 → 补齐备份库 → 清理旧 id 目录 → 重扫修补全局状态库
import { existsSync, statSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { dirname, join, resolve } from "node:path"
import { copyFile, ensureDir, isDir, listDir, movePath } from "../platform"
import { readTextFile } from "../read-text"
import { writeFileAtomic } from "../write-atomic"
import { discardPath, readJsonField, rewriteTextFile } from "./artifacts"
import type { MigrationPlan } from "./plan"
import { buildPlan } from "./plan"
import { rewriteDbPaths } from "./sqlite"

// ---------- 类型定义 ----------

/** 改名入参 */
export interface RenameOptions {
  /** 旧路径 */
  oldPath: string
  /** 新路径 */
  newPath: string
  /** 限定宿主 id（缺省全部检出） */
  hosts?: string[]
  /** 备份目录（默认 <旧路径>/.opsbox/project-rename/<时间戳>） */
  backupDir?: string
  /** 跳过备份（危险：将无法回滚） */
  noBackup: boolean
  /** 仅输出计划，不落盘 */
  dryRun: boolean
  /** 跳过交互确认 */
  yes: boolean
  /** 执行第二趟 */
  resume: boolean
  /** 静默人类可读输出（json 模式下置真，仅保留 stderr 告警） */
  quiet?: boolean
}

/** 改名结果摘要：供 --format json 输出与调用方消费 */
export interface RenameResult {
  /** 旧路径 */
  oldPath: string
  /** 新路径 */
  newPath: string
  /** 命中的宿主标识 */
  hosts: string[]
  /** 待迁移载体数量 */
  artifactCount: number
  /** 是否仅演练（dry-run） */
  dryRun: boolean
  /** 第二趟迁移的工作区状态库数（第一趟恒为 0） */
  migrated: number
  /** 第二趟改写的全局状态库数（第一趟恒为 0） */
  patched: number
}

/** 第二趟续迁条目 */
interface ResumeEntry {
  /** 宿主标识 */
  host: string
  /** 旧工作区 id 目录名 */
  oldId: string
  /** 旧工作区 id 目录绝对路径 */
  oldDir: string
  /** 宿主 User 根 */
  workspaceRoot: string
  /** 备份库相对续迁清单目录的路径 */
  dbBackup: string
}

/** 第二趟续迁清单 */
interface ResumeManifest {
  /** 旧路径 */
  oldPath: string
  /** 新路径 */
  newPath: string
  /** 新 file URI */
  newUri: string
  /** 续迁条目 */
  entries: ResumeEntry[]
}

// ---------- 常量 ----------

/** 备份根相对项目根的路径 */
const BACKUP_REL = join(".opsbox", "project-rename")

/** 续迁清单文件名 */
const RESUME_FILE = "resume.json"

// ---------- 函数（按英文首字母排序） ----------

/**
 * 备份单文件到备份目录（noBackup 时不备份），返回其相对备份目录的路径。
 * @param file 源文件绝对路径
 * @param backupDir 备份目录
 * @param noBackup 是否跳过备份
 * @return 相对备份目录的路径（未备份时为空串）
 */
function backupInto(file: string, backupDir: string, noBackup: boolean): string {
  if (noBackup) return ""
  const rel = relOf(file)
  copyFile(file, join(backupDir, rel))
  return rel
}

/**
 * 交互式确认（非交互式终端下要求显式 --yes）。
 * @param question 提示语
 */
async function confirm(question: string): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("非交互式终端下请显式传入 --yes 以确认执行")
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`${question} [y/N] `)
    if (!/^y(es)?$/i.test(answer.trim())) throw new Error("用户取消操作")
  } finally {
    rl.close()
  }
}

/**
 * 在候选项目根下发现最新的续迁清单目录。
 * @param roots 候选项目根路径
 * @return 备份目录绝对路径
 */
function discoverResumeDir(roots: string[]): string {
  let best = ""
  let bestTime = -1
  for (const root of roots) {
    const base = join(resolve(root), BACKUP_REL)
    for (const entry of listDir(base)) {
      const file = join(base, entry, RESUME_FILE)
      if (!existsSync(file)) continue
      const time = statSync(file).mtimeMs
      if (time > bestTime) {
        bestTime = time
        best = join(base, entry)
      }
    }
  }
  if (!best) throw new Error("未找到可续迁的清单，请用 --backup-dir 指定第一趟的备份目录")
  return best
}

/**
 * 按新 URI 反查宿主为新路径生成的工作区 id 目录（排除旧 id，多命中时取最新）。
 * @param workspaceRoot 宿主 User 根
 * @param newUri 新 file URI
 * @param oldId 旧工作区 id 目录名
 * @return 新 id 目录名或 null
 */
function findNewId(workspaceRoot: string, newUri: string, oldId: string): string | null {
  const base = join(workspaceRoot, "workspaceStorage")
  let best: string | null = null
  let bestTime = -1
  for (const entry of listDir(base)) {
    if (entry === oldId) continue
    const workspace = join(base, entry, "workspace.json")
    if (readJsonField(workspace, "folder") !== newUri) continue
    const time = statSync(workspace).mtimeMs
    if (time > bestTime) {
      bestTime = time
      best = entry
    }
  }
  return best
}

/**
 * 第一趟：备份并改写文本载体、改名目录、丢弃缓存，最后改名项目目录并落续迁清单。
 * @param opts 改名入参
 */
async function firstPass(opts: RenameOptions): Promise<RenameResult> {
  const plan = buildPlan({ oldPath: opts.oldPath, newPath: opts.newPath, hosts: opts.hosts })
  preflight(plan)
  if (!opts.quiet) printPlan(plan, opts)
  if (opts.dryRun) {
    if (!opts.quiet) console.log("\nDryRun 结束，未做任何变更。")
    return summarize(plan, true, 0, 0)
  }
  if (!opts.yes) await confirm(`即将改名 ${plan.oldPath} → ${plan.newPath}，并迁移上述 ${plan.artifacts.length} 个载体，是否继续？`)

  const backupDir = opts.backupDir ?? join(plan.oldPath, BACKUP_REL, timestamp())
  if (!opts.noBackup) ensureDir(backupDir)

  const entries: ResumeEntry[] = []
  for (const artifact of plan.artifacts) {
    if (artifact.kind === "cache") {
      discardPath(artifact.path)
      continue
    }
    if (artifact.kind === "dir") {
      movePath(artifact.path, join(dirname(artifact.path), plan.newName))
      continue
    }
    if (artifact.kind === "text") {
      backupInto(artifact.path, backupDir, opts.noBackup)
      rewriteTextFile(artifact.path, plan.oldUri, plan.newUri)
      continue
    }
    // sqlite：备份后改写库内项目关联引用，失败仅告警不中断（实验性重关联，非关键路径）
    if (artifact.kind === "sqlite") {
      backupInto(artifact.path, backupDir, opts.noBackup)
      try {
        rewriteDbPaths(artifact.path, plan.oldPath, plan.newPath)
      } catch (error) {
        console.warn(`⚠️ 改写状态库失败，已跳过：${artifact.path}（${error instanceof Error ? error.message : String(error)}）`)
      }
      continue
    }
    // binary：工作区状态库须双趟迁移，其余二进制仅备份
    if (!artifact.twoPass) {
      backupInto(artifact.path, backupDir, opts.noBackup)
      continue
    }
    if (opts.noBackup) {
      console.warn(`⚠️ ${artifact.path} 为工作区状态库，--no-backup 下无法续迁，已跳过`)
      continue
    }
    entries.push({
      host: artifact.host,
      oldId: artifact.twoPass.oldId,
      oldDir: artifact.twoPass.oldDir,
      workspaceRoot: artifact.twoPass.workspaceRoot,
      dbBackup: backupInto(artifact.path, backupDir, false)
    })
  }

  if (entries.length > 0) {
    const manifest: ResumeManifest = { oldPath: plan.oldPath, newPath: plan.newPath, newUri: plan.newUri, entries }
    writeFileAtomic(join(backupDir, RESUME_FILE), JSON.stringify(manifest, null, 2))
  }

  movePath(plan.oldPath, plan.newPath)

  if (!opts.quiet) {
    console.log(`\n✔ 第一趟完成：目录已改名为 ${plan.newPath}`)
    if (entries.length > 0) {
      console.log(`  接下来请重开宿主并打开新路径 ${plan.newPath}，再关闭后执行：opsbox project-rename --resume`)
    }
  }
  return summarize(plan, false, 0, 0)
}

/**
 * 幂等修补：重扫全局状态库，改写其中残留的旧路径引用（宿主重开后可能回填旧值）。
 * @param oldPath 旧路径
 * @param newPath 新路径
 * @param hosts 限定宿主 id
 * @return 成功改写的状态库数量
 */
function patchSqlite(oldPath: string, newPath: string, hosts?: string[]): number {
  const plan = buildPlan({ oldPath, newPath, hosts })
  let patched = 0
  for (const artifact of plan.artifacts) {
    if (artifact.kind !== "sqlite") continue
    try {
      if (rewriteDbPaths(artifact.path, plan.oldPath, plan.newPath) > 0) patched += 1
    } catch (error) {
      console.warn(`⚠️ 改写状态库失败，已跳过：${artifact.path}（${error instanceof Error ? error.message : String(error)}）`)
    }
  }
  return patched
}

/**
 * 前置校验：旧路径须为已存在目录，新路径不得与旧路径相同或已存在。
 * @param plan 迁移计划
 */
function preflight(plan: MigrationPlan): void {
  if (!isDir(plan.oldPath)) throw new Error(`旧路径不存在或不是目录：${plan.oldPath}`)
  if (plan.oldPath === plan.newPath) throw new Error("新旧路径相同，无需改名")
  if (existsSync(plan.newPath)) throw new Error(`新路径已存在：${plan.newPath}`)
}

/**
 * 打印迁移计划。
 * @param plan 迁移计划
 * @param opts 改名入参
 */
function printPlan(plan: MigrationPlan, opts: RenameOptions): void {
  console.log(`旧路径：${plan.oldPath}`)
  console.log(`新路径：${plan.newPath}`)
  console.log(`命中宿主（${plan.hosts.length}）：${plan.hosts.map((host) => host.label).join(" / ") || "无"}`)
  if (plan.artifacts.length === 0) {
    console.log("未检出跟随目录名的关联状态。")
  } else {
    console.log(`待迁移载体（${plan.artifacts.length}）：`)
    for (const artifact of plan.artifacts) {
      console.log(`  - [${artifact.host}/${artifact.kind}] ${artifact.path}`)
      console.log(`    ${artifact.note}`)
    }
  }
  if (opts.noBackup) console.warn("⚠️ 已指定 --no-backup，将不生成任何备份")
}

/**
 * 把绝对路径转为跨平台的备份相对路径（去盘符、去前导分隔符）。
 * @param absPath 绝对路径
 * @return 相对路径
 */
function relOf(absPath: string): string {
  return absPath
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, "$1")
    .replace(/^\/+/, "")
}

/**
 * 目录改名并迁移各宿主中跟随目录名的关联状态。
 * @param opts 改名入参
 * @return 改名结果摘要
 * @example await renameProject({ oldPath: "D:/proj/old", newPath: "D:/proj/new", noBackup: false, dryRun: true, yes: true, resume: false })
 */
export async function renameProject(opts: RenameOptions): Promise<RenameResult> {
  if (opts.resume) return resumePass(opts)
  return firstPass(opts)
}

/**
 * 第二趟：按新 URI 反查新 id 目录，复制备份的工作区状态库并清理旧 id 目录。
 * @param opts 改名入参
 * @return 改名结果摘要
 */
async function resumePass(opts: RenameOptions): Promise<RenameResult> {
  const resumeDir = opts.backupDir ? resolve(opts.backupDir) : discoverResumeDir([opts.newPath, opts.oldPath, process.cwd()])
  const resumeFile = join(resumeDir, RESUME_FILE)
  if (!existsSync(resumeFile)) throw new Error(`未找到续迁清单：${resumeFile}`)
  const manifest = JSON.parse(readTextFile(resumeFile)) as ResumeManifest

  let migrated = 0
  for (const entry of manifest.entries) {
    const newId = findNewId(entry.workspaceRoot, manifest.newUri, entry.oldId)
    if (!newId) {
      console.warn(`⚠️ 未找到宿主为新路径生成的工作区目录，跳过：${entry.workspaceRoot}`)
      continue
    }
    const targetDb = join(entry.workspaceRoot, "workspaceStorage", newId, "state.vscdb")
    // 宿主已自行生成同 id 库时不覆盖，仅在其缺失时用备份补入
    if (!existsSync(targetDb)) copyFile(join(resumeDir, entry.dbBackup), targetDb)
    discardPath(entry.oldDir)
    migrated += 1
  }

  const patched = patchSqlite(manifest.oldPath, manifest.newPath, opts.hosts)

  if (!opts.quiet) {
    console.log(`\n✔ 第二趟完成：迁移 ${migrated} 个工作区状态库，已清理旧 id 目录`)
    if (patched > 0) console.log(`  另改写 ${patched} 处全局状态库项目关联引用`)
  }
  return {
    oldPath: manifest.oldPath,
    newPath: manifest.newPath,
    hosts: opts.hosts ?? [],
    artifactCount: manifest.entries.length,
    dryRun: false,
    migrated,
    patched
  }
}

/**
 * 由迁移计划汇总改名结果摘要。
 * @param plan 迁移计划
 * @param dryRun 是否仅演练
 * @param migrated 迁移的工作区状态库数
 * @param patched 改写的全局状态库数
 * @return 改名结果摘要
 */
function summarize(plan: MigrationPlan, dryRun: boolean, migrated: number, patched: number): RenameResult {
  return {
    oldPath: plan.oldPath,
    newPath: plan.newPath,
    hosts: plan.hosts.map((host) => host.id),
    artifactCount: plan.artifacts.length,
    dryRun,
    migrated,
    patched
  }
}

/**
 * 生成 yyyyMMdd-HHmmss 形式的时间戳。
 * @return 时间戳文本
 */
function timestamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, "0")
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}
