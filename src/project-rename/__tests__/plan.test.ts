// 迁移计划单测：覆盖路径解析、宿主解析透传与各宿主载体的汇总
import { resolve } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Artifact } from "../artifacts"
import type { HostAdapter } from "../adapters/types"
import { buildPlan } from "../plan"

// 测试替身：宿主解析交由用例编程，隔离注册表与本机宿主检出
const h = vi.hoisted(() => ({ resolveHosts: vi.fn() }))

vi.mock("../adapters/registry", () => ({ resolveHosts: h.resolveHosts }))

/** 构造只回放固定载体的假宿主适配器 */
function fakeHost(id: string, artifacts: Artifact[]): HostAdapter {
  return { id, label: id, detect: () => true, scan: () => artifacts }
}

beforeEach(() => {
  h.resolveHosts.mockReset()
})

describe("buildPlan", () => {
  it("解析绝对路径与新目录名，汇总各宿主载体", () => {
    const a1: Artifact = { host: "vscode", kind: "text", path: "/x/a", note: "n1" }
    const a2: Artifact = { host: "trae-cn", kind: "sqlite", path: "/x/b", note: "n2" }
    h.resolveHosts.mockReturnValue([fakeHost("vscode", [a1]), fakeHost("trae-cn", [a2])])
    const plan = buildPlan({ oldPath: "proj/app", newPath: "proj/next", hosts: ["vscode", "trae-cn"] })
    expect(plan.oldPath).toBe(resolve("proj/app"))
    expect(plan.newPath).toBe(resolve("proj/next"))
    expect(plan.newName).toBe("next")
    expect(plan.oldUri.endsWith("/proj/app")).toBe(true)
    expect(plan.newUri.endsWith("/proj/next")).toBe(true)
    expect(plan.artifacts).toEqual([a1, a2])
    expect(h.resolveHosts).toHaveBeenCalledWith(["vscode", "trae-cn"])
  })

  it("未指定宿主时透传 undefined 交由注册表自动检出", () => {
    h.resolveHosts.mockReturnValue([])
    const plan = buildPlan({ oldPath: "a", newPath: "b" })
    expect(h.resolveHosts).toHaveBeenCalledWith(undefined)
    expect(plan.artifacts).toEqual([])
  })
})
