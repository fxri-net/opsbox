import { spawn, spawnSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// 单一门禁真源：本仓库全部验收步骤由本脚本定义并按序执行，本地与三处 CI（GitHub check / windows、GitLab test）共用同一份清单。
// 目的：消除「各写一份步骤清单、彼此漂移」的结构性问题，使「本地自检通过、CI 才暴露」在清单层面不可能发生。
// 本文件不入 npm 包（files 白名单不含 scripts）
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const isWindows = process.platform === "win32"

const flags = new Set(process.argv.slice(2))
const skipCoverage = flags.has("--skip-coverage")
const skipDocs = flags.has("--skip-docs")
// --full 强制全量：忽略本地改动面、缓存与安装判断，等价于 CI 口径
const full = flags.has("--full")
// CI 环境一律全量：本地裁剪只服务于开发效率，不能让 CI 漏检安装与死链
const ciValue = process.env.CI ?? ""
const isCI = ciValue !== "" && ciValue !== "0" && ciValue.toLowerCase() !== "false"

// 文档站构建触发面：站点输入含文档正文与内链，站点配置直接引用源码侧信息，依赖清单决定构建工具版本
const DOC_TOUCH_PREFIXES = ["docs/", "src/"]
const DOC_TOUCH_FILES = new Set(["README.md", "package.json", "pnpm-lock.yaml"])

/**
 * 读取文本文件并去除首尾空白。
 * @param {string} file 绝对路径
 * @return {string} 去掉首尾空白后的内容
 */
function readTrimmed(file) {
  return readFileSync(file, "utf8").trim()
}

// 工具链版本仅作对照提示、不拦截：跨环境误判的常见疑点之一就是本地与 CI 的 node / pnpm 版本不同，先让人看见
function reportToolchain() {
  const { packageManager } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const expectedNode = readTrimmed(join(root, ".node-version"))
  const expectedPnpm = String(packageManager).replace(/^pnpm@/, "")
  const actualNode = process.version.replace(/^v/, "")
  const actualPnpm = (spawnSync("pnpm", ["--version"], { encoding: "utf8", shell: isWindows }).stdout ?? "").trim()

  console.log(`门禁校验：node ${actualNode}（仓库期望 ${expectedNode}）/ pnpm ${actualPnpm}（仓库期望 ${expectedPnpm}）`)
  if (actualNode !== expectedNode) {
    console.warn(`⚠️ node 版本与 .node-version 不一致：本地 ${actualNode}、CI ${expectedNode}`)
  }
  if (actualPnpm !== expectedPnpm) {
    console.warn(`⚠️ pnpm 版本与 packageManager 不一致：本地 ${actualPnpm}、仓库声明 ${expectedPnpm}`)
  }
}

/**
 * git 只读调用。
 * @param {string[]} args git 参数
 * @return {string[] | null} 输出行；失败返回 null（调用方按「可能触及」保守处理）
 */
function gitLines(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
  if (result.status !== 0) return null
  return (result.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

/**
 * 本次是否需要构建文档站。
 * @return {boolean} true 表示执行 docs:build
 */
function needDocsBuild() {
  if (isCI || full) return true
  const tracked = gitLines(["diff", "--name-only", "HEAD"])
  const untracked = gitLines(["ls-files", "--others", "--exclude-standard"])
  if (tracked === null || untracked === null) return true
  for (const file of [...tracked, ...untracked]) {
    if (DOC_TOUCH_FILES.has(file)) return true
    if (DOC_TOUCH_PREFIXES.some((prefix) => file.startsWith(prefix))) return true
  }
  return false
}

/**
 * 依赖是否需要重装：lockfile 比已安装快照新，或安装目录缺失。
 * @return {boolean} true 表示执行 pnpm install
 */
function needInstall() {
  if (isCI || full) return true
  try {
    return statSync(join(root, "pnpm-lock.yaml")).mtimeMs > statSync(join(root, "node_modules", ".pnpm", "lock.yaml")).mtimeMs
  } catch {
    return true
  }
}

const installNeeded = needInstall()
const docsNeeded = needDocsBuild()

// 安装必须先于一切检查：CI 全新 runner 没有 node_modules，先跑 tsc / eslint 会直接找不到命令
const installStep = {
  label: "安装依赖（frozen 锁文件）",
  command: "pnpm",
  args: ["install", "--frozen-lockfile"],
  skip: installNeeded ? "" : "lockfile 未变化",
}

// 互不依赖、可并行的前置检查：类型 / 静态检查 / 日志镜像核验 / 文档主题核验，四者都不读 dist、不写工作区
const parallelSteps = [
  { label: "类型检查", command: "pnpm", args: ["typecheck"] },
  // eslint 默认缓存加速本地重复运行；CI 与 --full 走冷缓存，与 CI 口径一致才可比
  { label: isCI || full ? "静态检查（冷缓存）" : "静态检查", command: "pnpm", args: ["exec", "eslint", ".", ...(isCI || full ? ["--no-cache"] : ["--cache"])] },
  // 全局 toolkit 未安装时该步打印跳过，不阻断远程 CI
  { label: "更新日志镜像（CHANGELOG → docs）", args: ["scripts/check-changelog-doc.mjs"] },
  { label: "文档站主题一致（toolkit docs theme --check）", args: ["scripts/check-docs-theme.mjs"] },
]
// 串行步骤：单测与 build 之后依次执行，CLI 冒烟依赖 dist 产物
// 时区（TZ）钉死：合成数据步骤（单元测试 / 覆盖率门槛）钉 TZ=UTC——被测数据由测试当场构造、与运行环境时区无关，
// 固定时区可避免「本地绿、CI 红」的时区耦合回归
const steps = [
  {
    label: skipCoverage ? "单元测试（不含覆盖率）" : "单元测试 + 覆盖率门槛",
    command: "pnpm",
    // 覆盖率与单测合并为一次运行：同一批测试不再跑两遍，检查项与阈值判定不变
    args: ["exec", "vitest", "run", ...(skipCoverage ? [] : ["--coverage"])],
    env: { TZ: "UTC" },
  },
  { label: "构建", command: "pnpm", args: ["build"] },
  // 文档站构建：VitePress 构建即做内部死链检查，文档改错会让门禁红，与 CI 同源
  { label: "文档站构建（死链检查）", command: "pnpm", args: ["docs:build"], skip: skipDocs ? "--skip-docs" : docsNeeded ? "" : "未触及 docs/、src/、README.md、依赖清单" },
  { label: "CLI 冒烟 --help", args: ["dist/cli.js", "--help"] },
  { label: "CLI 冒烟 mysql-recover --help", args: ["dist/cli.js", "mysql-recover", "--help"] },
  { label: "CLI 冒烟 mysql-recover ddl --help", args: ["dist/cli.js", "mysql-recover", "ddl", "--help"] },
  { label: "CLI 冒烟 mysql-recover restore --help", args: ["dist/cli.js", "mysql-recover", "restore", "--help"] },
  { label: "CLI 冒烟 project-rename --help", args: ["dist/cli.js", "project-rename", "--help"] },
  { label: "CLI 冒烟 config --help", args: ["dist/cli.js", "config", "--help"] },
  // 只读体检：退出码恒 0；关升级检查避免冒烟时派生联网 worker（门禁须无外部依赖、可重复）
  { label: "CLI 冒烟 config status", args: ["dist/cli.js", "config", "status"], env: { OPSBOX_NO_UPDATE_CHECK: "1" } }
]

reportToolchain()

const failures = []
let executed = 0

/**
 * 运行单个步骤并捕获输出，用于并行组（并发时继承 stdio 会互相穿插）。
 * @param {{label: string, command?: string, args: string[], env?: Record<string, string>}} step 步骤定义
 * @return {Promise<{step: object, code: number, stdout: string, stderr: string}>} 步骤与退出码、输出
 */
function runCaptured(step) {
  return new Promise((resolve) => {
    const command = step.command ?? process.execPath
    const child = spawn(command, step.args, { cwd: root, shell: isWindows && command !== process.execPath, env: { ...process.env, ...step.env } })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", (err) => resolve({ step, code: 1, stdout, stderr: `${stderr}${err}` }))
    child.on("close", (code) => resolve({ step, code: code ?? 1, stdout, stderr }))
  })
}

// 安装失败即中止：没有依赖时后续步骤的失败全是噪音，不进入并行组
if (installStep.skip) {
  console.log(`\n⊘ ${installStep.label}（${installStep.skip}，跳过）`)
} else {
  console.log(`\n▶ ${installStep.label}`)
  executed += 1
  const installed = spawnSync(installStep.command, installStep.args, { cwd: root, stdio: "inherit", shell: isWindows && installStep.command !== process.execPath })
  if (installed.status !== 0) {
    console.error(`\n✖ 门禁未通过：1 步失败\n  - ${installStep.label}`)
    process.exit(1)
  }
}

console.log(`\n▶ 并行检查（${parallelSteps.length} 项：${parallelSteps.map((s) => s.label).join(" / ")}）`)
executed += parallelSteps.length
for (const { step, code, stdout, stderr } of await Promise.all(parallelSteps.map(runCaptured))) {
  console.log(`\n—— ${step.label} ——`)
  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
  if (code !== 0) failures.push(step.label)
}

for (const step of steps) {
  if (step.skip) {
    console.log(`\n⊘ ${step.label}（${step.skip}，跳过）`)
    continue
  }
  console.log(`\n▶ ${step.label}`)
  executed += 1
  // pnpm / toolkit 在 Windows 上是 .cmd，需经 shell 调用；node 用 process.execPath 直呼，避免路径含空格时被 shell 拆断
  const command = step.command ?? process.execPath
  const result = spawnSync(command, step.args, { cwd: root, stdio: "inherit", shell: isWindows && command !== process.execPath, env: { ...process.env, ...step.env } })

  if (result.status === 0) continue
  failures.push(step.label)
  // 依赖装不上则后续步骤的失败都是噪音，直接中止；其余步骤全跑完，一次暴露全部问题
  if (step.fatal) break
}

if (failures.length > 0) {
  console.error(`\n✖ 门禁未通过：${failures.length} 步失败`)
  for (const label of failures) console.error(`  - ${label}`)
  process.exit(1)
}

console.log(`\n✔ 门禁全部通过（共 ${executed} 步）`)
