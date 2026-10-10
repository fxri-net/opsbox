// 跨平台文件系统原语单测：在临时目录上验证拷贝/移动/统计等核心行为
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { copyFile, copyTree, dirSize, ensureDir, formatSize, isDir, listDir, movePath } from "../fsx"

/** 当前用例的临时工作目录 */
let work: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "opsbox-fsx-"))
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

describe("ensureDir / isDir / listDir", () => {
  it("递归创建目录并可判定", () => {
    const dir = join(work, "a", "b", "c")
    ensureDir(dir)
    expect(isDir(dir)).toBe(true)
    expect(isDir(join(work, "a", "missing"))).toBe(false)
  })

  it("列目录（含隐藏项），不存在返回空数组", () => {
    ensureDir(join(work, "dir"))
    writeFileSync(join(work, "dir", "one.txt"), "1")
    writeFileSync(join(work, "dir", ".hidden"), "2")
    expect(listDir(join(work, "dir")).sort()).toEqual([".hidden", "one.txt"])
    expect(listDir(join(work, "nope"))).toEqual([])
  })
})

describe("copyFile / copyTree / movePath", () => {
  it("拷贝单文件", () => {
    writeFileSync(join(work, "src.txt"), "hello")
    copyFile(join(work, "src.txt"), join(work, "sub", "dst.txt"))
    expect(listDir(join(work, "sub"))).toEqual(["dst.txt"])
  })

  it("递归拷贝目录树", () => {
    ensureDir(join(work, "tree", "inner"))
    writeFileSync(join(work, "tree", "inner", "f.txt"), "x")
    copyTree(join(work, "tree"), join(work, "clone"))
    expect(listDir(join(work, "clone", "inner"))).toEqual(["f.txt"])
  })

  it("移动路径（同卷重命名）", () => {
    ensureDir(join(work, "from"))
    writeFileSync(join(work, "from", "f.txt"), "x")
    movePath(join(work, "from"), join(work, "to"))
    expect(isDir(join(work, "from"))).toBe(false)
    expect(listDir(join(work, "to"))).toEqual(["f.txt"])
  })
})

describe("dirSize", () => {
  it("递归统计字节数，不存在返回 0", () => {
    ensureDir(join(work, "d"))
    writeFileSync(join(work, "d", "a.txt"), "12345")
    expect(dirSize(join(work, "d"))).toBe(5)
    expect(dirSize(join(work, "none"))).toBe(0)
  })
})

describe("formatSize", () => {
  it("按量级格式化字节数", () => {
    expect(formatSize(0)).toBe("0.00 B")
    expect(formatSize(1024)).toBe("1.00 KB")
    expect(formatSize(1536)).toBe("1.50 KB")
    expect(formatSize(1024 * 1024)).toBe("1.00 MB")
    expect(formatSize(1024 * 1024 * 1024)).toBe("1.00 GB")
  })
})
