// 机器可读输出单测：schemaVersion 锚点、stdout 出口与 --format 校验口径
import { afterEach, describe, expect, it, vi } from "vitest"
import { assertJsonFormat, printJson, toJsonText } from "../json-output"

afterEach(() => {
  vi.restoreAllMocks()
  // assertJsonFormat 失败时置退出码，逐例复位避免串味
  process.exitCode = 0
})

describe("toJsonText", () => {
  it("前置 schemaVersion 锚点且缩进 2", () => {
    expect(toJsonText({ a: 1 })).toBe('{\n  "schemaVersion": 1,\n  "a": 1\n}')
  })

  it("可被反序列化且锚点版本为 1", () => {
    expect(JSON.parse(toJsonText({ ok: true }))).toEqual({ schemaVersion: 1, ok: true })
  })

  it("载荷显式携带 schemaVersion 时以载荷为准（锚点在前、载荷在后）", () => {
    expect(JSON.parse(toJsonText({ schemaVersion: 2 })).schemaVersion).toBe(2)
  })
})

describe("printJson", () => {
  it("经 console.log 输出序列化文本", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    printJson({ a: 1 })
    expect(spy).toHaveBeenCalledWith(toJsonText({ a: 1 }))
  })
})

describe("assertJsonFormat", () => {
  it("缺省与 json 均放行且不动退出码", () => {
    expect(assertJsonFormat(undefined)).toBe(true)
    expect(assertJsonFormat("json")).toBe(true)
    expect(process.exitCode ?? 0).toBe(0)
  })

  it("非法值告警并置退出码 1", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(assertJsonFormat("yaml")).toBe(false)
    expect(spy).toHaveBeenCalledWith('⚠️ 不支持的输出格式「yaml」，仅支持 json')
    expect(process.exitCode).toBe(1)
  })
})
