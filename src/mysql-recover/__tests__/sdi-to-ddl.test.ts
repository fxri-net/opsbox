// DDL 生成核心单测：类型归类、默认值、列/索引/建表拼装是还原正确性的关键面
// 集成面经临时数据目录 + mock execFileSync（ibd2sdi）覆盖收集与产物写出
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildColumn, buildCreateTable, buildDefault, buildIndex, catType, collectTables, extractInnodbSdi, generateDdl, loadMyisamSdi, mapRowFormat } from "../sdi-to-ddl"
import type { DdlOptions, SdiColumn, SdiTable } from "../types"

/** execFileSync 由 ibd2sdi 调用，单测以 mock 提供确定性输出 */
const h = vi.hoisted(() => ({ execFileSync: vi.fn() }))
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return { ...actual, execFileSync: h.execFileSync }
})

/** 造一个最小表级对象 */
function table(extra: Partial<SdiTable> = {}): SdiTable {
  return { name: "t", ...extra }
}

/** 造一个最小运行参数 */
function options(root: string, dataDir: string, only: string[] = []): DdlOptions {
  return { dataDir, outDir: join(root, "out"), ibd2sdiExe: "ibd2sdi", cacheDir: join(root, "cache"), only }
}

/** 造 ibd2sdi 输出文本（带可选 BOM），外层为 SDI 条目数组 */
function sdiText(dd: SdiTable | null, bom = false): string {
  const arr = dd === null ? [] : [{ type: 1, object: { dd_object: dd } }]
  return (bom ? "\uFEFF" : "") + JSON.stringify(arr)
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

  it("生成列输出 GENERATED ALWAYS AS ... STORED 并还原转义单引号", () => {
    const warnings: string[] = []
    const col: SdiColumn = { name: "g", column_type_utf8: "int", generation_expression_utf8: "\\'y\\'" }
    expect(buildColumn(col, table(), warnings)).toBe("  `g` int GENERATED ALWAYS AS ('y') STORED")
    expect(warnings).toHaveLength(0)
  })

  it("非空生成列追加 NOT NULL", () => {
    const warnings: string[] = []
    const col: SdiColumn = { name: "g", column_type_utf8: "int", is_nullable: false, generation_expression_utf8: "`a`+1" }
    expect(buildColumn(col, table(), warnings)).toBe("  `g` int GENERATED ALWAYS AS (`a`+1) STORED NOT NULL")
  })

  it("未知列级 collation 记录告警", () => {
    const warnings: string[] = []
    const col: SdiColumn = { name: "s", column_type_utf8: "varchar(10)", is_explicit_collation: true, collation_id: 999, has_no_default: true }
    expect(buildColumn(col, table({ schema_ref: "db" }), warnings)).toBe("  `s` varchar(10)")
    expect(warnings).toEqual(["未知列级 collation_id=999（db.t.s）"])
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

  it("唯一 / 全文 / 空间索引关键字", () => {
    const dd = table({ columns: [{ name: "a" }] })
    expect(buildIndex({ name: "u", type: 2, elements: [{ column_opx: 0 }] }, dd, "db", "t", [])).toBe("  UNIQUE KEY `u` (`a`)")
    expect(buildIndex({ name: "f", type: 4, elements: [{ column_opx: 0 }] }, dd, "db", "t", [])).toBe("  FULLTEXT KEY `f` (`a`)")
    expect(buildIndex({ name: "s", type: 5, elements: [{ column_opx: 0 }] }, dd, "db", "t", [])).toBe("  SPATIAL KEY `s` (`a`)")
  })

  it("未知索引类型记录告警并退回 KEY", () => {
    const warnings: string[] = []
    const dd = table({ columns: [{ name: "a" }] })
    expect(buildIndex({ name: "x", type: 9, elements: [{ column_opx: 0 }] }, dd, "db", "t", warnings)).toBe("  KEY `x` (`a`)")
    expect(warnings).toEqual(["未知索引类型 type=9（db.t.x）"])
  })

  it("缺列下标（undefined）按越界处理", () => {
    const warnings: string[] = []
    const dd = table({ columns: [{ name: "a" }] })
    expect(buildIndex({ name: "x", type: 3, elements: [{ ordinal_position: 2 }] }, dd, "db", "t", warnings)).toBe("  KEY `x` (``)")
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

  it("未知行格式与表级排序规则记录告警", () => {
    const warnings: string[] = []
    const dd = table({ engine: "InnoDB", row_format: 99, collation_id: 999, columns: [], indexes: [] })
    const sql = buildCreateTable(dd, "testdb", "t", warnings)
    expect(sql).toBe("CREATE TABLE `t` (\n\n)\nENGINE=InnoDB;")
    expect(warnings).toEqual(["未知 row_format=99（testdb.t）", "未知表级 collation_id=999（testdb.t）"])
  })

  it("表注释转义后写入尾部属性", () => {
    const dd = table({ engine: "InnoDB", row_format: 2, collation_id: 255, comment: "a'b", columns: [], indexes: [] })
    expect(buildCreateTable(dd, "db", "t", [])).toContain("COMMENT='a''b';")
  })
})

describe("extractInnodbSdi / loadMyisamSdi", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "opsbox-sdi-"))
    h.execFileSync.mockReset()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("缓存未命中时经 ibd2sdi 提取并剥离 BOM，同时写缓存", () => {
    const lib = join(root, "data", "testdb")
    mkdirSync(lib, { recursive: true })
    const ibd = join(lib, "t1.ibd")
    writeFileSync(ibd, "")
    const cacheDir = join(root, "cache")
    h.execFileSync.mockReturnValue(sdiText({ name: "real_t", engine: "InnoDB" }, true))

    const dd = extractInnodbSdi(ibd, cacheDir, "ibd2sdi")

    expect(dd?.name).toBe("real_t")
    expect(h.execFileSync).toHaveBeenCalledWith("ibd2sdi", [ibd], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    expect(existsSync(join(cacheDir, "testdb__t1.json"))).toBe(true)
  })

  it("缓存命中时不再调用 ibd2sdi", () => {
    const lib = join(root, "data", "testdb")
    mkdirSync(lib, { recursive: true })
    const ibd = join(lib, "t1.ibd")
    writeFileSync(ibd, "")
    const cacheDir = join(root, "cache")
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, "testdb__t1.json"), sdiText({ name: "cached_t" }))

    const dd = extractInnodbSdi(ibd, cacheDir, "ibd2sdi")

    expect(dd?.name).toBe("cached_t")
    expect(h.execFileSync).not.toHaveBeenCalled()
  })

  it("无 type=1 条目返回 null", () => {
    const lib = join(root, "data", "testdb")
    mkdirSync(lib, { recursive: true })
    const ibd = join(lib, "t1.ibd")
    writeFileSync(ibd, "")
    h.execFileSync.mockReturnValue(sdiText(null))

    expect(extractInnodbSdi(ibd, join(root, "cache"), "ibd2sdi")).toBeNull()
  })

  it("loadMyisamSdi 直读 .sdi 内 dd_object", () => {
    const file = join(root, "m_t.sdi")
    writeFileSync(file, JSON.stringify({ dd_object: { name: "my_t" } }))
    expect(loadMyisamSdi(file)?.name).toBe("my_t")
  })
})

