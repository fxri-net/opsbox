// Windows 适配器单测：覆盖服务启停（sc 失败回退 net）、权限复位，以及从服务注册信息与 my.ini 推导默认路径
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createWindowsAdapter, deriveWindowsDefaults } from "../adapters/windows"

// 测试替身：子进程与文件读取交由用例编程，避免真实派生进程与依赖本机路径
const h = vi.hoisted(() => ({ spawnSync: vi.fn(), existsSync: vi.fn(), readFileSync: vi.fn() }))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawnSync: h.spawnSync }
})

// 路径统一按 win32 语义解析：Windows 路径断言在任意宿主上确定（dirname / join / parse 均取 win32 实现）
vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>()
  return { ...actual, dirname: actual.win32.dirname, join: actual.win32.join, parse: actual.win32.parse }
})

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, existsSync: h.existsSync, readFileSync: h.readFileSync }
})

/** 原始平台标识：用例结束后复位 */
const originalPlatform = process.platform

beforeEach(() => {
  // 钉死为 win32：hasProcess 走 tasklist 分支，行为与宿主无关
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })
  h.spawnSync.mockReset()
  h.existsSync.mockReset()
  h.readFileSync.mockReset()
})

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
})

/** 按命令编程 spawnSync 的返回（stdout / stderr 缺省为空串） */
function program(fn: (cmd: string, args: string[]) => { status: number; stdout?: string; stderr?: string }): void {
  h.spawnSync.mockImplementation((cmd: string, args: string[]) => {
    const r = fn(cmd, args)
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
  })
}

/** 记录是否调用过某命令 */
function calledWith(cmd: string, args: string[]): boolean {
  return h.spawnSync.mock.calls.some((c) => c[0] === cmd && JSON.stringify(c[1]) === JSON.stringify(args))
}

describe("createWindowsAdapter", () => {
  it("sc stop 成功时不再回退 net 并等待进程退出", async () => {
    // sc 一律成功；tasklist 无命中，等待进程立即返回
    program((cmd) => ({ status: 0, stdout: cmd === "tasklist" ? "信息: 没有运行的任务" : "" }))
    await createWindowsAdapter().stopService("mysql")
    expect(calledWith("sc", ["stop", "mysql"])).toBe(true)
    expect(calledWith("net", ["stop", "mysql"])).toBe(false)
  })

  it("sc stop 失败时回退 net stop", async () => {
    program((cmd) => (cmd === "sc" ? { status: 1, stderr: "服务名无效" } : { status: 0, stdout: "" }))
    await createWindowsAdapter().stopService("mysql")
    expect(calledWith("net", ["stop", "mysql"])).toBe(true)
  })

  it("sc start 失败时回退 net start", async () => {
    program((cmd) => (cmd === "sc" ? { status: 1, stderr: "服务名无效" } : { status: 0, stdout: "" }))
    await createWindowsAdapter().startService("mysql")
    expect(calledWith("net", ["start", "mysql"])).toBe(true)
  })

  it("resetPermissions 经 icacls 递归复位", async () => {
    program(() => ({ status: 0 }))
    await createWindowsAdapter().resetPermissions("C:\\data\\mysql")
    expect(calledWith("icacls", ["C:\\data\\mysql", "/reset", "/T", "/C", "/Q"])).toBe(true)
  })
})

describe("deriveWindowsDefaults", () => {
  it("由服务注册信息与 my.ini 推导默认目录", () => {
    const binaryPath = '        BINARY_PATH_NAME   : "C:\\mysql\\bin\\mysqld.exe" --defaults-file="C:\\mysql\\my.ini"'
    h.spawnSync.mockImplementation((cmd: string) => (cmd === "sc" ? { status: 0, stdout: binaryPath, stderr: "" } : { status: 0, stdout: "", stderr: "" }))
    h.existsSync.mockReturnValue(true)
    h.readFileSync.mockReturnValue("[mysqld]\ndatadir=C:\\data\\mysql\n")
    expect(deriveWindowsDefaults()).toEqual({
      dataDir: "C:\\data\\mysql",
      binDir: "C:\\mysql\\bin",
      serviceName: "mysql",
      backupDir: "C:\\opsbox-backup\\data",
      stagingDir: "C:\\mysql\\orphan-staging",
      dataOwner: ""
    })
  })

  it("路径未加引号时按裸路径解析", () => {
    const binaryPath = "        BINARY_PATH_NAME   : C:\\mysql\\bin\\mysqld.exe --defaults-file=C:\\mysql\\my.ini"
    h.spawnSync.mockImplementation((cmd: string) => (cmd === "sc" ? { status: 0, stdout: binaryPath, stderr: "" } : { status: 0, stdout: "", stderr: "" }))
    h.existsSync.mockReturnValue(true)
    h.readFileSync.mockReturnValue("[mysqld]\ndatadir=\"C:\\data\\mysql\"\n")
    expect(deriveWindowsDefaults().dataDir).toBe("C:\\data\\mysql")
  })

  it("服务未注册时各目录为空串", () => {
    program(() => ({ status: 1, stderr: "服务名无效" }))
    h.existsSync.mockReturnValue(false)
    expect(deriveWindowsDefaults()).toEqual({
      dataDir: "",
      binDir: "",
      serviceName: "mysql",
      backupDir: "",
      stagingDir: "",
      dataOwner: ""
    })
  })

  it("注册信息无 BINARY_PATH_NAME 时各目录为空串", () => {
    program((cmd) => ({ status: 0, stdout: cmd === "sc" ? "SERVICE_NAME: mysql\n        TYPE               : 10" : "" }))
    h.existsSync.mockReturnValue(false)
    expect(deriveWindowsDefaults().binDir).toBe("")
  })

  it("二进制无 --defaults-file 时数据目录为空", () => {
    const binaryPath = '        BINARY_PATH_NAME   : "C:\\mysql\\bin\\mysqld.exe"'
    h.spawnSync.mockImplementation((cmd: string) => (cmd === "sc" ? { status: 0, stdout: binaryPath, stderr: "" } : { status: 0, stdout: "", stderr: "" }))
    h.existsSync.mockReturnValue(false)
    const d = deriveWindowsDefaults()
    expect(d.dataDir).toBe("")
    expect(d.binDir).toBe("C:\\mysql\\bin")
  })

  it("my.ini 缺失时数据目录为空", () => {
    const binaryPath = '        BINARY_PATH_NAME   : "C:\\mysql\\bin\\mysqld.exe" --defaults-file="C:\\mysql\\my.ini"'
    h.spawnSync.mockImplementation((cmd: string) => (cmd === "sc" ? { status: 0, stdout: binaryPath, stderr: "" } : { status: 0, stdout: "", stderr: "" }))
    h.existsSync.mockReturnValue(false)
    expect(deriveWindowsDefaults().dataDir).toBe("")
  })

  it("my.ini 跳过注释与空行并忽略无 datadir 的情形", () => {
    const binaryPath = '        BINARY_PATH_NAME   : "C:\\mysql\\bin\\mysqld.exe" --defaults-file="C:\\mysql\\my.ini"'
    h.spawnSync.mockImplementation((cmd: string) => (cmd === "sc" ? { status: 0, stdout: binaryPath, stderr: "" } : { status: 0, stdout: "", stderr: "" }))
    h.existsSync.mockReturnValue(true)
    h.readFileSync.mockReturnValue("# 注释\n\n; 分号注释\nport=3306\n  datadir = C:\\data\\mysql  \n")
    expect(deriveWindowsDefaults().dataDir).toBe("C:\\data\\mysql")
  })
})
