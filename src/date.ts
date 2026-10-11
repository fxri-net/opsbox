// 本地时间取值单一入口
// 口径：按运行环境本地时区取墙上时间，不落 UTC ISO；各域重复实现易产生格式漂移，统一收敛到此
// 参照姊妹仓 @fxri/toolkit 的 src/date.ts 本地日期口径
const pad2 = (n: number): string => String(n).padStart(2, "0")

/**
 * 生成用于目录命名的紧凑时间戳 yyyyMMdd-HHmmss。
 * @return 时间戳文本
 */
export function folderStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

/**
 * 生成本地墙上时间文本 YYYY-MM-DD HH:mm:ss（人读字段用）。
 * @return 时间文本
 */
export function localDateTime(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