describe("collectTables", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "opsbox-collect-"))
    h.execFileSync.mockReset()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("过滤系统库与 # 目录，按 only 收窄，并识别 InnoDB / MyISAM 两类表", () => {
    const data = join(root, "data")
    for (const lib of ["testdb", "mysql", "sys", "performance_schema", "information_schema", "other", "#temp"]) {
      mkdirSync(join(data, lib), { recursive: true })
    }
    writeFileSync(join(data, "testdb", "t1.ibd"), "")
    writeFileSync(join(data, "testdb", "t2.sdi"), JSON.stringify({ dd_object: { name: "my_t", engine: "MyISAM" } }))
    writeFileSync(join(data, "other", "o1.ibd"), "")
    writeFileSync(join(data, "mysql", "s1.ibd"), "")
    h.execFileSync.mockReturnValue(sdiText({ name: "real_t", engine: "InnoDB" }))

    const warnings: string[] = []
    const entries = collectTables(data, ["testdb"], options(root, data), warnings)

    expect(entries.map((e) => `${e.lib}.${e.name}:${e.kind}`)).toEqual(["testdb.real_t:innodb", "testdb.my_t:myisam"])
    expect(entries[1]?.dataFiles).toEqual([join(data, "testdb", "my_t.MYD"), join(data, "testdb", "my_t.MYI")])
    expect(warnings).toHaveLength(0)
  })

  it("ibd2sdi 取不到表定义时记告警并跳过该表", () => {
    const data = join(root, "data")
    mkdirSync(join(data, "testdb"), { recursive: true })
    writeFileSync(join(data, "testdb", "t1.ibd"), "")
    h.execFileSync.mockReturnValue(sdiText(null))

    const warnings: string[] = []
    const entries = collectTables(data, [], options(root, data), warnings)

    expect(entries).toHaveLength(0)
    expect(warnings).toEqual(["未能从 ibd2sdi 取得表定义（testdb.t1.ibd）"])
  })
})

describe("generateDdl", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "opsbox-ddl-"))
    h.execFileSync.mockReset()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("数据目录不存在时抛错", () => {
    expect(() => generateDdl(options(root, join(root, "missing")))).toThrow(/数据目录不存在/)
  })

  it("逐表写出 DDL、库级语句与 manifest 清单", () => {
    const data = join(root, "data")
    mkdirSync(join(data, "testdb"), { recursive: true })
    writeFileSync(join(data, "testdb", "t1.ibd"), "")
    writeFileSync(
      join(data, "testdb", "t2.sdi"),
      JSON.stringify({
        dd_object: {
          name: "my_t",
          engine: "MyISAM",
          row_format: 2,
          collation_id: 255,
          columns: [{ name: "id", column_type_utf8: "int", hidden: 1 }],
          indexes: []
        }
      })
    )
    h.execFileSync.mockReturnValue(
      sdiText({
        name: "inno_t",
        engine: "InnoDB",
        row_format: 2,
        collation_id: 45,
        columns: [{ name: "id", column_type_utf8: "int", hidden: 1 }],
        indexes: [{ name: "PRIMARY", type: 1, elements: [{ column_opx: 0 }] }]
      })
    )

    const opts = options(root, data)
    const manifest = generateDdl(opts)

    expect(manifest.tableCount).toBe(2)
    expect(manifest.libs).toEqual(["testdb"])
    expect(existsSync(join(opts.outDir, "ddl", "testdb", "inno_t.sql"))).toBe(true)
    expect(existsSync(join(opts.outDir, "ddl", "testdb", "my_t.sql"))).toBe(true)
    expect(readFileSync(join(opts.outDir, "ddl", "_databases.sql"), "utf8")).toContain("CREATE DATABASE IF NOT EXISTS `testdb`")
    expect(readFileSync(join(opts.outDir, "manifest.json"), "utf8")).toContain('"schemaVersion": 1')
  })
})
