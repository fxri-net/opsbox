// mysql-recover 能力出口：从重装后遗留的数据目录恢复 MySQL 库
// 外部只从此处引用本能力；子模块为内部实现细节，避免外部耦合
export { registerMysqlRecover } from "./command"
export { recover } from "./recover"
export type { RecoverContext, RecoverOptions, RecoverPlan } from "./recover"
export { generateDdl } from "./sdi-to-ddl"
export { resolveTool, MysqlClient } from "./mysql-client"
export type { MysqlClientOptions, MysqlExecOptions } from "./mysql-client"
export { Reporter } from "./report"
export type { ReportLevel } from "./report"
export { quoteIdent, quoteStr, restoreGenerationExpr } from "./sql"
export type { DdlOptions, Manifest, ManifestTable, SdiColumn, SdiIndex, SdiIndexElement, SdiTable, TableEntry } from "./types"
