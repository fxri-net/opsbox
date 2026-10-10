// project-rename 路径 / URI 处理单测：覆盖 file URI 构造与旧 URI 改写边界
import { describe, expect, it } from "vitest"
import { pathForms, pathName, replacePaths, replaceUri, toFileUri } from "../paths"

describe("toFileUri", () => {
  it("Windows 盘符小写、冒号编码为 %3A", () => {
    expect(toFileUri("D:\\proj\\app")).toBe("file:///d%3A/proj/app")
  })

  it("中文目录名按 UTF-8 百分号编码", () => {
    expect(toFileUri("D:\\proj\\toolkit软著")).toBe("file:///d%3A/proj/toolkit%E8%BD%AF%E8%91%97")
  })

  it("POSIX 路径直接前缀 file://", () => {
    expect(toFileUri("/home/dev/app")).toBe("file:///home/dev/app")
  })
})

describe("replaceUri", () => {
  it("改写 JSON 中的 folder 值", () => {
    expect(replaceUri('{"folder":"file:///d%3A/a/app"}', "file:///d%3A/a/app", "file:///d%3A/a/next")).toBe('{"folder":"file:///d%3A/a/next"}')
  })

  it("同时改写指向项目下文件的子 URI", () => {
    expect(replaceUri('{"resource":"file:///d%3A/a/app/src/x.ts"}', "file:///d%3A/a/app", "file:///d%3A/a/next")).toBe('{"resource":"file:///d%3A/a/next/src/x.ts"}')
  })

  it("不误伤以旧 URI 为前缀的更长目录名", () => {
    const text = '{"folder":"file:///d%3A/a/app-2"}'
    expect(replaceUri(text, "file:///d%3A/a/app", "file:///d%3A/a/next")).toBe(text)
  })

  it("新 URI 含 $ 时按字面量输出", () => {
    expect(replaceUri("file:///d%3A/a/app", "file:///d%3A/a/app", "file:///d%3A/a/x$y")).toBe("file:///d%3A/a/x$y")
  })
})

describe("pathName", () => {
  it("取路径末段名", () => {
    expect(pathName("a/b/app")).toBe("app")
    expect(pathName("app")).toBe("app")
  })
})

describe("pathForms", () => {
  it("覆盖 Windows 反斜杠 / 正斜杠、盘符大小写、全大写、JSON 转义与 URI 形态", () => {
    const forms = pathForms("D:\\proj\\app")
    expect(forms).toEqual(
      expect.arrayContaining([
        "D:\\proj\\app",
        "D:/proj/app",
        "d:\\proj\\app",
        "d:/proj/app",
        "D:\\PROJ\\APP",
        "D:\\proj\\app".replace(/\\/g, "\\\\"),
        "/d:/proj/app",
        "file:///d%3A/proj/app"
      ])
    )
  })

  it("POSIX 路径给出自身与 file URI", () => {
    expect(pathForms("/home/dev/app")).toEqual(expect.arrayContaining(["/home/dev/app", "file:///home/dev/app"]))
  })
})

describe("replacePaths", () => {
  it("逐形态改写旧路径（原生 / 正斜杠 / 小写盘符 / URI）", () => {
    const text = JSON.stringify({
      native: "D:\\proj\\app",
      forward: "D:/proj/app",
      lower: "d:\\proj\\app\\src\\x.ts",
      uri: "file:///d%3A/proj/app"
    })
    const out = JSON.parse(replacePaths(text, "D:\\proj\\app", "D:\\proj\\next")) as Record<string, string>
    expect(out.native).toBe("D:\\proj\\next")
    expect(out.forward).toBe("D:/proj/next")
    expect(out.lower).toBe("d:\\proj\\next\\src\\x.ts")
    expect(out.uri).toBe("file:///d%3A/proj/next")
  })

  it("不误伤以旧路径为前缀的更长目录名", () => {
    const text = "D:\\proj\\app-2"
    expect(replacePaths(text, "D:\\proj\\app", "D:\\proj\\next")).toBe(text)
  })
})
