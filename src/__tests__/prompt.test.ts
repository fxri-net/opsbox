// 交互式口令输入单测：以假 stdin / stdout 驱动 data 事件，覆盖非 TTY 拒绝与回车、Ctrl-C、退格各分支
import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { promptPassword } from "../prompt"

/** 假标准输入：EventEmitter + 终端能力桩，供用例手动 emit("data") */
class FakeStdin extends EventEmitter {
  /** 是否交互终端 */
  isTTY = true
  /** 切换原始终端模式 */
  setRawMode = vi.fn()
  /** 恢复读取 */
  resume = vi.fn()
  /** 暂停读取 */
  pause = vi.fn()
}

/** 原始 stdin / stdout 描述符：用例结束后复位 */
const originalStdin = Object.getOwnPropertyDescriptor(process, "stdin")
const originalStdout = Object.getOwnPropertyDescriptor(process, "stdout")

/** 当前用例的假输入与假输出 */
let stdin: FakeStdin
let writeSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  stdin = new FakeStdin()
  writeSpy = vi.fn()
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true })
  Object.defineProperty(process, "stdout", { value: { write: writeSpy }, configurable: true })
})

afterEach(() => {
  if (originalStdin) Object.defineProperty(process, "stdin", originalStdin)
  if (originalStdout) Object.defineProperty(process, "stdout", originalStdout)
})

describe("promptPassword", () => {
  it("非交互终端直接拒绝", async () => {
    stdin.isTTY = false
    await expect(promptPassword("口令：")).rejects.toThrow("当前环境非交互终端")
  })

  it("回车提交并回显提示与换行、复位终端", async () => {
    const pending = promptPassword("口令：")
    stdin.emit("data", Buffer.from("secret", "utf8"))
    stdin.emit("data", Buffer.from("\n", "utf8"))
    await expect(pending).resolves.toBe("secret")
    expect(writeSpy).toHaveBeenCalledWith("口令：")
    expect(writeSpy).toHaveBeenCalledWith("\n")
    expect(stdin.setRawMode).toHaveBeenNthCalledWith(1, true)
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false)
    expect(stdin.pause).toHaveBeenCalled()
  })

  it("回车符与 EOF 同样提交", async () => {
    const a = promptPassword("x")
    stdin.emit("data", Buffer.from("a", "utf8"))
    stdin.emit("data", Buffer.from("\r", "utf8"))
    await expect(a).resolves.toBe("a")

    const b = promptPassword("x")
    stdin.emit("data", Buffer.from("b", "utf8"))
    stdin.emit("data", Buffer.from("\u0004", "utf8"))
    await expect(b).resolves.toBe("b")
  })

  it("Ctrl-C 以错误终止", async () => {
    const pending = promptPassword("x")
    stdin.emit("data", Buffer.from("ab", "utf8"))
    stdin.emit("data", Buffer.from("\u0003", "utf8"))
    await expect(pending).rejects.toThrow("已取消输入")
  })

  it("退格删除末字符", async () => {
    const pending = promptPassword("x")
    stdin.emit("data", Buffer.from("ab", "utf8"))
    stdin.emit("data", Buffer.from("\u007f", "utf8"))
    stdin.emit("data", Buffer.from("\b", "utf8"))
    stdin.emit("data", Buffer.from("c", "utf8"))
    stdin.emit("data", Buffer.from("\n", "utf8"))
    await expect(pending).resolves.toBe("c")
  })
})
