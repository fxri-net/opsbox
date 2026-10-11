// SDI → DDL 生成器（原 sdi-to-ddl.mjs 的 TypeScript 迁移版）
// 用途：从 MySQL 8.0 的 SDI（序列化字典信息）还原 CREATE TABLE，用于重装后孤儿
//       .ibd / .MYD+.MYI 的字典重建。
// 读取：data 目录下 InnoDB 的 <表>.ibd（经 ibd2sdi 提取）与 MyISAM 的 <名>_<id>.sdi
// 输出：<out>/ddl/<库>/<表>.sql、<out>/ddl/_databases.sql、<out>/manifest.json
// 约束：只读 data 目录、只写 outDir，不触碰数据库实例
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join, posix } from "node:path"
import { localDateTime } from "../date"
import { readTextFile, stripBom } from "../read-text"
import { writeFileAtomic } from "../write-atomic"
import { toJsonText } from "../json-output"
import { quoteIdent, quoteStr, restoreGenerationExpr } from "./sql"
import type { DdlOptions, Manifest, ManifestTable, SdiColumn, SdiIndex, SdiTable, TableEntry } from "./types"

// ---------- 常量 ----------

/** 系统库（不参与还原） */
const SYSTEM_LIBS = new Set(["mysql", "sys", "performance_schema", "information_schema"])

/** collation_id → [字符集, 排序规则]，取自 information_schema.COLLATIONS */
const COLLATIONS: Record<number, readonly [string, string]> = {
  1: ["big5", "big5_chinese_ci"],
  8: ["latin1", "latin1_swedish_ci"],
  11: ["ascii", "ascii_general_ci"],
  28: ["gbk", "gbk_chinese_ci"],
  33: ["utf8mb3", "utf8mb3_general_ci"],
  45: ["utf8mb4", "utf8mb4_general_ci"],
  46: ["utf8mb4", "utf8mb4_bin"],
  63: ["binary", "binary"],
  83: ["utf8mb3", "utf8mb3_bin"],
  192: ["utf8mb3", "utf8mb3_unicode_ci"],
  224: ["utf8mb4", "utf8mb4_unicode_ci"],
  248: ["gb18030", "gb18030_chinese_ci"],
  255: ["utf8mb4", "utf8mb4_0900_ai_ci"]
}

/** row_format 枚举 → DDL 关键字 */
const ROW_FORMATS: Record<number, string> = { 1: "FIXED", 2: "DYNAMIC", 3: "COMPRESSED", 4: "REDUNDANT", 5: "COMPACT", 6: "PAGED" }

/** index type 枚举 → DDL 前缀 */
const INDEX_TYPES: Record<number, string> = { 1: "PRIMARY", 2: "UNIQUE", 3: "KEY", 4: "FULLTEXT", 5: "SPATIAL" }

/** 字符串类列类型（需输出 CHARACTER SET / COLLATE） */
const STRING_TYPE_RE = /^(char|varchar|tinytext|text|mediumtext|longtext|enum|set)\b/i

/** 数值类列类型（DEFAULT 字面量不加引号） */
const NUMERIC_TYPE_RE = /^(int|integer|tinyint|smallint|mediumint|bigint|decimal|numeric|float|double|real|bit)\b/i

// ---------- 函数（按英文首字母排序） ----------

/**
 * 生成单列定义。
 * @param col SDI 列对象
 * @param dd 表级对象（用于比对表级排序规则）
 * @param warnings 告警收集器
 * @return 形如 "  `name` int NOT NULL COMMENT 'x'"
 */
function buildColumn(col: SdiColumn, dd: SdiTable, warnings: string[]): string {
  const type = String(col.column_type_utf8 || "")
  let text = `  \`${quoteIdent(col.name)}\` ${type}`

  // 字符串类列：显式指定过排序规则，或与表级不同 → 输出字符集与排序规则
  if (STRING_TYPE_RE.test(type) && (col.is_explicit_collation || col.collation_id !== dd.collation_id)) {
    const cs = col.collation_id === undefined ? undefined : COLLATIONS[col.collation_id]
    if (cs) {
      text += ` CHARACTER SET ${cs[0]} COLLATE ${cs[1]}`
    } else {
      warnings.push(`未知列级 collation_id=${col.collation_id}（${dd.schema_ref}.${dd.name}.${col.name}）`)
    }
  }

  const genExpr = restoreGenerationExpr(col.generation_expression_utf8)
  if (genExpr) {
    // 生成列：MySQL 规范化为 GENERATED ALWAYS AS (expr) STORED
    text += ` GENERATED ALWAYS AS (${genExpr}) STORED`
    if (col.is_nullable === false) text += " NOT NULL"
  } else {
    if (col.is_nullable === false) text += " NOT NULL"
    const def = buildDefault(col)
    if (def) text += ` ${def}`
    if (col.is_auto_increment) text += " AUTO_INCREMENT"
  }

  if (col.comment) text += ` COMMENT '${quoteStr(col.comment)}'`
  return text
}

