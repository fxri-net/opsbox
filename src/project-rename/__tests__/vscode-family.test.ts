// VS Code 系宿主适配器单测：注入数据根，按真实布局样本断言扫描结果与载体分类
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ensureDir } from "../../platform"
import { discardPath, fileContains, readJsonField, rewriteTextFile } from "../artifacts"
import { pathName, toFileUri } from "../paths"
import { VSCODE_FAMILY_VARIANTS, createVscodeFamilyAdapter } from "../adapters/vscode-family"
import { allHosts, resolveHosts } from "../adapters/registry"

/** 当前用例的临时工作目录 */
let work: string
/** 旧项目路径 */
let oldPath: string
/** 新项目路径 */
let newPath: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "opsbox-rename-"))
  oldPath = join(work, "proj", "old")
  newPath = join(work, "proj", "next")
  ensureDir(oldPath)
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

describe("createVscodeFamilyAdapter", () => {
  it("按真实布局扫描出文本 / 二进制 / 状态库 / 缓存 / 目录五类载体", () => {
    const appBase = join(work, "appdata")
    const homeBase = join(work, "home")
    const userRoot = join(appBase, "Trae CN", "User")
    const homeRoot = join(homeBase, ".trae-cn")
    const oldUri = toFileUri(oldPath)

    // 工作区存储：folder 指向旧路径，并带一个二进制状态库
    const wsDir = join(userRoot, "workspaceStorage", "abc123")
    ensureDir(wsDir)
    writeFileSync(join(wsDir, "workspace.json"), JSON.stringify({ folder: oldUri }))
    writeFileSync(join(wsDir, "state.vscdb"), "SQLite format 3")

    // 另一工作区（folder 不匹配）不应被纳入
    const otherDir = join(userRoot, "workspaceStorage", "zzz999")
    ensureDir(otherDir)
    writeFileSync(join(otherDir, "workspace.json"), JSON.stringify({ folder: "file:///d%3A/elsewhere" }))
    writeFileSync(join(otherDir, "state.vscdb"), "SQLite format 3")

    // 历史：resource 指向项目下文件
    const histDir = join(userRoot, "History", "-1469d2f4")
    ensureDir(histDir)
    writeFileSync(join(histDir, "entries.json"), JSON.stringify({ version: 1, resource: `${oldUri}/src/x.ts` }))

    // 全局存储：storage.json 与 state.vscdb 均含旧路径
    ensureDir(join(userRoot, "globalStorage"))
    writeFileSync(join(userRoot, "globalStorage", "storage.json"), JSON.stringify({ folderUri: oldUri }))
    writeFileSync(join(userRoot, "globalStorage", "state.vscdb"), `xx${oldPath}yy`)

    // 用户数据根：工作树占位目录 + 事件缓存 + 旧 MCP 作用域残留目录（另放两个不匹配样本）
    ensureDir(join(homeRoot, "worktrees", pathName(oldPath)))
    ensureDir(join(homeRoot, "hub_event_cache"))
    ensureDir(join(homeRoot, "mcps", `s_${pathName(oldPath)}-09a66b10`))
    ensureDir(join(homeRoot, "mcps", `s_${pathName(oldPath)}-NOTHEX00`))
    ensureDir(join(homeRoot, "mcps", "s_other-12345678"))

    const host = createVscodeFamilyAdapter({ id: "trae-cn", label: "Trae CN", appDirName: "Trae CN", userDirName: ".trae-cn" }, { appDataBase: appBase, homeBase })
    expect(host.detect()).toBe(true)

    const artifacts = host.scan(oldPath, newPath)
    expect(artifacts.map((a) => a.kind).sort()).toEqual(["binary", "cache", "cache", "dir", "sqlite", "text", "text", "text"])

    const twoPass = artifacts.find((a) => a.twoPass !== undefined)
    expect(twoPass?.twoPass?.oldId).toBe("abc123")
    expect(twoPass?.twoPass?.workspaceRoot).toBe(userRoot)

    // 目录载体指向旧目录名，供引擎改名为新目录名
    const dir = artifacts.find((a) => a.kind === "dir")
    expect(pathName(dir?.path ?? "")).toBe(pathName(oldPath))

    // 仅匹配「s_<旧目录名>-<8 位 hex>」的 MCP 作用域目录被丢弃，其余保留
    const mcps = artifacts.filter((a) => a.path.includes("mcps"))
    expect(mcps.map((a) => pathName(a.path))).toEqual([`s_${pathName(oldPath)}-09a66b10`])
  })

  it("数据根不存在时既不检出也不产出载体", () => {
    const host = createVscodeFamilyAdapter({ id: "vscode", label: "VS Code", appDirName: "Code" }, { appDataBase: join(work, "none"), homeBase: join(work, "none") })
    expect(host.detect()).toBe(false)
    expect(host.scan(oldPath, newPath)).toEqual([])
  })
})

describe("artifacts 载体原语", () => {
  it("fileContains 命中特征串，缺失文件返回 false", () => {
    const file = join(work, "probe.bin")
    writeFileSync(file, "hello-world")
    expect(fileContains(file, ["world"])).toBe(true)
    expect(fileContains(file, ["absent"])).toBe(false)
    expect(fileContains(join(work, "nope.bin"), ["x"])).toBe(false)
  })

  it("readJsonField 取字符串字段，非字符串 / 非法 JSON 返回 null", () => {
    const file = join(work, "obj.json")
    writeFileSync(file, JSON.stringify({ folder: "file:///d%3A/a", num: 1 }))
    expect(readJsonField(file, "folder")).toBe("file:///d%3A/a")
    expect(readJsonField(file, "num")).toBeNull()
    expect(readJsonField(file, "missing")).toBeNull()
    writeFileSync(file, "{ not json")
    expect(readJsonField(file, "folder")).toBeNull()
  })

  it("rewriteTextFile 有变化才落盘并返回 true", () => {
    const file = join(work, "ws.json")
    writeFileSync(file, JSON.stringify({ folder: toFileUri(oldPath) }))
    expect(rewriteTextFile(file, toFileUri(oldPath), toFileUri(newPath))).toBe(true)
    expect(readJsonField(file, "folder")).toBe(toFileUri(newPath))
    expect(rewriteTextFile(file, toFileUri(oldPath), toFileUri(newPath))).toBe(false)
  })

  it("discardPath 递归删除目录", () => {
    const dir = join(work, "cache")
    ensureDir(join(dir, "inner"))
    writeFileSync(join(dir, "inner", "f"), "x")
    discardPath(dir)
    expect(fileContains(join(dir, "inner", "f"), ["x"])).toBe(false)
  })
})

describe("registry 宿主解析", () => {
  it("allHosts 覆盖变体表且顺次一致", () => {
    expect(allHosts().map((host) => host.id)).toEqual(VSCODE_FAMILY_VARIANTS.map((variant) => variant.id))
  })

  it("显式指定宿主时按 id 取用（不校验是否安装）", () => {
    expect(resolveHosts(["vscode", "cursor"]).map((host) => host.id)).toEqual(["vscode", "cursor"])
  })

  it("未知宿主 id 明确报错", () => {
    expect(() => resolveHosts(["nope"])).toThrow(/未知宿主/)
  })
})
