// 版本查询与比较单测：纯比较逻辑全覆盖 + 网络异常静默兜底
import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchLatestVersion, versionGt } from "../version"

afterEach(() => vi.unstubAllGlobals())

describe("versionGt", () => {
  it("高位段大者胜出", () => {
    expect(versionGt("1.2.0", "1.1.9")).toBe(true)
    expect(versionGt("2.0.0", "10.0.0")).toBe(false)
  })

  it("相等或更低返回 false", () => {
    expect(versionGt("1.0.0", "1.0.0")).toBe(false)
    expect(versionGt("0.9.0", "1.0.0")).toBe(false)
  })

  it("段数不等时缺失段按 0 补齐", () => {
    expect(versionGt("1.1", "1.0.9")).toBe(true)
    expect(versionGt("1.0", "1.0.0")).toBe(false)
  })

  it("忽略 prerelease 后缀", () => {
    expect(versionGt("1.0.1-beta.1", "1.0.0")).toBe(true)
    expect(versionGt("1.0.0-rc.1", "1.0.0")).toBe(false)
  })
})

describe("fetchLatestVersion", () => {
  it("成功返回 version 字段", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ version: "9.9.9" }) })))
    await expect(fetchLatestVersion()).resolves.toBe("9.9.9")
  })

  it("响应非 ok 返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    await expect(fetchLatestVersion()).resolves.toBeNull()
  })

  it("version 缺失返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    await expect(fetchLatestVersion()).resolves.toBeNull()
  })

  it("网络异常静默返回 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline")
      }),
    )
    await expect(fetchLatestVersion()).resolves.toBeNull()
  })
})
