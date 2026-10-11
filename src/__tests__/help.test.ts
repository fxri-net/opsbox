// CLI 帮助口径单测：帮助文案中文化、父级清单条目复用子命令自身 Usage 行（含递归）
import { Command } from "commander"
import { describe, expect, it } from "vitest"
import { setupHelp } from "../help"

describe("setupHelp", () => {
  it("顶层与子命令的帮助选项均换中文描述", () => {
    const root = new Command("opsbox")
    const sub = root.command("mysql-recover")
    setupHelp(root)
    expect(root.helpInformation()).toContain("-h, --help")
    expect(root.helpInformation()).toContain("显示帮助")
    // 递归：子命令自身的帮助信息同样已换口径
    expect(sub.helpInformation()).toContain("显示帮助")
  })

  it("父级清单条目为「名字 + 自身 Usage」并折叠空白", () => {
    const root = new Command("opsbox")
    const sub = root.command("mysql-recover")
    setupHelp(root)
    const helper = root.createHelp()
    expect(helper.subcommandTerm(sub)).toBe(`mysql-recover ${sub.usage()}`.replace(/\s+/g, " ").trim())
  })
})
