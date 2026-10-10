// config status 单测：home 折叠与体检报告（层命中、来源、忽略提示与问题计数）
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CONFIG_LOCAL_FILE, setHomeDirForTest } from "../config"
import { configStatus, foldHome, foldHomeInText } from "../config-status"
import { toPosix } from "../git-ignore"

/** 临时 home 目录 */
let home: string
/** 临时项目目录：体检起点 */
let project: string
/** 用例前的升级检查环境变量：用后复位，保证 env 命中判定可预期 */
let originNoCheck: string | undefined

// 写配置文件：content 为字符串时按原文写入
function writeConfig(dir: string, name: string, content: unknown): void {
  writeFileSync(join(dir, name), typeof content === "string" ? content : JSON.stringify(content), "utf8")
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "opsbox-status-home-"))
  project = mkdtempSync(join(tmpdir(), "opsbox-status-proj-"))
  setHomeDirForTest(home)
  originNoCheck = process.env.OPSBOX_NO_UPDATE_CHECK
  delete process.env.OPSBOX_NO_UPDATE_CHECK
})

afterEach(() => {
  setHomeDirForTest(undefined)
  if (originNoCheck === undefined) delete process.env.OPSBOX_NO_UPDATE_CHECK
  else process.env.OPSBOX_NO_UPDATE_CHECK = originNoCheck
  rmSync(home, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

describe("foldHome", () => {
  it("home 之下折叠为 ~ 前缀", () => {
    expect(foldHome(join(home, "a", "b"))).toBe("~/a/b")
  })

  it("home 自身折叠为 ~", () => {
    expect(foldHome(home)).toBe("~")
  })

  it("同前缀兄弟目录不误折", () => {
    expect(foldHome(`${home}2`)).toBe(toPosix(`${home}2`))
  })
})

describe("foldHomeInText", () => {
  it("文本内嵌的 home 路径折叠为 ~", () => {
    expect(foldHomeInText(`路径 ${join(home, "a", "b")} 结束`)).toContain("~/a/b")
  })

  it("同前缀兄弟目录不误折", () => {
    // 断言直测「未被折叠」本身：不能断言「输出不含 ~」——home 路径在 8.3 短名环境下自身即含 ~（如 C:/Users/RUNNER~1/...）
    expect(foldHomeInText(`路径 ${home}2 结束`)).toBe(toPosix(`路径 ${home}2 结束`))
  })
})

describe("configStatus", () => {
  it("三层均无文件时给正结论且无问题项", () => {
    const report = configStatus(project)
    expect(report.summary.startsWith("三层均无配置文件，全部取默认值")).toBe(true)
    expect(report.levels.map((level) => level.present)).toEqual([false, false, false])
    expect(report.displayKeys.every((item) => item.source === null)).toBe(true)
    expect(report.warnings).toBe(0)
  })

  it("未知配置段给 info 提示且不计入问题数", () => {
    writeConfig(project, ".opsboxrc.json", { foo: { bar: 1 } })
    const report = configStatus(project)
    expect(report.summary.startsWith("共命中 1 层")).toBe(true)
    expect(report.warnings).toBe(0)
    expect(report.items.some((item) => item.level === "info" && item.message.includes("未知配置段「foo」"))).toBe(true)
  })

  it("本地层显式字段的来源标注为本地层", () => {
    writeConfig(project, CONFIG_LOCAL_FILE, { "project-rename": { backupDir: "bk" } })
    const report = configStatus(project)
    const hit = report.displayKeys.find((item) => item.key === "project-rename.backupDir")
    expect(hit?.source).toBe("本地层")
  })

  it("环境变量命中时列入 env 清单", () => {
    process.env.OPSBOX_NO_UPDATE_CHECK = "1"
    const report = configStatus(project)
    expect(report.env.some((item) => item.env === "OPSBOX_NO_UPDATE_CHECK")).toBe(true)
  })
})
