// git 探测单测：路径归一与工作树归属判定（纯逻辑部分），以及经 mock 的 git 子进程覆盖忽略 / 仓库 / 跟踪各归因分支
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { canonicalPath, checkIgnore, inspectLocalConfigIgnore, isInsideWorktree, isTracked, normalizePathForCompare, probeRepo, toPosix } from "../git-ignore"

// 测试替身：spawnSync 按 git 子命令编程返回，隔离真实仓库与本机 git
const h = vi.hoisted(() => ({ spawnSync: vi.fn() }))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, spawnSync: h.spawnSync }
})

/** 当前用例的临时工作目录 */
let work: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "opsbox-gitignore-"))
  h.spawnSync.mockReset()
})

afterEach(() => rmSync(work, { recursive: true, force: true }))

/** 按 git 子命令编程 spawnSync 返回（stdout / stderr 缺省为空串） */
function programGit(fn: (sub: string, args: string[]) => { status: number; stdout?: string; stderr?: string }): void {
  h.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
    const r = fn(args[0] ?? "", args)
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
  })
}

describe("toPosix", () => {
  it("反斜杠归一为正斜杠", () => {
    expect(toPosix("a\\b\\c")).toBe("a/b/c")
  })
})

describe("normalizePathForCompare", () => {
  it("归一分隔符、去尾斜杠并小写", () => {
    expect(normalizePathForCompare("C:\\Foo\\Bar\\")).toBe("c:/foo/bar")
  })
})

describe("canonicalPath", () => {
  it("相对路径原样返回", () => {
    expect(canonicalPath("some/rel")).toBe("some/rel")
  })

  it("绝对路径取最近存在祖先的真实形态并拼回缺失尾段", () => {
    expect(canonicalPath(join(work, "missing", "deep"))).toBe(join(canonicalPath(work), "missing", "deep"))
  })
})

describe("isInsideWorktree", () => {
  it("相等或以根 + / 开头为真", () => {
    const sub = join(work, "sub")
    mkdirSync(sub)
    expect(isInsideWorktree(work, work)).toBe(true)
    expect(isInsideWorktree(sub, work)).toBe(true)
  })

  it("同前缀兄弟目录不误命中", () => {
    expect(isInsideWorktree(`${work}2`, work)).toBe(false)
  })
})

describe("checkIgnore", () => {
  it("退出码 0 为已忽略、1 为未忽略", () => {
    programGit(() => ({ status: 0 }))
    expect(checkIgnore(join(work, "a.txt"))).toEqual({ state: "ignored" })
    programGit(() => ({ status: 1 }))
    expect(checkIgnore(join(work, "a.txt"))).toEqual({ state: "not-ignored" })
  })

  it("按 stderr 细分非仓库与越界仓库", () => {
    programGit(() => ({ status: 128, stderr: "fatal: not a git repository (or any of the parent directories)" }))
    expect(checkIgnore(join(work, "a.txt"))).toEqual({ state: "not-a-repo" })
    programGit(() => ({ status: 128, stderr: "fatal: /x/y is outside repository at /repo" }))
    expect(checkIgnore(join(work, "a.txt"))).toEqual({ state: "outside-repo" })
  })

  it("其他错误归为不可用并带 stderr 摘要", () => {
    programGit(() => ({ status: 128, stderr: "fatal: 意外错误" }))
    expect(checkIgnore(join(work, "a.txt"))).toEqual({ state: "unavailable", detail: "fatal: 意外错误" })
  })

  it("stderr 为空时退回退出码描述", () => {
    programGit(() => ({ status: 129 }))
    expect(checkIgnore(join(work, "a.txt"))).toEqual({ state: "unavailable", detail: "git check-ignore 退出码 129" })
  })
})