/**
 * 生成完整建表语句。
 * @param dd 表级对象
 * @param lib 库名
 * @param name 表名
 * @param warnings 告警收集器
 * @return CREATE TABLE 语句（含末尾分号）
 */
function buildCreateTable(dd: SdiTable, lib: string, name: string, warnings: string[]): string {
  const cols = (dd.columns || []).filter((c) => c.hidden === 1)
  const idxs = (dd.indexes || []).filter((ix) => !ix.hidden)

  const defs = cols.map((c) => buildColumn(c, dd, warnings))
  for (const ix of idxs) defs.push(buildIndex(ix, dd, lib, name, warnings))

  const parts = [`CREATE TABLE \`${quoteIdent(name)}\` (`, defs.join(",\n"), ")"]

  // 落地表属性：引擎、行格式、字符集
  let tail = `ENGINE=${dd.engine}`
  const rf = dd.row_format === undefined ? undefined : ROW_FORMATS[dd.row_format]
  if (rf) {
    tail += ` ROW_FORMAT=${rf}`
  } else {
    warnings.push(`未知 row_format=${dd.row_format}（${lib}.${name}）`)
  }
  const cs = dd.collation_id === undefined ? undefined : COLLATIONS[dd.collation_id]
  if (cs) {
    tail += ` DEFAULT CHARSET=${cs[0]} COLLATE=${cs[1]}`
  } else {
    warnings.push(`未知表级 collation_id=${dd.collation_id}（${lib}.${name}）`)
  }

  // InnoDB 自增计数器保存在数据字典，建表时带回以免回填后计数器归零
  const autoinc = /autoinc=(\d+)/.exec(String(dd.se_private_data || ""))
  if (autoinc && autoinc[1] !== "0") tail += ` AUTO_INCREMENT=${autoinc[1]}`
  if (dd.comment) tail += ` COMMENT='${quoteStr(dd.comment)}'`
  tail += ";"

  parts.push(tail)
  return parts.join("\n")
}

/**
 * 生成单列默认值子句。
 * @param col SDI 列对象
 * @return 形如 "DEFAULT '0'" / "DEFAULT NULL"，无默认值时返回空串
 */
function buildDefault(col: SdiColumn): string {
  if (col.is_auto_increment) return ""
  if (col.has_no_default) return ""
  if (col.default_value_null) return "DEFAULT NULL"
  if (col.default_value_utf8_null) return ""
  const raw = String(col.default_value_utf8)
  const type = String(col.column_type_utf8 || "")
  if (NUMERIC_TYPE_RE.test(type)) return `DEFAULT ${raw}`
  return `DEFAULT '${quoteStr(raw)}'`
}

/**
 * 生成单条索引定义。
 * @param ix SDI 索引对象
 * @param dd 表级对象
 * @param lib 库名
 * @param name 表名
 * @param warnings 告警收集器
 * @return 形如 "  PRIMARY KEY (`id`)" / "  KEY `k` (`a`)"
 */
function buildIndex(ix: SdiIndex, dd: SdiTable, lib: string, name: string, warnings: string[]): string {
  const keys = (ix.elements || [])
    .filter((e) => !e.hidden)
    .map((e) => {
      const col = e.column_opx === undefined ? undefined : (dd.columns || [])[e.column_opx]
      if (!col) {
        warnings.push(`索引元素越界（${lib}.${name}.${ix.name}#${e.ordinal_position}）`)
        return "``"
      }
      return `\`${quoteIdent(col.name)}\``
    })
    .join(",")

  const type = ix.type === undefined ? undefined : INDEX_TYPES[ix.type]
  if (type === "PRIMARY") return `  PRIMARY KEY (${keys})`
  if (type === "UNIQUE") return `  UNIQUE KEY \`${quoteIdent(ix.name)}\` (${keys})`
  if (type === "KEY") return `  KEY \`${quoteIdent(ix.name)}\` (${keys})`
  if (type === "FULLTEXT") return `  FULLTEXT KEY \`${quoteIdent(ix.name)}\` (${keys})`
  if (type === "SPATIAL") return `  SPATIAL KEY \`${quoteIdent(ix.name)}\` (${keys})`
  warnings.push(`未知索引类型 type=${ix.type}（${lib}.${name}.${ix.name}）`)
  return `  KEY \`${quoteIdent(ix.name)}\` (${keys})`
}

