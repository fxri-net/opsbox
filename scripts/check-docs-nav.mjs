// 文档站导航规范校验：标准来源 playbook fxri-docs-profile 0.1.0
// 规则：顶栏不超过 5 项、首项快速开始、末项帮助、帮助含常见问题与更新日志、一级项与侧栏分组名不超过 4 个汉字、404 页存在
// 体量告警：单页超过 300 行（排除 changelog.md）只提示不阻断
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const configFile = join(root, "docs", ".vitepress", "config.mts")
const config = readFileSync(configFile, "utf8")
const problems = []

// 截取以关键词起始、到结束标记为止的配置片段
function slice(startMarker, endMarker) {
  const from = config.indexOf(startMarker)
  if (from < 0) return ""
  const to = config.indexOf(endMarker, from)
  return config.slice(from, to < 0 ? config.length : to)
}

// 取片段中缩进最浅的 `{` 作为一级项，再取该条目首个 text：同级下拉项的 text 在下一行、直链的 text 与 `{` 同行
function topTexts(source) {
  const lines = source.split("\n")
  const starts = []
  for (let index = 0; index < lines.length; index++) {
    const matched = /^(\s*)\{/.exec(lines[index])
    if (matched) starts.push({ indent: matched[1].length, line: index })
  }
  if (starts.length === 0) return []
  const min = Math.min(...starts.map((item) => item.indent))
  const tops = starts.filter((item) => item.indent === min)
  const texts = []
  for (let index = 0; index < tops.length; index++) {
    const from = tops[index].line
    const to = index + 1 < tops.length ? tops[index + 1].line : lines.length
    const matched = /text:\s*["']([^"']+)["']/.exec(lines.slice(from, to).join("\n"))
    if (matched) texts.push(matched[1])
  }
  return texts
}

// 汉字计数：英文专有名词（CLI / API）不计入
const hanCount = (text) => [...text].filter((ch) => /[\u4e00-\u9fa5]/.test(ch)).length

const nav = topTexts(slice("nav: [", "sidebar: ["))
const sidebar = topTexts(slice("sidebar: [", "search:"))
// 生成式侧栏（如由 JSON 注入）一并纳入分组名校验
const sidebarJson = join(root, "docs", "sidebar.json")
if (existsSync(sidebarJson)) {
  for (const group of JSON.parse(readFileSync(sidebarJson, "utf8"))) {
    if (group && typeof group.text === "string") sidebar.push(group.text)
  }
}

if (nav.length === 0) problems.push("未解析到顶栏一级项")
if (nav.length > 5) problems.push(`顶栏一级项 ${nav.length} 个，超过 5 个`)
if (nav[0] !== "快速开始") problems.push(`顶栏首项应为「快速开始」，实际「${nav[0] ?? "无"}」`)
if (nav[nav.length - 1] !== "帮助") problems.push(`顶栏末项应为「帮助」，实际「${nav[nav.length - 1] ?? "无"}」`)

// 帮助下拉必须包含常见问题与更新日志
const helpMatch = /text:\s*["']帮助["']/.exec(config)
const helpBlock = helpMatch ? config.slice(helpMatch.index, config.indexOf("]", helpMatch.index)) : ""
for (const item of ["常见问题", "更新日志"]) {
  if (!helpBlock.includes(item)) problems.push(`帮助下拉缺少「${item}」`)
}

for (const name of [...nav, ...sidebar]) {
  if (hanCount(name) > 4) problems.push(`分组名「${name}」超过 4 个汉字`)
}

if (!existsSync(join(root, "docs", "404.md"))) problems.push("缺少 docs/404.md 兜底页")

// 页面体量告警：只提示不阻断，提醒后续拆分
function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, found)
    else if (entry.name.endsWith(".md")) found.push(full)
  }
  return found
}
for (const page of walk(join(root, "docs"))) {
  if (page.endsWith("changelog.md")) continue
  const lines = readFileSync(page, "utf8").split("\n").length
  if (lines > 300) console.warn(`[docs] 页面超过 300 行：${relative(root, page)}（${lines} 行）`)
}

if (problems.length > 0) {
  console.error(`文档站导航规范校验失败：${problems.length} 项`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`文档站导航规范校验通过：顶栏 ${nav.length} 项、侧栏 ${sidebar.length} 组`)
