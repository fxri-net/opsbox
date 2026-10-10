#!/usr/bin/env node

// opsbox CLI 入口：单一可执行入口 + 多能力自注册，仅负责装配命令树与统一错误收口
import { Command, CommanderError } from "commander"
import { createRequire } from "node:module"
import { registerMysqlRecover } from "./mysql-recover"
import { setupHelp } from "./help"
import { formatCommanderError } from "./errors"
import { DESCRIPTION } from "./about"

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

// 帮助口径统一：命令声明完毕后递归换中文帮助文案并对齐父级清单
// ⚠️ 顺序：须先 setupHelp 再 helpCommand——help 子命令自带 helpOption(false)，反过来会把它的 Usage 撑成 [options] [command]
setupHelp(program)
program.helpCommand("help [command]", "显示帮助")

ensureUtf8()

// main 包装：兼容 CJS 产物（顶层 await 仅 ESM 支持）
async function main(): Promise<void> {
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
  }
}

// 执行语义不变，仅导出 Promise 供测试 await 主流程
export const cliReady = main()
