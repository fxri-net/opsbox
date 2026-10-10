// 升级检查单测：隔离 tmp 缓存目录与子进程派生，覆盖开关、提示、后台刷新与缓存写入
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { runUpdateCheckWorker, startUpdateCheck } from "../update-check"

// 测试替身：tmp 指向每个用例独立的临时目录，spawn 记录派生调用而不真正起进程
const h = vi.hoisted(() => ({
  tmp: "" as string,
  spawn: vi.fn(() => ({ unref: () => {} })),
}))

// 只覆盖 tmpdir：config 域仍需要真实的 homedir
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return { ...actual, tmpdir: () => h.tmp || actual.tmpdir() }
})

// 只覆盖 spawn：git-ignore 使用的 spawnSync 保持真实
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawn: h.spawn }
})

/** 缓存文件路径：与 update-check 内部拼接一致 */
const CACHE_FILE = ".opsbox-update-check.json"
/** 用例前的 argv[1] 与开关环境变量：用后复位 */
let originArgv1: string | undefined
let originNoCheck: string | undefined
/** stderr 提示的 spy：屏蔽输出的同时用于断言 */
let errSpy: MockInstance

// 写入缓存记录
function writeCacheFile(record: { ts: number; ok: boolean; latest: string }): void {
  writeFileSync(join(h.tmp, CACHE_FILE), JSON.stringify(record), "utf8")
}

// 读取缓存记录
function readCacheFile(): { ts: number; ok: boolean; latest: string } {
  return JSON.parse(readFileSync(join(h.tmp, CACHE_FILE), "utf8"))
}

beforeEach(() => {
  h.tmp = mkdtempSync(join(tmpdir(), "opsbox-update-"))
  h.spawn.mockClear()
  originArgv1 = process.argv[1]
  process.argv[1] = "cli.js"
  originNoCheck = process.env.OPSBOX_NO_UPDATE_CHECK
  // 置 "0"（未关闭）：既走环境变量分支跳过配置读取，又保证检查不被短路
  process.env.OPSBOX_NO_UPDATE_CHECK = "0"
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  rmSync(h.tmp, { recursive: true, force: true })
  h.tmp = ""
  process.argv[1] = originArgv1 as string
  if (originNoCheck === undefined) delete process.env.OPSBOX_NO_UPDATE_CHECK
  else process.env.OPSBOX_NO_UPDATE_CHECK = originNoCheck
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("startUpdateCheck", () => {
  it("环境变量显式关闭时直接返回，不提示也不派生", () => {
    process.env.OPSBOX_NO_UPDATE_CHECK = "1"
    startUpdateCheck("0.1.0")
    expect(h.spawn).not.toHaveBeenCalled()
    expect(errSpy).not.toHaveBeenCalled()
  })

  it("命中更高版本的成功缓存时提示一次", () => {
    writeCacheFile({ ts: Date.now(), ok: true, latest: "9.9.9" })
    startUpdateCheck("0.1.0")
    expect(h.spawn).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(String(errSpy.mock.calls[0]?.[0])).toContain("9.9.9")
  })

  it("缓存版本不高于当前时不提示", () => {
    writeCacheFile({ ts: Date.now(), ok: true, latest: "0.0.1" })
    startUpdateCheck("0.1.0")
    expect(errSpy).not.toHaveBeenCalled()
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it("无有效缓存时派生一次后台 worker", () => {
    startUpdateCheck("0.1.0")
    expect(h.spawn).toHaveBeenCalledTimes(1)
  })
})

describe("runUpdateCheckWorker", () => {
  it("拉取成功写入正缓存", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ version: "9.9.9" }) })))
    await runUpdateCheckWorker()
    const record = readCacheFile()
    expect(record.ok).toBe(true)
    expect(record.latest).toBe("9.9.9")
  })

  it("拉取失败写入负缓存", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline")
      }),
    )
    await runUpdateCheckWorker()
    const record = readCacheFile()
    expect(record.ok).toBe(false)
    expect(record.latest).toBe("")
  })
})