/**
 * 归类列类型（用于默认值加引号策略与报表统计）。
 * @param type column_type_utf8
 * @return 类型分类名
 */
function catType(type: string | undefined): string {
  const text = String(type || "")
  if (/^enum\b/i.test(text)) return "enum"
  if (/^set\b/i.test(text)) return "set"
  if (/^(char|varchar|tinytext|text|mediumtext|longtext)/i.test(text)) return "string"
  if (/^(varbinary|binary|tinyblob|blob|mediumblob|longblob)/i.test(text)) return "blob"
  if (/^bit\b/i.test(text)) return "bit"
  if (/^(decimal|numeric)/i.test(text)) return "decimal"
  if (/^(float|double|real)/i.test(text)) return "float"
  if (/^(int|integer|tinyint|smallint|mediumint|bigint)/i.test(text)) return "int"
  if (/^(date|datetime|timestamp|time|year)/i.test(text)) return "temporal"
  if (/^json\b/i.test(text)) return "json"
  return "UNKNOWN:" + text
}

/**
 * 收集 data 目录下所有待还原表。
 * @param dataDir 数据目录
 * @param onlyLibs 仅处理的库（空数组表示全部）
 * @param opts 运行参数
 * @param warnings 告警收集器
 * @return 表条目集合
 */
function collectTables(dataDir: string, onlyLibs: string[], opts: DdlOptions, warnings: string[]): TableEntry[] {
  const out: TableEntry[] = []
  const libs = readdirSync(dataDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("#") && !SYSTEM_LIBS.has(d.name))
    .map((d) => d.name)
    .filter((n) => onlyLibs.length === 0 || onlyLibs.includes(n))
    .sort()

  for (const lib of libs) {
    const dir = join(dataDir, lib)
    // InnoDB：表名不能取 .ibd 文件名——含特殊字符时文件名是 MySQL 的编码形式
    //（如 ~ → @007e、@ → @0040），必须以 SDI 内 dd_object.name 为准
    for (const f of readdirSync(dir)
      .filter((n) => n.endsWith(".ibd"))
      .sort()) {
      const ibdPath = join(dir, f)
      const dd = extractInnodbSdi(ibdPath, opts.cacheDir, opts.ibd2sdiExe)
      if (!dd) {
        warnings.push(`未能从 ibd2sdi 取得表定义（${lib}.${f}）`)
        continue
      }
      out.push({ lib, name: dd.name, kind: "innodb", dataFiles: [ibdPath], sdiFile: "" })
    }
    // MyISAM：.sdi 文件名可被截断，必须以内部 dd_object.name 为准
    for (const f of readdirSync(dir)
      .filter((n) => n.endsWith(".sdi"))
      .sort()) {
      const sdiPath = join(dir, f)
      const dd = loadMyisamSdi(sdiPath)
      if (!dd) continue
      out.push({
        lib,
        name: dd.name,
        kind: "myisam",
        dataFiles: [join(dir, `${dd.name}.MYD`), join(dir, `${dd.name}.MYI`)],
        sdiFile: sdiPath
      })
    }
  }
  return out
}

/**
 * 取 InnoDB 表的内嵌 SDI（经 ibd2sdi，带缓存）。
 * @param ibdPath .ibd 文件绝对路径
 * @param cacheDir 缓存目录
 * @param ibd2sdiExe ibd2sdi 可执行文件路径
 * @return 表级对象，失败返回 null
 */
