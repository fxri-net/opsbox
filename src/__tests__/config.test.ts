// 配置三层加载单测：注入临时 home 与项目目录，覆盖分层合并粒度、降级剔除与取值
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CONFIG_LOCAL_FILE,
  getConfigString,
  inspectConfigLayers,
  loadOpsboxConfig,
  resetOpsboxConfigCache,
  resolveLeafSource,
  setHomeDirForTest,
} from "../config"

/** 临时 home 目录：全局层与本地层边界的落点 */
let home: string
/** 临时项目目录：向上查找起点 */
let project: string
/** 用例开始时的原始工作目录：用后复位，避免污染其他用例 */
let originCwd: string

// 写配置文件：目标目录须已存在；content 为字符串时按原文写入（用于构造非法 JSON）
function writeConfig(dir: string, name: string, content: unknown): void {
  writeFileSync(join(dir, name), typeof content === "string" ? content : JSON.stringify(content), "utf8")
}

beforeEach(() => {
  originCwd = process.cwd()
  home = mkdtempSync(join(tmpdir(), "opsbox-home-"))
  project = mkdtempSync(join(tmpdir(), "opsbox-proj-"))
  setHomeDirForTest(home)
  // 降级告警走 stderr：用例内屏蔽，避免污染测试输出
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  process.chdir(originCwd)
  setHomeDirForTest(undefined)
  resetOpsboxConfigCache()
  vi.restoreAllMocks()
  rmSync(home, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

describe("三层加载", () => {
  it("三层均无配置文件时 merged 与返回值均为 null", () => {
    const layers = inspectConfigLayers(project)
    expect(layers.merged).toBeNull()
    expect(loadOpsboxConfig(project)).toBeNull()
    expect(layers.global.hit).toBe(false)
    expect(layers.project.hit).toBe(false)
    expect(layers.local.hit).toBe(false)
  })

  it("仅全局层写段时取全局值", () => {
    writeConfig(home, ".opsboxrc.json", { updateCheck: { enabled: false } })
    const layers = inspectConfigLayers(project)
    expect(layers.merged).toEqual({ updateCheck: { enabled: false } })
    expect(resolveLeafSource(layers, "updateCheck.enabled")).toBe("全局层")
  })

  it("项目层段整体覆盖全局同名段（非字段级深合并）", () => {
    writeConfig(home, ".opsboxrc.json", { "mysql-recover": { dataDir: "global" }, updateCheck: { enabled: true } })
    writeConfig(project, ".opsboxrc.json", { "mysql-recover": { binDir: "project" } })
    const layers = inspectConfigLayers(project)
    // 全局段的 dataDir 被项目段整体顶掉，只留项目段字段；未写段的 updateCheck 落全局
    expect(layers.merged).toEqual({ "mysql-recover": { binDir: "project" }, updateCheck: { enabled: true } })
  })

  it("本地层按字段浅合并覆盖项目层同段", () => {
    writeConfig(project, ".opsboxrc.json", { "mysql-recover": { dataDir: "project", binDir: "pbin" } })
    writeConfig(project, CONFIG_LOCAL_FILE, { "mysql-recover": { dataDir: "local" } })
    const layers = inspectConfigLayers(project)
    expect(layers.merged).toEqual({ "mysql-recover": { dataDir: "local", binDir: "pbin" } })
    expect(resolveLeafSource(layers, "mysql-recover.dataDir")).toBe("本地层")
    expect(resolveLeafSource(layers, "mysql-recover.binDir")).toBe("项目层")
  })

  it("home 下的本地文件不参与本地层向上查找", () => {
    const sub = join(home, "repo")
    mkdirSync(sub)
    writeConfig(home, CONFIG_LOCAL_FILE, { "project-rename": { backupDir: "x" } })
    const layers = inspectConfigLayers(sub)
    // 起点在 home 之下，止于 home 的边界使 home 自身的本地文件不被命中
    expect(layers.local.hit).toBe(false)
    expect(layers.merged).toBeNull()
  })
})

describe("降级", () => {
  it("JSON 非法时整层降级并记录明细", () => {
    writeConfig(home, ".opsboxrc.json", "{ 非法")
    const layers = inspectConfigLayers(project)
    expect(layers.merged).toBeNull()
    expect(layers.fallbacks).toHaveLength(1)
    expect(layers.fallbacks[0]?.detail).toBe("JSON 解析失败")
  })

  it("段值非对象被剔除", () => {
    writeConfig(home, ".opsboxrc.json", { updateCheck: { enabled: false }, foo: 123 })
    const layers = inspectConfigLayers(project)
    expect(layers.merged).toEqual({ updateCheck: { enabled: false } })
    expect(layers.fallbacks.some((item) => item.key === "foo")).toBe(true)
  })

  it("展示键类型不符时删除该字段", () => {
    writeConfig(home, ".opsboxrc.json", { updateCheck: { enabled: "yes" }, "mysql-recover": { dataDir: 123 } })
    const layers = inspectConfigLayers(project)
    expect(layers.merged).toEqual({ updateCheck: {}, "mysql-recover": {} })
    expect(layers.fallbacks).toHaveLength(2)
  })

  it("字符串展示键为空串时按未写处理", () => {
    writeConfig(home, ".opsboxrc.json", { "project-rename": { backupDir: "" } })
    const layers = inspectConfigLayers(project)
    expect(layers.merged).toEqual({ "project-rename": {} })
  })
})

describe("resolveLeafSource", () => {
  it("项目层独占该段时字段不再回落全局", () => {
    writeConfig(home, ".opsboxrc.json", { "mysql-recover": { dataDir: "global" } })
    writeConfig(project, ".opsboxrc.json", { "mysql-recover": { binDir: "project" } })
    const layers = inspectConfigLayers(project)
    expect(resolveLeafSource(layers, "mysql-recover.dataDir")).toBeNull()
    expect(resolveLeafSource(layers, "mysql-recover.binDir")).toBe("项目层")
  })

  it("三层均未写时返回 null", () => {
    const layers = inspectConfigLayers(project)
    expect(resolveLeafSource(layers, "updateCheck.enabled")).toBeNull()
  })
})

describe("getConfigString", () => {
  it("取非空字符串，缺失或空串按未配置处理", () => {
    writeConfig(project, ".opsboxrc.json", { "mysql-recover": { dataDir: "D:/data", binDir: "" } })
    process.chdir(project)
    resetOpsboxConfigCache()
    expect(getConfigString("mysql-recover", "dataDir")).toBe("D:/data")
    expect(getConfigString("mysql-recover", "binDir")).toBeUndefined()
    expect(getConfigString("mysql-recover", "missing")).toBeUndefined()
    expect(getConfigString("unknown", "dataDir")).toBeUndefined()
  })
})
