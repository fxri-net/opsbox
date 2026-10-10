// DDL 生成核心单测：类型归类、默认值、列/索引/建表拼装是还原正确性的关键面
import { describe, expect, it } from "vitest"
import { buildColumn, buildCreateTable, buildDefault, buildIndex, catType, mapRowFormat } from "../sdi-to-ddl"
import type { SdiColumn, SdiTable } from "../types"

/** 造一个最小表级对象 */
function table(extra: Partial<SdiTable> = {}): SdiTable {
  return { name: "t", ...extra }
}

describe("catType", () => {
  it("归类常见类型", () => {
    expect(catType("int(11)")).toBe("int")
    expect(catType("varchar(64)")).toBe("string")
    expect(catType("enum('a','b')")).toBe("enum")
    expect(catType("set('a')")).toBe("set")
    expect(catType("decimal(10,2)")).toBe("decimal")
    expect(catType("datetime")).toBe("temporal")
    expect(catType("json")).toBe("json")
    expect(catType("blob")).toBe("blob")
    expect(catType("bit(1)")).toBe("bit")
  })

  it("未知类型带回原文本", () => {
    expect(catType("weirdtype")).toBe("UNKNOWN:weirdtype")
    expect(catType(undefined)).toBe("UNKNOWN:")
  })
})

describe("mapRowFormat", () => {
  it("已知枚举映射关键字", () => {
    expect(mapRowFormat(2)).toBe("DYNAMIC")
    expect(mapRowFormat(1)).toBe("FIXED")
  })

  it("未知与缺省返回空串", () => {
    expect(mapRowFormat(undefined)).toBe("")
    expect(mapRowFormat(99)).toBe("")
  })
})

describe("buildDefault", () => {
  it("自增列不产出默认值", () => {
    expect(buildDefault({ name: "id", column_type_utf8: "int", is_auto_increment: true, default_value_utf8: "0" })).toBe("")
  })

  it("显式无默认值标记返回空串", () => {
    expect(buildDefault({ name: "c", column_type_utf8: "int", has_no_default: true })).toBe("")
  })

  it("默认 NULL 产出 DEFAULT NULL", () => {
    expect(buildDefault({ name: "c", column_type_utf8: "int", default_value_null: true })).toBe("DEFAULT NULL")
  })

  it("字面 NULL 标记返回空串", () => {
    expect(buildDefault({ name: "c", column_type_utf8: "varchar(10)", default_value_utf8_null: true })).toBe("")
  })

  it("数值类默认值不加引号", () => {
    expect(buildDefault({ name: "n", column_type_utf8: "int", default_value_utf8: "5" })).toBe("DEFAULT 5")
  })

  it("字符串类默认值加引号并转义", () => {
    expect(buildDefault({ name: "s", column_type_utf8: "varchar(10)", default_value_utf8: "it's" })).toBe("DEFAULT 'it''s'")
  })
})

describe("buildColumn", () => {
  it("非空列带 NOT NULL", () => {
    const warnings: string[] = []
    const col: SdiColumn = { name: "id", column_type_utf8: "int", is_nullable: false, has_no_default: true }
    expect(buildColumn(col, table(), warnings)).toBe("  `id` int NOT NULL")
    expect(warnings).toHaveLength(0)
  })

  it("字符串列显式排序规则输出字符集与排序规则", () => {
    const warnings: string[] = []
    const col: SdiColumn = { name: "s", column_type_utf8: "varchar(10)", is_explicit_collation: true, collation_id: 45, is_nullable: true, has_no_default: true }
    expect(buildColumn(col, table({ collation_id: 255 }), warnings)).toBe("  `s` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci")
    expect(warnings).toHaveLength(0)
  })

  it("自增列追加 AUTO_INCREMENT", () => {
    const warnings: string[] = []
    const col: SdiColumn = { name: "id", column_type_utf8: "int", is_nullable: false, is_auto_increment: true }
    expect(buildColumn(col, table(), warnings)).toBe("  `id` int NOT NULL AUTO_INCREMENT")
  })

  it("列注释转义单引号", () => {
    const warnings: string[] = []
    const col: SdiColumn = { name: "id", column_type_utf8: "int", is_nullable: false, has_no_default: true, comment: "it's ok" }
    expect(buildColumn(col, table(), warnings)).toBe("  `id` int NOT NULL COMMENT 'it''s ok'")
  })
})

describe("buildIndex", () => {
  it("主键索引", () => {
    const dd = table({ columns: [{ name: "id" }] })
    expect(buildIndex({ name: "PRIMARY", type: 1, elements: [{ column_opx: 0 }] }, dd, "db", "t", [])).toBe("  PRIMARY KEY (`id`)")
  })

  it("普通索引解析列下标", () => {
    const dd = table({ columns: [{ name: "x" }, { name: "a" }] })
    expect(buildIndex({ name: "idx_a", type: 3, elements: [{ column_opx: 1 }] }, dd, "db", "t", [])).toBe("  KEY `idx_a` (`a`)")
  })

  it("隐藏索引元素被过滤", () => {
    const dd = table({ columns: [{ name: "x" }, { name: "a" }] })
    const ix = { name: "idx_a", type: 3, elements: [{ column_opx: 0, hidden: true }, { column_opx: 1 }] }
    expect(buildIndex(ix, dd, "db", "t", [])).toBe("  KEY `idx_a` (`a`)")
  })

  it("列下标越界记录告警", () => {
    const warnings: string[] = []
    const dd = table({ columns: [{ name: "x" }] })
    expect(buildIndex({ name: "idx", type: 3, elements: [{ column_opx: 9, ordinal_position: 1 }] }, dd, "db", "t", warnings)).toBe("  KEY `idx` (``)")
    expect(warnings).toHaveLength(1)
  })
})

describe("buildCreateTable", () => {
  it("拼装列、主键与表级属性", () => {
    const warnings: string[] = []
    const dd = table({
      engine: "InnoDB",
      row_format: 2,
      collation_id: 255,
      columns: [{ name: "id", column_type_utf8: "int", is_nullable: false, is_auto_increment: true, hidden: 1 }],
      indexes: [{ name: "PRIMARY", type: 1, elements: [{ column_opx: 0 }] }]
    })
    const sql = buildCreateTable(dd, "testdb", "t", warnings)
    expect(sql).toBe(
      [
        "CREATE TABLE `t` (",
        "  `id` int NOT NULL AUTO_INCREMENT,",
        "  PRIMARY KEY (`id`)",
        ")",
        "ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;"
      ].join("\n")
    )
    expect(warnings).toHaveLength(0)
  })

  it("带回 InnoDB 自增计数器", () => {
    const dd = table({
      engine: "InnoDB",
      row_format: 2,
      collation_id: 255,
      se_private_data: "autoinc=100",
      columns: [{ name: "id", column_type_utf8: "int", is_nullable: false, is_auto_increment: true, hidden: 1 }],
      indexes: []
    })
    expect(buildCreateTable(dd, "testdb", "t", [])).toContain("AUTO_INCREMENT=100;")
  })
})