function extractInnodbSdi(ibdPath: string, cacheDir: string, ibd2sdiExe: string): SdiTable | null {
  const lib = basename(dirname(ibdPath))
  const stem = basename(ibdPath, ".ibd")
  const cacheFile = join(cacheDir, `${lib}__${stem}.json`)
  let text: string
  if (existsSync(cacheFile)) {
    text = readTextFile(cacheFile)
  } else {
    // ibd2sdi 仅支持 stdout 输出，且内容带 UTF-8 BOM
    text = execFileSync(ibd2sdiExe, [ibdPath], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(cacheFile, text, "utf8")
  }
  const arr = JSON.parse(stripBom(text)) as Array<{ type?: number; object?: { dd_object?: SdiTable } }>
  const table = arr.find((e) => e.type === 1)
  return table?.object?.dd_object ?? null
}

/**
 * 生成 DDL 产物（模块入口）。
 * @param opts 运行参数
 * @return 产物清单
 * @example const manifest = generateDdl({ dataDir, outDir, ibd2sdiExe, cacheDir, only: [] })
 */
export function generateDdl(opts: DdlOptions): Manifest {
  if (!existsSync(opts.dataDir)) {
    throw new Error(`数据目录不存在：${opts.dataDir}`)
  }
  const warnings: string[] = []
  const tables = collectTables(opts.dataDir, opts.only, opts, warnings)
  return writeOutputs(tables, opts, warnings)
}

/**
 * 直读 MyISAM 的 .sdi。
 * @param sdiPath .sdi 文件绝对路径
 * @return 表级对象，失败返回 null
 */
function loadMyisamSdi(sdiPath: string): SdiTable | null {
  const obj = JSON.parse(readTextFile(sdiPath)) as { dd_object?: SdiTable }
  return obj?.dd_object ?? null
}

/**
 * 映射行格式枚举。
 * @param rf row_format 数值
 * @return DDL 关键字，未知时返回空串
 */
function mapRowFormat(rf: number | undefined): string {
  if (rf === undefined) return ""
  return ROW_FORMATS[rf] ?? ""
}

/**
 * 写盘：逐表 .sql、库语句、manifest 与报表。
 * @param tables 表条目集合
 * @param opts 运行参数
 * @param warnings 告警收集器
 * @return 产物清单
 */
function writeOutputs(tables: TableEntry[], opts: DdlOptions, warnings: string[]): Manifest {
  const { outDir, dataDir } = opts
  const ddlRoot = join(outDir, "ddl")
  rmSync(ddlRoot, { recursive: true, force: true })
  mkdirSync(ddlRoot, { recursive: true })

  const manifestTables: ManifestTable[] = []
  const libCharset = new Map<string, number | undefined>()

  for (const t of tables) {
    let dd: SdiTable | null
    if (t.kind === "innodb") {
      dd = extractInnodbSdi(t.dataFiles[0] ?? "", opts.cacheDir, opts.ibd2sdiExe)
      if (!dd) {
        warnings.push(`未能从 ibd2sdi 取得表定义（${t.lib}.${t.name}）`)
        continue
      }
    } else {
      dd = loadMyisamSdi(t.sdiFile)
      if (!dd) {
        warnings.push(`未能读取 .sdi（${t.lib}.${t.name}）`)
        continue
      }
    }

    const ddl = buildCreateTable(dd, t.lib, t.name, warnings)
    const libDir = join(ddlRoot, t.lib)
    mkdirSync(libDir, { recursive: true })
    const rel = posix.join("ddl", t.lib, `${t.name}.sql`)
    writeFileSync(join(outDir, rel), `-- ${t.lib}.${t.name} [${t.kind}]\n${ddl}\n`, "utf8")

    // 记录库级字符集：取该库首张表（按表名序）的表级排序规则
    if (!libCharset.has(t.lib)) libCharset.set(t.lib, dd.collation_id)

    const cs = dd.collation_id === undefined ? undefined : COLLATIONS[dd.collation_id]
    const cols = (dd.columns || []).filter((c) => c.hidden === 1)
    manifestTables.push({
      lib: t.lib,
      name: t.name,
      kind: t.kind,
      engine: String(dd.engine ?? ""),
      rowFormat: mapRowFormat(dd.row_format),
      collation: cs ? cs[1] : String(dd.collation_id),
      charset: cs ? cs[0] : "",
      columnCount: cols.length,
      indexCount: (dd.indexes || []).filter((ix) => !ix.hidden).length,
      ddl: rel,
      dataFiles: t.dataFiles,
      sdiFile: t.sdiFile
    })
  }

  // 库级建库语句
  const libs = [...libCharset.keys()].sort()
  const dbSql = libs
    .map((lib) => {
      const collationId = libCharset.get(lib)
      const cs = collationId === undefined ? undefined : COLLATIONS[collationId]
      const tail = cs ? ` DEFAULT CHARACTER SET ${cs[0]} COLLATE ${cs[1]}` : ""
      return `CREATE DATABASE IF NOT EXISTS \`${quoteIdent(lib)}\`${tail};`
    })
    .join("\n")
  writeFileSync(join(ddlRoot, "_databases.sql"), dbSql + "\n", "utf8")

  const manifest: Manifest = {
    generatedAt: localDateTime(),
    dataDir,
    libs,
    tableCount: manifestTables.length,
    tables: manifestTables,
    warnings
  }
  // manifest 是 restore 依赖的契约产物，走原子写避免半截文件被下游误读；经 toJsonText 携带 schemaVersion 锚点
  writeFileAtomic(join(outDir, "manifest.json"), toJsonText(manifest))
  return manifest
}

// 供外部复用的函数出口（模块入口 generateDdl 已就地导出）
export { buildColumn, buildCreateTable, buildDefault, buildIndex, catType, collectTables, extractInnodbSdi, loadMyisamSdi, mapRowFormat }
