#!/usr/bin/env node

// opsbox CLI 入口：单一可执行入口 + 多能力自注册，仅负责装配命令树与统一错误收口
import { Command, CommanderError } from "commander"
import { createRequire } from "node:module"
import { existsSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { registerMysqlRecover } from "./mysql-recover"
import { registerProjectRename } from "./project-rename"
import { setupHelp } from "./help"
import { formatCommanderError } from "./errors"
import { DESCRIPTION } from "./about"
import { configStatus, foldHome, foldHomeInText, type ConfigStatusReport } from "./config-status"
import { printJson, assertJsonFormat } from "./json-output"
import { startUpdateCheck, runUpdateCheckWorker, UPDATE_CHECK_WORKER_ARG } from "./update-check"
import type { LocalConfigIgnoreState } from "./git-ignore"

const require = createRequire(import.meta.url)
// 版本号从 package.json 读取，避免与 package.json 重复维护
const { version } = require("../package.json")

// Windows 控制台 UTF-8 输出（best-effort：避免中文在 GBK 控制台下乱码）
function ensureUtf8(): void {
  if (process.platform === "win32") {
    try {
      process.stdout.setDefaultEncoding("utf8")
      process.stderr.setDefaultEncoding("utf8")
    } catch {
      // 流编码设置失败忽略，不影响主流程
    }
  }
}

// commander 解析失败时会自行把英文错误写到 stderr 后才抛异常，此处先缓存：
// 命中中文映射时丢弃原文案改由 main 统一输出，未命中（帮助/版本/未收录 code）则原样放行
let commanderErrBuffer = ""

const program = new Command()
program
  .name("opsbox")
  .description(DESCRIPTION)
  .version(version, "-v, --version", "显示版本号")
  .enablePositionalOptions(true)
  // 交回解析错误的控制权（否则 commander 自行 process.exit，异常捕不到）
  // ⚠️ 须在声明任何子命令之前调用：_exitCallback 只在 .command() 建子命令时按引用复制，之后再设不回溯
  .exitOverride()
  .configureOutput({
    writeErr: (str) => {
      commanderErrBuffer += str
    }
  })

// 逐能力自注册：新增能力只需在此追加一行，命令树与帮助随之生成
registerMysqlRecover(program)
registerProjectRename(program)

// 本地配置文件忽略状态的文本态文案（键集合与 src/git-ignore.ts 的 LocalConfigIgnoreState 对齐）
const CONFIG_IGNORE_LABEL: Record<LocalConfigIgnoreState, string> = {
  ignored: "已忽略",
  tracked: "已跟踪（需 git rm --cached）",
  "not-ignored": "未忽略",
  "not-a-repo": "不适用（非 git 仓库）",
  "outside-repo": "不适用（位于仓库工作树之外）",
  unavailable: "忽略判定不可用"
}

// 打印配置分层报告：先给一句话结论，再列三层现场 / 展示键来源 / 环境变量层 / 能力旁路 / 其余已配置段 / 待处理项
// 一律不打印配置值（各段含本机路径，落到终端 / CI 日志即外泄）
// 路径一律走 foldHome / foldHomeInText 折叠为 ~（层级路径与待处理项文案内嵌的路径同等处理），避免共享日志泄露本机目录结构
function printConfigStatus(report: ConfigStatusReport): void {
  console.log(report.summary)
  console.log(`查找起点：${foldHome(report.cwd)}`)
  console.log("")
  console.log("层级：")
  for (const level of report.levels) {
    const file = level.file === null ? "无" : foldHome(level.file)
    const ignore = level.ignored === null ? "" : `，${CONFIG_IGNORE_LABEL[level.ignored.state]}`
    console.log(`  ${level.layer}：${file}${ignore}`)
  }
  console.log("")
  console.log("展示键来源：")
  for (const item of report.displayKeys) console.log(`  ${item.key}：${item.source ?? "默认值"}`)
  console.log("")
  const pairs = (hits: Array<{ env: string; key: string }>) => (hits.length > 0 ? hits.map((h) => `${h.env} → ${h.key}`).join("、") : "无")
  console.log(`环境变量层：${pairs(report.env)}`)
  console.log(`能力旁路：${pairs(report.bypass)}`)
  console.log("")
  const groups = report.levels.filter((level) => level.otherSections.length > 0)
  if (groups.length === 0) {
    console.log("其余已配置段：无")
  } else {
    console.log("其余已配置段：")
    for (const level of groups) console.log(`  ${level.layer}：${level.otherSections.join("、")}`)
  }
  console.log("")
  if (report.items.length === 0) {
    console.log("无待处理项")
    return
  }
  for (const item of report.items) console.log(`${item.level === "warn" ? "⚠️" : "·"} [${item.scope}] ${foldHomeInText(item.message)}`)
}

// config 域：三层配置文件的只读体检（层级 / 来源 / 忽略状态）
const configCmd = program
  .command("config")
  .description("配置分层：只读查看三层配置文件（全局层 / 项目层 / 本地层）的生效情况与来源")

// 状态：只读体检，只报不改（不给 --fix）；体检本身不阻断、退出码恒 0，仅 --format 非法与 --cwd 非法时按参数错误报错退出
configCmd
  .command("status")
  .description("配置分层只读体检：三层命中 / 来源层 / 环境变量层（只读、退出码恒 0；可用 --cwd 指定查找起点）")
  .option("--cwd <path>", "向上查找的起始目录（缺省当前工作目录）")
  .option("--format <format>", "输出格式（json，输出到 stdout）")
  .action((options: { cwd?: string; format?: string }) => {
    try {
      if (!assertJsonFormat(options.format)) return
      const cwd = options.cwd === undefined ? process.cwd() : resolve(options.cwd)
      // 降级不静默：--cwd 非法时不回落 process.cwd()（回落会给出起点错误的报告，比报错更危险）
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
        console.error(`⚠️ --cwd 指向的路径不存在或非目录：${options.cwd}`)
        process.exitCode = 1
        return
      }
      const report = configStatus(cwd)
      if (options.format === "json") printJson(report)
      else printConfigStatus(report)
    } catch (e) {
      // 体检失败不置退出码：「只读体检不阻断」是本命令的设计意图
      console.error(`⚠️ 读取状态失败：${(e as Error).message}`)
    }
  })

