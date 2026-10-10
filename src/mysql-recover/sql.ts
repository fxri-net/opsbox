// MySQL SQL 字面量工具：标识符与字符串转义集中于此，保证各语句写法一致

/**
 * 转义 SQL 标识符（反引号内）。
 * @param name 原始标识符
 * @return 转义后标识符
 * @example quoteIdent("a`b") // "a``b"
 */
export function quoteIdent(name: string): string {
  return String(name).replace(/`/g, "``")
}

/**
 * 转义 SQL 字符串字面量（反斜杠与单引号）。
 * @param text 原始字符串
 * @return 转义后字符串
 * @example quoteStr("it's") // "it''s"
 */
export function quoteStr(text: string): string {
  return String(text).replace(/\\/g, "\\\\").replace(/'/g, "''")
}

/**
 * 还原生成列表达式：SDI 中单引号被反斜杠转义，需去转义后方可写入 DDL。
 * @param expr generation_expression_utf8
 * @return 可直接写入 DDL 的表达式，无生成列时返回空串
 */
export function restoreGenerationExpr(expr: string | null | undefined): string {
  const text = String(expr ?? "").trim()
  if (!text) return ""
  return text.replace(/\\'/g, "'")
}
