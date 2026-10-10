// 机器可读 JSON 统一序列化：前置 schemaVersion 锚点，供各能力的 --format json 共用
// 消费方可据 schemaVersion 判断结构版本

// 序列化载荷为带 schemaVersion 锚点的 JSON 文本（缩进 2，锚点先于载荷字段）
export function toJsonText(payload: object): string {
  return JSON.stringify({ schemaVersion: 1, ...payload }, null, 2)
}

// 打印机器可读 JSON 到 stdout：各能力 --format json 的统一出口（stdout 专用通道，诊断一律走 stderr）
export function printJson(payload: object): void {
  console.log(toJsonText(payload))
}

// 校验 --format 取值：仅支持 json，非法值告警并置退出码 1；返回 false 时调用方直接 return
export function assertJsonFormat(format: string | undefined): boolean {
  if (format && format !== "json") {
    console.error(`⚠️ 不支持的输出格式「${format}」，仅支持 json`)
    process.exitCode = 1
    return false
  }
  return true
}