describe("probeRepo", () => {
  it("成功时返回仓库根", () => {
    programGit(() => ({ status: 0, stdout: "/repo\n" }))
    expect(probeRepo(work)).toEqual({ kind: "repo", root: "/repo" })
  })

  it("成功但根路径为空时归为不可用", () => {
    programGit(() => ({ status: 0, stdout: "   \n" }))
    expect(probeRepo(work)).toEqual({ kind: "unavailable", detail: "git rev-parse 未返回仓库根路径" })
  })

  it("非仓库归为 not-a-repo", () => {
    programGit(() => ({ status: 128, stderr: "fatal: not a git repository" }))
    expect(probeRepo(work)).toEqual({ kind: "not-a-repo" })
  })

  it("其他错误归为不可用", () => {
    programGit(() => ({ status: 128, stderr: "fatal: 意外" }))
    expect(probeRepo(work)).toEqual({ kind: "unavailable", detail: "fatal: 意外" })
  })

  it("子进程同步抛错时归为不可用", () => {
    h.spawnSync.mockImplementation(() => {
      throw new Error("spawn git ENOENT")
    })
    expect(probeRepo(work)).toEqual({ kind: "unavailable", detail: "spawn git ENOENT" })
  })
})

describe("isTracked", () => {
  it("退出码 0 / 1 / 其他分别映射已跟踪 / 未跟踪 / 不可用", () => {
    programGit(() => ({ status: 0 }))
    expect(isTracked(join(work, "a.txt"))).toBe(true)
    programGit(() => ({ status: 1 }))
    expect(isTracked(join(work, "a.txt"))).toBe(false)
    programGit(() => ({ status: 128 }))
    expect(isTracked(join(work, "a.txt"))).toBeUndefined()
  })
})

describe("inspectLocalConfigIgnore", () => {
  it("非仓库直接归 not-a-repo", () => {
    programGit(() => ({ status: 128, stderr: "fatal: not a git repository" }))
    expect(inspectLocalConfigIgnore(join(work, "a.json"), work)).toEqual({ state: "not-a-repo" })
  })

  it("仓库探针不可用时透传诊断", () => {
    programGit(() => ({ status: 128, stderr: "fatal: 意外" }))
    expect(inspectLocalConfigIgnore(join(work, "a.json"), work)).toEqual({ state: "unavailable", detail: "fatal: 意外" })
  })

  it("路径不在工作树内归 outside-repo", () => {
    programGit((sub) => (sub === "rev-parse" ? { status: 0, stdout: "/repo" } : { status: 1 }))
    expect(inspectLocalConfigIgnore("/other/a.json", work)).toEqual({ state: "outside-repo" })
  })

  it("已跟踪优先于忽略判定", () => {
    programGit((sub) => (sub === "rev-parse" ? { status: 0, stdout: work } : sub === "ls-files" ? { status: 0 } : { status: 1 }))
    expect(inspectLocalConfigIgnore(join(work, "a.json"), work)).toEqual({ state: "tracked" })
  })

  it("跟踪判定失败归不可用", () => {
    programGit((sub) => (sub === "rev-parse" ? { status: 0, stdout: work } : sub === "ls-files" ? { status: 128 } : { status: 1 }))
    expect(inspectLocalConfigIgnore(join(work, "a.json"), work)).toEqual({ state: "unavailable", detail: "git ls-files 执行失败" })
  })

  it("未跟踪时按忽略探针归因", () => {
    programGit((sub) => (sub === "rev-parse" ? { status: 0, stdout: work } : sub === "ls-files" ? { status: 1 } : sub === "check-ignore" ? { status: 0 } : { status: 1 }))
    expect(inspectLocalConfigIgnore(join(work, "a.json"), work)).toEqual({ state: "ignored" })
  })

  it("忽略探针不可用时透传诊断", () => {
    programGit((sub) =>
      sub === "rev-parse" ? { status: 0, stdout: work } : sub === "ls-files" ? { status: 1 } : { status: 128, stderr: "fatal: 意外" }
    )
    expect(inspectLocalConfigIgnore(join(work, "a.json"), work)).toEqual({ state: "unavailable", detail: "fatal: 意外" })
  })
})