// 裸 `opsbox config`：打印本域帮助，列出 1 个子命令
configCmd.action(() => {
  configCmd.help()
})

// 帮助口径统一：命令声明完毕后递归换中文帮助文案并对齐父级清单
// ⚠️ 顺序：须先 setupHelp 再 helpCommand——help 子命令自带 helpOption(false)，反过来会把它的 Usage 撑成 [options] [command]
setupHelp(program)
program.helpCommand("help [command]", "显示帮助")

ensureUtf8()

// main 包装：兼容 CJS 产物（顶层 await 仅 ESM 支持）；主命令完成后同步读缓存提示升级（零网络、不影响退出码）
async function main(): Promise<void> {
  // 内部升级检查 worker：仅联网刷新缓存后退出，不执行用户命令（参数由 startUpdateCheck 派生时注入）
  if (process.argv[2] === UPDATE_CHECK_WORKER_ARG) {
    await runUpdateCheckWorker()
    return
  }
  try {
    await program.parseAsync(process.argv)
  } catch (err) {
    // exitOverride 后 commander 把「解析失败」与「已输出帮助/版本」统一改为抛异常，均经此收口
    if (!(err instanceof CommanderError)) throw err
    const zh = formatCommanderError(err)
    // 命中映射：丢弃 commander 英文原文，改输出中文提示；未命中（帮助/版本等）：原样放行
    if (zh) console.error(zh)
    else process.stderr.write(commanderErrBuffer)
    process.exitCode = err.exitCode
  } finally {
    // 所有路径（成功 / 帮助 / 版本 / 解析失败）一致触发升级检查；命中缓存仅读盘提示，零网络
    startUpdateCheck(version)
  }
}

// 执行语义不变，仅导出 Promise 供测试 await 主流程
export const cliReady = main()
