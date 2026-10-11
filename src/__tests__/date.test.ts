// 本地时间函数单测：以 fake timers 钉死系统时间，断言与运行时时区无关
import { afterEach, describe, expect, it, vi } from "vitest"
import { folderStamp, localDateTime } from "../date"

afterEach(() => {
  vi.useRealTimers()
})

describe("folderStamp", () => {
  it("按本地分量生成 yyyyMMdd-HHmmss", () => {
    vi.useFakeTimers()
    // 传本地分量构造，getFullYear 等仍按本地取值，故期望字符串与 TZ 无关
    vi.setSystemTime(new Date(2026, 0, 2, 3, 4, 5))
    expect(folderStamp()).toBe("20260102-030405")
  })
})

describe("localDateTime", () => {
  it("按本地分量生成 YYYY-MM-DD HH:mm:ss", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 2, 3, 4, 5))
    expect(localDateTime()).toBe("2026-01-02 03:04:05")
  })
})
