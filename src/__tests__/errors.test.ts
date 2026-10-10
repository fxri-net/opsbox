// CLI 解析错误中文化单测：覆盖各收录 code 与未收录回退，避免文案改动后静默漂移
import { describe, expect, it } from "vitest"
import { CommanderError } from "commander"
import { formatCommanderError } from "../errors"

/** 构造 commander 解析错误 */
function err(code: string, message: string): CommanderError {
  return new CommanderError(1, code, message)
}

describe("formatCommanderError", () => {
  it("未知命令（带相似项）转中文并附候选", () => {
    const result = formatCommanderError(err("commander.unknownCommand", "error: unknown command 'foo'\n(Did you mean tasks?)"))
    expect(result).toBe("⚠️ 未知命令「foo」。（是否想输入 tasks？）\n运行 opsbox --help 查看可用命令")
  })

  it("未知命令（多候选相似项）转中文并附候选集合", () => {
    const result = formatCommanderError(err("commander.unknownCommand", "error: unknown command 'foo'\n(Did you mean one of restore, ddl?)"))
    expect(result).toBe("⚠️ 未知命令「foo」。（是否想输入 restore、ddl 之一？）\n运行 opsbox --help 查看可用命令")
  })

  it("未知命令（无相似项）转中文", () => {
    const result = formatCommanderError(err("commander.unknownCommand", "error: unknown command 'foo'"))
    expect(result).toBe("⚠️ 未知命令「foo」。\n运行 opsbox --help 查看可用命令")
  })

  it("未知选项转中文", () => {
    const result = formatCommanderError(err("commander.unknownOption", "error: unknown option '--nope'"))
    expect(result).toBe("⚠️ 未知选项「--nope」。\n运行 opsbox --help 查看可用命令")
  })

  it("多余参数（带子命令名）转中文", () => {
    const result = formatCommanderError(err("commander.excessArguments", "error: too many arguments for 'restore'. Expected 0 arguments but got 1."))
    expect(result).toBe("⚠️ 命令「restore」期望 0 个参数，实际收到 1 个。\n运行 opsbox --help 查看可用命令")
  })

  it("多余参数（无子命令名）转中文", () => {
    const result = formatCommanderError(err("commander.excessArguments", "error: too many arguments. Expected 1 argument but got 3."))
    expect(result).toBe("⚠️ 命令期望 1 个参数，实际收到 3 个。\n运行 opsbox --help 查看可用命令")
  })

  it("取不到动态值时不翻译（回退原文案）", () => {
    expect(formatCommanderError(err("commander.unknownCommand", "error: unknown command"))).toBeNull()
  })

  it("未收录 code 返回 null（由调用方回退 commander 原文）", () => {
    expect(formatCommanderError(err("commander.helpDisplayed", ""))).toBeNull()
  })
})
