// 平台探测单测：以可切换的 process.platform 覆盖平台识别与适配器解析（含未知平台报错）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { currentPlatformId, resolveAdapter } from "../detect"
import { DARWIN_DEFAULTS, LINUX_DEFAULTS } from "../adapters/unix"

// 测试替身：win32 适配器构造时会查询服务注册信息，mock 掉子进程避免真实派生
const h = vi.hoisted(() => ({ spawnSync: vi.fn() }))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawnSync: h.spawnSync }
})

/** 原始平台标识：用例结束后复位 */
const originalPlatform = process.platform

/** 覆写运行期平台 */
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
}

beforeEach(() => {
  // 服务未注册（sc qc 失败）：Windows 默认参数推导为空，构造适配器不发散真实命令
  h.spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "" })
})

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
})

describe("currentPlatformId", () => {
  it("映射三大平台标识", () => {
    setPlatform("linux")
    expect(currentPlatformId()).toBe("linux")
    setPlatform("darwin")
    expect(currentPlatformId()).toBe("darwin")
    setPlatform("win32")
    expect(currentPlatformId()).toBe("win32")
  })

  it("未知平台归为 unknown", () => {
    setPlatform("freebsd")
    expect(currentPlatformId()).toBe("unknown")
  })
})

describe("resolveAdapter", () => {
  it("linux 返回 unix 适配器与 Linux 默认参数", () => {
    const adapter = resolveAdapter("linux")
    expect(adapter.id).toBe("linux")
    expect(adapter.label).toBe("Linux")
    expect(adapter.defaults).toBe(LINUX_DEFAULTS)
  })

  it("darwin 返回 unix 适配器与 macOS 默认参数", () => {
    const adapter = resolveAdapter("darwin")
    expect(adapter.id).toBe("darwin")
    expect(adapter.label).toBe("macOS")
    expect(adapter.defaults).toBe(DARWIN_DEFAULTS)
  })

  it("win32 返回 Windows 适配器", () => {
    const adapter = resolveAdapter("win32")
    expect(adapter.id).toBe("win32")
    expect(adapter.label).toBe("Windows")
  })

  it("缺省参数时取当前平台", () => {
    setPlatform("linux")
    expect(resolveAdapter().id).toBe("linux")
  })

  it("未知平台显式报错", () => {
    setPlatform("freebsd")
    expect(() => resolveAdapter("unknown")).toThrow("暂不支持的运行平台")
  })
})
