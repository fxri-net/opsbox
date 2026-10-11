// 外部命令执行封装单测：以 mock 的 spawnSync 与可切换的 process.platform 覆盖读退出码、探测与轮询各分支
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { hasCommand, hasProcess, run, runOrThrow, sleep, waitProcessExit } from "../exec"

// 测试替身：spawnSync 交由每个用例编程返回，避免真正派生进程
const h = vi.hoisted(() => ({ spawnSync: vi.fn() }))

// 只替换 spawnSync，其余子进程 API 保持真实
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawnSync: h.spawnSync }
})

/** 原始平台标识：用例结束后复位 */
const originalPlatform = process.platform

/** 覆写运行期平台，用于确定性地走 win32 / unix 两套分支 */
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
}

/** 按命令编程 spawnSync 的返回（stdout / stderr 缺省为空串） */
function program(fn: (cmd: string, args: string[]) => { status: number | null; stdout?: string; stderr?: string }): void {
  h.spawnSync.mockImplementation((cmd: string, args: string[]) => {
    const r = fn(cmd, args)
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
  })
}

beforeEach(() => {
  h.spawnSync.mockReset()
})

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
  vi.useRealTimers()
})

describe("sleep", () => {
  it("到时后 resolve", async () => {
    await expect(sleep(1)).resolves.toBeUndefined()
  })
})

describe("run", () => {
  it("透传退出码与输出", () => {
    h.spawnSync.mockReturnValue({ status: 2, stdout: "out", stderr: "err" })
    expect(run("cmd", ["a"], { cwd: "/tmp" })).toEqual({ code: 2, stdout: "out", stderr: "err" })
    expect(h.spawnSync).toHaveBeenCalledWith("cmd", ["a"], expect.objectContaining({ cwd: "/tmp", encoding: "utf8" }))
  })

  it("退出码与输出缺失时兜底为 1 与空串", () => {
    h.spawnSync.mockReturnValue({ status: null, stdout: null, stderr: null })
    expect(run("cmd", [])).toEqual({ code: 1, stdout: "", stderr: "" })
  })
})

describe("runOrThrow", () => {
  it("退出码为 0 时返回结果", () => {
    h.spawnSync.mockReturnValue({ status: 0, stdout: "ok", stderr: "" })
    expect(runOrThrow("cmd", ["a"])).toEqual({ code: 0, stdout: "ok", stderr: "" })
  })

  it("非 0 退出码抛错并取 stderr 作为明细", () => {
    h.spawnSync.mockReturnValue({ status: 1, stdout: "out", stderr: "boom" })
    expect(() => runOrThrow("cmd", ["a", "b"])).toThrow("命令执行失败（cmd a b，退出码 1）：boom")
  })

  it("stderr 为空时明细回退 stdout", () => {
    h.spawnSync.mockReturnValue({ status: 3, stdout: "fallback", stderr: "" })
    expect(() => runOrThrow("cmd", [])).toThrow("命令执行失败（cmd ，退出码 3）：fallback")
  })
})

describe("hasCommand", () => {
  it("unix 用 which 判定", () => {
    setPlatform("linux")
    program(() => ({ status: 0 }))
    expect(hasCommand("git")).toBe(true)
    expect(h.spawnSync).toHaveBeenCalledWith("which", ["git"], expect.anything())
  })

  it("unix 探测失败返回 false", () => {
    setPlatform("linux")
    program(() => ({ status: 1 }))
    expect(hasCommand("git")).toBe(false)
  })

  it("win32 用 where 判定", () => {
    setPlatform("win32")
    program(() => ({ status: 0 }))
    expect(hasCommand("git")).toBe(true)
    expect(h.spawnSync).toHaveBeenCalledWith("where", ["git"], expect.anything())
  })
})

describe("hasProcess", () => {
  it("unix 用 pgrep 退出码判定", () => {
    setPlatform("linux")
    program(() => ({ status: 0 }))
    expect(hasProcess("mysqld")).toBe(true)
    expect(h.spawnSync).toHaveBeenCalledWith("pgrep", ["-x", "mysqld"], expect.anything())
  })

  it("win32 用 tasklist 输出判定命中", () => {
    setPlatform("win32")
    program(() => ({ status: 0, stdout: "映像名称: mysqld.exe" }))
    expect(hasProcess("mysqld")).toBe(true)
    expect(h.spawnSync).toHaveBeenCalledWith("tasklist", ["/FI", "IMAGENAME eq mysqld.exe", "/NH"], expect.anything())
  })

  it("win32 无命中返回 false", () => {
    setPlatform("win32")
    program(() => ({ status: 0, stdout: "信息: 没有运行的任务" }))
    expect(hasProcess("mysqld")).toBe(false)
  })
})

describe("waitProcessExit", () => {
  it("进程已退出时立即返回", async () => {
    setPlatform("linux")
    program(() => ({ status: 1 }))
    await expect(waitProcessExit("mysqld", 1000)).resolves.toBeUndefined()
  })

  it("超时未退出抛错", async () => {
    setPlatform("linux")
    program(() => ({ status: 0 }))
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    // 先挂上断言再推进计时器，避免 rejection 在断言挂载前被判定为未处理
    const assertion = expect(waitProcessExit("mysqld", 2000)).rejects.toThrow("进程 mysqld 在 2 秒内未退出")
    await vi.advanceTimersByTimeAsync(3000)
    await assertion
  })
})
