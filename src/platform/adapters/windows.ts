// Windows 平台适配：服务控制优先 sc、失败回退 net，权限复位走 icacls /reset；
// 默认安装路径不写死本机布局，改为运行期从 MySQL 服务注册信息推导（见 .tasks/conventions/common.md C-2）。
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, parse } from "node:path"
import { run, runOrThrow, waitProcessExit } from "../exec"
import type { PlatformAdapter, PlatformDefaults } from "../types"

/** 默认 MySQL 服务名（Windows 服务注册名，可由 CLI 的 --service 覆盖） */
const DEFAULT_SERVICE_NAME = "mysql"

/**
 * 创建 Windows 平台适配器。
 * @return 平台适配器
 * @example const adapter = createWindowsAdapter()
 */
export function createWindowsAdapter(): PlatformAdapter {
  return {
    id: "win32",
    label: "Windows",
    defaults: deriveWindowsDefaults(),
    async stopService(name: string): Promise<void> {
      // sc 对未知服务立即失败，此时回退 net；二者均同步返回，须另等 mysqld 进程真正退出
      if (run("sc", ["stop", name]).code !== 0) {
        runOrThrow("net", ["stop", name])
      }
      await waitProcessExit("mysqld", 120000)
    },
    async startService(name: string): Promise<void> {
      if (run("sc", ["start", name]).code !== 0) {
        runOrThrow("net", ["start", name])
      }
    },
    async resetPermissions(target: string): Promise<void> {
      // /reset 将继承权限还原为默认；/T 递归子项、/C 忽略错误继续、/Q 免确认
      runOrThrow("icacls", [target, "/reset", "/T", "/C", "/Q"])
    }
  }
}

/**
 * 运行期推导 Windows 默认参数：由 MySQL 服务注册信息反推二进制目录与数据目录，避免写死本机安装路径。
 * 推导不出的值以空串返回，由 CLI 层在缺失时明确报错并要求显式传 --data / --bin。
 * @return 平台默认参数
 * @example const defaults = deriveWindowsDefaults()
 */
export function deriveWindowsDefaults(): PlatformDefaults {
  const bin = queryServiceBinary(DEFAULT_SERVICE_NAME)
  const binDir = bin ? dirname(bin.binary) : ""
  const iniArg = bin ? /--defaults-file="?([^"\s]+)"?/.exec(bin.args) : null
  const dataDir = iniArg ? readDataDirFromIni(iniArg[1] ?? "") : ""
  // 冷备与 staging 为 opsbox 自有目录，就近落在数据目录所在卷，避免跨卷整目录拷贝
  const volume = parse(dataDir || binDir).root
  return {
    dataDir,
    binDir,
    serviceName: DEFAULT_SERVICE_NAME,
    backupDir: volume ? join(volume, "opsbox-backup", "data") : "",
    stagingDir: binDir ? join(dirname(binDir), "orphan-staging") : "",
    dataOwner: ""
  }
}

/**
 * 解析服务注册信息中的可执行文件路径与启动参数。
 * @param serviceName 服务名
 * @return 可执行文件路径与原始参数串；服务未注册或无法解析时返回 null
 */
function queryServiceBinary(serviceName: string): { binary: string; args: string } | null {
  const r = run("sc", ["qc", serviceName])
  if (r.code !== 0) return null
  const line = r.stdout.split(/\r?\n/).find((l) => l.includes("BINARY_PATH_NAME"))
  if (!line) return null
  const value = line.slice(line.indexOf(":") + 1).trim()
  // 路径含空格时 sc 以双引号包裹，其后为启动参数串
  const quoted = /^"([^"]+)"\s*(.*)$/.exec(value)
  if (quoted) return { binary: quoted[1] ?? "", args: quoted[2] ?? "" }
  const bare = /^(\S+)\s*(.*)$/.exec(value)
  return bare ? { binary: bare[1] ?? "", args: bare[2] ?? "" } : null
}

/**
 * 从 my.ini 读取 datadir 配置。
 * @param iniPath my.ini 路径
 * @return 数据目录；文件缺失或无该配置时返回空串
 */
function readDataDirFromIni(iniPath: string): string {
  if (!iniPath || !existsSync(iniPath)) return ""
  for (const raw of readFileSync(iniPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue
    const m = /^datadir\s*=\s*(.+)$/i.exec(line)
    if (m) return (m[1] ?? "").trim().replace(/^"|"$/g, "")
  }
  return ""
}
