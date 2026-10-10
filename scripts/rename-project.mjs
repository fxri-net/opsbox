import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"

// Step 0（一次性引导）：把本仓目录改名为 package.json 包名对应的目录名，并迁移各宿主的关联状态。
// 为何单独成脚本：
//   ① 目标宿主的数据目录在仓库之外，改名须经 project-rename 能力完成，本脚本只做「推导目标 + 预检 + 调起能力」；
//   ② Windows 下无法对「调用方 CWD」所在目录改名，故要求从仓库外的目录调起（见下方预检）；
//   ③ 一次性、可复查、可入库（package.json 的 files 白名单不含 scripts，故不入 npm 包）。
// ⚠️ 执行前必须关闭所有目标宿主（Trae / VS Code 等），否则其会改写状态文件造成竞争。
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const parent = dirname(root)
const isWindows = process.platform === "win32"

const flags = new Set(process.argv.slice(2))
const resume = flags.has("--resume")
const dryRun = flags.has("--dry-run")
const yes = flags.has("--yes")

// 新目录名由包名推导（@fxri/opsbox → opsbox），避免脚本内重复写死目标名
const newName = String(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name).replace(/^@[^/]+\//, "")
// 第一趟：自身位置即旧路径，目标为同级的新名目录
// 第二趟：仓库已位于新路径，自身位置即新路径；旧路径仅作占位（resume 经备份清单自动发现，不依赖该参数）
const oldPath = root
const newPath = resume ? root : join(parent, newName)

/**
 * 同步执行外部命令。
 * @param {string} command 可执行文件
 * @param {string[]} args 参数数组
 * @param {string} cwd 工作目录
 * @return {number} 退出码
 */
function run(command, args, cwd) {
  // Windows 下 pnpm 为 .cmd 需经 shell；node 用 execPath 直呼，避免路径含空格被 shell 拆断
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: isWindows && command !== process.execPath })
  return result.status ?? 1
}

// 预检一：第一趟会移动仓库目录本身，调用方 CWD 若落在仓库内会锁住目标目录
if (!resume) {
  const cwd = process.cwd()
  if (cwd === root || cwd.startsWith(root + sep)) {
    console.error("⚠️ 当前终端工作目录位于待改名仓库内，无法改名自身")
    console.error(`   请切换到仓库外的目录再执行，例如：cd "${parent}"`)
    process.exit(1)
  }
}

// 预检二：目标目录不得已存在
if (!resume && existsSync(newPath)) {
  console.error(`⚠️ 目标目录已存在，请先处理：${newPath}`)
  process.exit(1)
}

console.log(`改名目标：${oldPath}\n        → ${newPath}`)
if (!resume && !dryRun) {
  console.log("⚠️ 请确认已关闭所有目标宿主（Trae / VS Code 等），再继续")
}

if (!resume) {
  console.log("\n▶ 构建（确保 dist/cli.js 为最新）")
  if (run("pnpm", ["build"], root) !== 0) {
    console.error("⚠️ 构建失败，已中止")
    process.exit(1)
  }
}

const cliArgs = ["project-rename", oldPath, newPath]
if (resume) cliArgs.push("--resume")
else if (dryRun) cliArgs.push("--dry-run")
else if (yes) cliArgs.push("--yes")

console.log(`\n▶ 调用 project-rename 能力（${cliArgs.slice(1).join(" ")}）`)
const code = run(process.execPath, [join(root, "dist", "cli.js"), ...cliArgs], parent)

if (code !== 0) {
  console.error("⚠️ project-rename 执行失败")
  process.exit(code)
}

if (!resume && !dryRun) {
  console.log("\n下一步（第二趟）：")
  console.log("  1. 打开目标宿主并载入新路径，随后关闭（宿主据此生成新的 workspaceStorage id）")
  console.log(`  2. 执行：node "${join(basename(newPath), "scripts", "rename-project.mjs")}" --resume`)
}
