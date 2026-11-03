// 仅调用全局 toolkit：存在则执行并透传退出码，缺失时默认跳过；设置 FX_REQUIRE_TOOLKIT=1 可改为失败
import { spawnSync } from "node:child_process"

const isWindows = process.platform === "win32"
const args = process.argv.slice(2)

// 先探测全局命令，避免直接执行时输出 shell 的“找不到命令”噪音
const probe = spawnSync("toolkit", ["--version"], { encoding: "utf8", shell: isWindows })
if (probe.status !== 0) {
  const message = `⚠️ 未检测到全局 toolkit，跳过：toolkit ${args.join(" ")}`
  if (process.env.FX_REQUIRE_TOOLKIT === "1") {
    console.error(message)
    process.exit(1)
  }
  console.warn(message)
  process.exit(0)
}

const result = spawnSync("toolkit", args, { stdio: "inherit", shell: isWindows })
process.exit(result.status ?? 1)
