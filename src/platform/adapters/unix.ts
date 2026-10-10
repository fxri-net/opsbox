// unix 系平台适配（Linux / macOS）：服务控制器按运行期探测择一，权限复位统一走 chown
import { hasCommand, runOrThrow, waitProcessExit } from "../exec"
import type { PlatformAdapter, PlatformDefaults, PlatformId } from "../types"

/** Linux 宝塔默认参数 */
export const LINUX_DEFAULTS: PlatformDefaults = {
  dataDir: "/www/server/data",
  binDir: "/www/server/mysql/bin",
  serviceName: "mysql",
  backupDir: "/www/backup/opsbox/mysql-data",
  stagingDir: "/www/server/mysql/orphan-staging",
  dataOwner: "mysql:mysql"
}

/** macOS 默认参数（Homebrew 安装惯例；属主为空表示单用户安装无需 chown） */
export const DARWIN_DEFAULTS: PlatformDefaults = {
  dataDir: "/usr/local/var/mysql",
  binDir: "/usr/local/opt/mysql/bin",
  serviceName: "mysql",
  backupDir: "/usr/local/var/opsbox-backup/mysql-data",
  stagingDir: "/usr/local/var/opsbox-staging",
  dataOwner: ""
}

/** 服务控制器：屏蔽 systemctl / brew services / mysql.server 三种管理方式的差异 */
interface ServiceController {
  /** 控制器种类（用于日志提示） */
  readonly kind: string
  /** 停止服务 */
  stop(): void
  /** 启动服务 */
  start(): void
}

/**
 * 按当前环境择一选取 MySQL 服务控制器。
 * @param name 服务名
 * @return 服务控制器
 */
function pickServiceController(name: string): ServiceController {
  if (hasCommand("systemctl")) {
    return {
      kind: "systemctl",
      stop: () => runOrThrow("systemctl", ["stop", name]),
      start: () => runOrThrow("systemctl", ["start", name])
    }
  }
  if (hasCommand("brew")) {
    return {
      kind: "brew",
      stop: () => runOrThrow("brew", ["services", "stop", name]),
      start: () => runOrThrow("brew", ["services", "start", name])
    }
  }
  if (hasCommand("mysql.server")) {
    return {
      kind: "mysql.server",
      stop: () => runOrThrow("mysql.server", ["stop"]),
      start: () => runOrThrow("mysql.server", ["start"])
    }
  }
  throw new Error("未找到可用的 MySQL 服务控制器（systemctl / brew services / mysql.server 均不可用）")
}

/**
 * 创建 unix 系平台适配器。
 * @param id 平台标识（linux 或 darwin）
 * @param label 平台显示名
 * @param defaults 默认参数
 * @return 平台适配器
 * @example const adapter = createUnixAdapter("linux", "Linux", LINUX_DEFAULTS)
 */
export function createUnixAdapter(id: PlatformId, label: string, defaults: PlatformDefaults): PlatformAdapter {
  return {
    id,
    label,
    defaults,
    async stopService(name: string): Promise<void> {
      const controller = pickServiceController(name)
      controller.stop()
      // 服务管理器返回成功不代表 mysqld 已完全退出，须等待释放数据目录文件锁
      await waitProcessExit("mysqld", 120000)
    },
    async startService(name: string): Promise<void> {
      pickServiceController(name).start()
    },
    async resetPermissions(target: string): Promise<void> {
      // dataOwner 为空表示单用户安装，进程以当前用户运行，无需变更属主
      if (!defaults.dataOwner) return
      runOrThrow("chown", ["-R", defaults.dataOwner, target])
    }
  }
}
