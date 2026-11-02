// 本地 CHANGELOG 镜像检查：全局 toolkit 可用时执行 --check，未安装时打印跳过（远程 CI 不依赖该工具）
import { spawnSync } from "node:child_process"

const isWindows = process.platform === "win32"

const probe = spawnSync("toolkit", ["--version"], { encoding: "utf8", shell: isWindows })
if (probe.status !== 0) {
  console.log("跳过 CHANGELOG 镜像检查（未检测到全局 toolkit）")
  process.exit(0)
}

const result = spawnSync("toolkit", ["changelog", "--check", "doc"], {
  stdio: "inherit",
  shell: isWindows,
})
process.exit(result.status ?? 1)
