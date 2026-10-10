// git 探测单测：路径归一与工作树归属判定（纯逻辑部分，不依赖真实仓库）
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { canonicalPath, isInsideWorktree, normalizePathForCompare, toPosix } from "../git-ignore"

/** 当前用例的临时工作目录 */
let work: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "opsbox-gitignore-"))
})

afterEach(() => rmSync(work, { recursive: true, force: true }))

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
