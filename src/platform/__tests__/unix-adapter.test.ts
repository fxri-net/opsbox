// unix 适配器单测：覆盖服务控制器择一、启停调用与权限复位（属主为空时不动）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DARWIN_DEFAULTS, LINUX_DEFAULTS, createUnixAdapter } from "../adapters/unix"

// 测试替身：spawnSync 按命令与参数编程返回
const h = vi.hoisted(() => ({ spawnSync: vi.fn() }))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawnSync: h.spawnSync }
})

/** 原始平台标识：用例结束后复位 */
const originalPlatform = process.platform

beforeEach(() => {
  // 钉死为 linux：hasCommand 用 which、hasProcess 用 pgrep，行为与宿主无关
  Object.defineProperty(process, "platform", { value: "linux", configurable: true })
  h.spawnSync.mockReset()
})

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
})

/** 按「命令 + 首个参数」编程返回 */
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

describe("createUnixAdapter", () => {
  it("默认参数原样透出", () => {
    expect(createUnixAdapter("linux", "Linux", LINUX_DEFAULTS).defaults).toBe(LINUX_DEFAULTS)
    expect(createUnixAdapter("darwin", "macOS", DARWIN_DEFAULTS).defaults).toBe(DARWIN_DEFAULTS)
  })

  it("stopService 经 systemctl 停服并等待进程退出", async () => {
    // which systemctl 命中；pgrep 判 mysqld 已退出
    program((cmd, args) => (cmd === "which" ? { status: args[0] === "systemctl" ? 0 : 1 } : cmd === "pgrep" ? { status: 1 } : { status: 0 }))
    await createUnixAdapter("linux", "Linux", LINUX_DEFAULTS).stopService("mysql")
    expect(calledWith("systemctl", ["stop", "mysql"])).toBe(true)
  })

  it("stopService 在无 systemctl 时回退 brew", async () => {
    program((cmd, args) =>
      cmd === "which" ? { status: args[0] === "brew" ? 0 : 1 } : cmd === "pgrep" ? { status: 1 } : { status: 0 }
    )
    await createUnixAdapter("darwin", "macOS", DARWIN_DEFAULTS).stopService("mysql")
    expect(calledWith("brew", ["services", "stop", "mysql"])).toBe(true)
  })

  it("stopService 在无 systemctl / brew 时回退 mysql.server", async () => {
    program((cmd, args) =>
      cmd === "which" ? { status: args[0] === "mysql.server" ? 0 : 1 } : cmd === "pgrep" ? { status: 1 } : { status: 0 }
    )
    await createUnixAdapter("darwin", "macOS", DARWIN_DEFAULTS).stopService("mysql")
    expect(calledWith("mysql.server", ["stop"])).toBe(true)
  })

  it("无任何可用控制器时抛错", async () => {
    program((cmd) => (cmd === "which" ? { status: 1 } : { status: 0 }))
    await expect(createUnixAdapter("linux", "Linux", LINUX_DEFAULTS).stopService("mysql")).rejects.toThrow("未找到可用的 MySQL 服务控制器")
  })

  it("startService 经选中控制器启动", async () => {
    program((cmd, args) => (cmd === "which" ? { status: args[0] === "systemctl" ? 0 : 1 } : { status: 0 }))
    await createUnixAdapter("linux", "Linux", LINUX_DEFAULTS).startService("mysql")
    expect(calledWith("systemctl", ["start", "mysql"])).toBe(true)
  })

  it("resetPermissions 在属主非空时执行 chown", async () => {
    program(() => ({ status: 0 }))
    await createUnixAdapter("linux", "Linux", LINUX_DEFAULTS).resetPermissions("/www/server/data")
    expect(calledWith("chown", ["-R", "mysql:mysql", "/www/server/data"])).toBe(true)
  })

  it("resetPermissions 在属主为空时不动权限", async () => {
    program(() => ({ status: 0 }))
    await createUnixAdapter("darwin", "macOS", DARWIN_DEFAULTS).resetPermissions("/usr/local/var/mysql")
    expect(h.spawnSync).not.toHaveBeenCalled()
  })
})
