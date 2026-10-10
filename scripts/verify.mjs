import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// 单一门禁真源：本仓库全部验收步骤由本脚本定义并按序执行，本地与 CI 共用同一份清单。
// 目的：消除「各写一份步骤清单、彼此漂移」的结构性问题，使「本地自检通过、CI 才暴露」在清单层面不可能发生。
// 本文件不入 npm 包（files 白名单不含 scripts）
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const isWindows = process.platform === "win32"

const flags = new Set(process.argv.slice(2))
const skipCoverage = flags.has("--skip-coverage")

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

// 步骤清单即门禁定义：顺序有依赖（build 先于 CLI 冒烟），增删步骤只改这里
// 时区（TZ）按「数据来源」分两轴钉死，避免「本地绿、CI 红」的时区耦合回归：
// ① 合成数据步骤（单元测试 / 覆盖率门槛）钉 TZ=UTC：被测数据由测试当场构造、与运行环境时区无关；
// ② 读真实任务数据的步骤（任务区体检）钉 TZ=Asia/Shanghai：任务档按本地时区书写，须在数据原地时区判定
const steps = [
  { label: "安装依赖（frozen 锁文件）", command: "pnpm", args: ["install", "--frozen-lockfile"], fatal: true },
  { label: "类型检查", command: "pnpm", args: ["typecheck"] },
  // 冷缓存：本地 eslint --cache 会跳过未变文件，CI 每次全量跑，门禁必须与 CI 对齐才可比
  { label: "静态检查（冷缓存）", command: "pnpm", args: ["exec", "eslint", ".", "--no-cache"] },
  { label: "单元测试", command: "pnpm", args: ["test"], env: { TZ: "UTC" } },
  { label: "覆盖率门槛", command: "pnpm", args: ["test:coverage"], skip: skipCoverage, env: { TZ: "UTC" } },
  { label: "构建", command: "pnpm", args: ["build"] },
  { label: "CLI 冒烟 --help", args: ["dist/cli.js", "--help"] },
  { label: "CLI 冒烟 mysql-recover --help", args: ["dist/cli.js", "mysql-recover", "--help"] },
  { label: "CLI 冒烟 mysql-recover ddl --help", args: ["dist/cli.js", "mysql-recover", "ddl", "--help"] },
  { label: "CLI 冒烟 mysql-recover restore --help", args: ["dist/cli.js", "mysql-recover", "restore", "--help"] },
  // 任务区体检：读真实 .tasks 断言规范达标，须在数据原地时区（Asia/Shanghai）判定
  { label: "任务区体检（tasks check）", command: "toolkit", args: ["tasks", "check"], env: { TZ: "Asia/Shanghai" } }
]

reportToolchain()

const failures = []
let executed = 0

for (const step of steps) {
  if (step.skip) continue
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
