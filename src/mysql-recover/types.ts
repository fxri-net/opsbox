// mysql-recover 定义集合：SDI 原始结构、目录条目、运行参数与产物清单
// SDI 字段随 MySQL 版本增减，此处只声明还原 DDL 所需字段，其余经索引签名原样兼容

/** SDI 列对象（仅 DDL 还原所需字段） */
export interface SdiColumn {
  /** 列名 */
  name: string
  /** 列类型原文（如 int unsigned / varchar(64)） */
  column_type_utf8?: string
  /** 是否显式指定过排序规则 */
  is_explicit_collation?: boolean
  /** 列级排序规则编号 */
  collation_id?: number
  /** 生成列表达式（单引号被反斜杠转义） */
  generation_expression_utf8?: string | null
  /** 是否可空 */
  is_nullable?: boolean
  /** 是否自增 */
  is_auto_increment?: boolean
  /** 列注释 */
  comment?: string
  /** 默认值是否为 NULL */
  default_value_null?: boolean
  /** 无默认值（default_value_utf8 为字面 "NULL" 字符） */
  default_value_utf8_null?: boolean
  /** 默认值文本 */
  default_value_utf8?: string
  /** 无默认值标记 */
  has_no_default?: boolean
  /** 隐藏标记（1 为用户可见列） */
  hidden?: number
  /** 其余字段原样保留 */
  [key: string]: unknown
}

/** SDI 索引元素 */
export interface SdiIndexElement {
  /** 隐藏标记 */
  hidden?: boolean
  /** 指向表级 columns 数组的下标 */
  column_opx?: number
  /** 元素序号 */
  ordinal_position?: number
  /** 其余字段原样保留 */
  [key: string]: unknown
}

/** SDI 索引对象 */
export interface SdiIndex {
  /** 索引名 */
  name: string
  /** 隐藏标记（唯一约束隐式索引等） */
  hidden?: boolean
  /** 索引类型枚举 */
  type?: number
  /** 索引元素集合 */
  elements?: SdiIndexElement[]
  /** 其余字段原样保留 */
  [key: string]: unknown
}

/** SDI 表级对象 */
export interface SdiTable {
  /** 表名（真实表名以此为准，非文件名） */
  name: string
  /** 所属库名 */
  schema_ref?: string
  /** 存储引擎 */
  engine?: string
  /** 行格式枚举 */
  row_format?: number
  /** 表级排序规则编号 */
  collation_id?: number
  /** 表注释 */
  comment?: string
  /** 引擎私有数据（含 autoinc=N） */
  se_private_data?: string
  /** 列集合 */
  columns?: SdiColumn[]
  /** 索引集合 */
  indexes?: SdiIndex[]
  /** 其余字段原样保留 */
  [key: string]: unknown
}

/** 数据目录中的一张待还原表 */
export interface TableEntry {
  /** 库名 */
  lib: string
  /** 表名（取自 SDI 内 dd_object.name） */
  name: string
  /** 存储引擎类别 */
  kind: "innodb" | "myisam"
  /** 数据文件集合（InnoDB 为 .ibd；MyISAM 为 .MYD/.MYI） */
  dataFiles: string[]
  /** MyISAM 的 .sdi 文件路径（InnoDB 为空串） */
  sdiFile: string
}

/** DDL 生成运行参数 */
export interface DdlOptions {
  /** MySQL 数据目录 */
  dataDir: string
  /** 产物输出目录 */
  outDir: string
  /** ibd2sdi 可执行文件路径 */
  ibd2sdiExe: string
  /** ibd2sdi 结果缓存目录 */
  cacheDir: string
  /** 仅处理的库（空数组表示全部） */
  only: string[]
}

/** 清单中的单表条目 */
export interface ManifestTable {
  /** 库名 */
  lib: string
  /** 表名 */
  name: string
  /** 引擎类别 */
  kind: "innodb" | "myisam"
  /** 存储引擎 */
  engine: string
  /** 行格式关键字 */
  rowFormat: string
  /** 排序规则名 */
  collation: string
  /** 字符集名 */
  charset: string
  /** 可见列数 */
  columnCount: number
  /** 可见索引数 */
  indexCount: number
  /** 相对产物的 DDL 文件路径（posix 分隔） */
  ddl: string
  /** 数据文件集合 */
  dataFiles: string[]
  /** MyISAM 的 .sdi 路径 */
  sdiFile: string
}

/** DDL 生成产物清单 */
export interface Manifest {
  /** 生成时间（ISO） */
  generatedAt: string
  /** 数据目录 */
  dataDir: string
  /** 涉及库名集合（有序） */
  libs: string[]
  /** 表条目数 */
  tableCount: number
  /** 表条目集合 */
  tables: ManifestTable[]
  /** 运行期告警 */
  warnings: string[]
}
