// 路径 / URI 文本处理：VS Code 系宿主以 file URI 记录工作区位置，改写前须精确构造与匹配旧 URI
import { basename } from "node:path"

// ---------- 函数（按英文首字母排序） ----------

/**
 * 逐段编码 posix 路径（保留 / 作为分隔符）。
 * @param posix 以 / 分隔的绝对路径
 * @return 编码后的路径
 */
function encodePathSegments(posix: string): string {
  return posix.split("/").map(encodeSegment).join("/")
}

/**
 * 对单个路径段做 URI 编码（同 encodeURIComponent，并额外编码 !'()*）。
 * @param segment 单个路径段
 * @return 编码后的段
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * 转义正则元字符，用于把字面量 URI 构造成匹配模式。
 * @param value 字面量文本
 * @return 转义后的文本
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * 构造路径在宿主状态库中可能出现的字面量形态（去重）：
 * 分隔符（反斜杠 / 正斜杠）× 盘符大小写 × 整体大小写 × JSON 转义，另补 URI path 与 file URI。
 * @param absPath 绝对路径
 * @return 形态数组
 * @example pathForms("D:\\proj\\app") // ["D:\\proj\\app", "D:/proj/app", "d:\\proj\\app", ..., "file:///d%3A/proj/app"]
 */
export function pathForms(absPath: string): string[] {
  return [...new Set(pathStyleForms(absPath))]
}

/**
 * 取路径的目录名（末段）。
 * @param p 路径
 * @return 末段名
 */
export function pathName(p: string): string {
  return basename(p)
}

/**
 * 生成路径的全部形态（同序、未去重，供新旧路径逐一对位替换）。
 * 同一算法对两条 Windows 路径产出的长度恒等，故可直接按下标配对。
 * @param absPath 绝对路径
 * @return 形态数组
 */
function pathStyleForms(absPath: string): string[] {
  const forms: string[] = []
  const drive = /^([A-Za-z]):/.exec(absPath)
  if (!drive) {
    forms.push(absPath, absPath.replace(/\\/g, "/"))
    forms.push(toFileUri(absPath))
    return forms
  }
  const letter = drive[1] ?? ""
  const body = absPath.slice(2)
  for (const driveCase of [letter, letter.toLowerCase(), letter.toUpperCase()]) {
    for (const sep of ["\\", "/"]) {
      const form = `${driveCase}:${body.replace(/[\\/]/g, sep)}`
      forms.push(form, form.toUpperCase())
      // 反斜杠形态再补 JSON 转义（单个 \ 变 \\），对应状态库中双反斜杠的存储形态
      if (sep === "\\") forms.push(form.replace(/\\/g, "\\\\"))
    }
  }
  const posix = absPath.replace(/\\/g, "/")
  // URI path 形态：小写盘符 + 正斜杠 + 前导斜杠（对应部分宿主键值，如 /d:/proj/app）
  forms.push(`/${letter.toLowerCase()}${posix.slice(1)}`)
  forms.push(toFileUri(absPath))
  return forms
}

/**
 * 按字面量做全局替换（右边界断言避免误伤以旧串为前缀的更长路径；替换串中的 $ 二次转义）。
 * @param text 原始文本
 * @param from 待替换字面量
 * @param to 目标字面量
 * @return 替换后的文本
 */
function replaceLiteral(text: string, from: string, to: string): string {
  const pattern = new RegExp(`${escapeRegExp(from)}(?![A-Za-z0-9._~%-])`, "g")
  return text.replace(pattern, to.replace(/\$/g, "$$$$"))
}

/**
 * 把文本中旧路径的各形态全量替换为新路径对应形态（覆盖反斜杠 / 正斜杠、盘符大小写、全大写、JSON 转义、file URI）。
 * @param text 原始文本
 * @param oldPath 旧绝对路径
 * @param newPath 新绝对路径
 * @return 替换后的文本
 */
export function replacePaths(text: string, oldPath: string, newPath: string): string {
  const olds = pathStyleForms(oldPath)
  const news = pathStyleForms(newPath)
  if (olds.length !== news.length) return text
  let result = text
  for (let i = 0; i < olds.length; i += 1) {
    const from = olds[i]
    const to = news[i]
    if (from === undefined || to === undefined || from === to) continue
    result = replaceLiteral(result, from, to)
  }
  return result
}

/**
 * 把文本中的旧 URI 全量替换为新 URI（右边界断言避免误伤以旧 URI 为前缀的更长子路径）。
 * @param text 原始文本
 * @param oldUri 旧 file URI
 * @param newUri 新 file URI
 * @return 替换后的文本
 */
export function replaceUri(text: string, oldUri: string, newUri: string): string {
  return replaceLiteral(text, oldUri, newUri)
}

/**
 * 把绝对路径转换为 VS Code 系 file URI（Windows 盘符小写、冒号编码为 %3A）。
 * @param absPath 绝对路径（Windows 可含反斜杠）
 * @return file URI
 * @example toFileUri("D:\\proj\\app") // "file:///d%3A/proj/app"
 */
export function toFileUri(absPath: string): string {
  const posix = absPath.replace(/\\/g, "/")
  const drive = /^([A-Za-z]):/.exec(posix)
  if (drive) {
    const letter = drive[1] ?? ""
    return `file:///${letter.toLowerCase()}%3A${encodePathSegments(posix.slice(2))}`
  }
  return `file://${encodePathSegments(posix)}`
}
