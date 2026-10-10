// SQL 字面量转义单测：标识符与字符串是注入与语法错误的高发点，逐一钉死
import { describe, expect, it } from "vitest"
import { quoteIdent, quoteStr, restoreGenerationExpr } from "../sql"

describe("quoteIdent", () => {
  it("反引号加倍", () => {
    expect(quoteIdent("a`b")).toBe("a``b")
  })

  it("普通标识符原样返回", () => {
    expect(quoteIdent("normal_name")).toBe("normal_name")
  })
})

describe("quoteStr", () => {
  it("单引号加倍", () => {
    expect(quoteStr("it's")).toBe("it''s")
  })

  it("反斜杠加倍", () => {
    expect(quoteStr("a\\b")).toBe("a\\\\b")
  })
})

describe("restoreGenerationExpr", () => {
  it("去掉 SDI 中被转义的单引号", () => {
    expect(restoreGenerationExpr("\\'x\\'")).toBe("'x'")
  })

  it("普通表达式原样返回", () => {
    expect(restoreGenerationExpr("`a` + 1")).toBe("`a` + 1")
  })

  it("空值与空白返回空串", () => {
    expect(restoreGenerationExpr(null)).toBe("")
    expect(restoreGenerationExpr(undefined)).toBe("")
    expect(restoreGenerationExpr("   ")).toBe("")
  })
})
