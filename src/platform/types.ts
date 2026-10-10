// 平台适配层契约（Ports）：平台无关核心只经此调用平台特有操作。
// 新增能力须同步给出各端适配实现；确不可跨平台者须在能力文档显式声明降级范围（见 .tasks/conventions/common.md C-1）。

/** 平台标识 */
export type PlatformId = "linux" | "darwin" | "win32" | "unknown"

/** 平台默认参数：各端 MySQL/宝塔安装路径不同，由此集中提供，可由 CLI 选项覆盖 */
export interface PlatformDefaults {
  /** MySQL 数据目录 */
  dataDir: string
  /** MySQL 二进制目录 */
  binDir: string
  /** MySQL 服务名 */
  serviceName: string
  /** 整目录冷备目标 */
  backupDir: string
  /** 孤儿库目录临时停靠目录（须与数据目录同卷，保证挪动为瞬时重命名） */
  stagingDir: string
  /** 数据目录属主（unix 用，形如 mysql:mysql；空串表示无需变更，如 macOS 单用户安装） */
  dataOwner: string
}

/** 平台适配层：封装服务控制与权限复位等平台特有操作 */
export interface PlatformAdapter {
  /** 平台标识 */
  readonly id: PlatformId
  /** 平台显示名 */
  readonly label: string
  /** 默认参数 */
  readonly defaults: PlatformDefaults
  /** 停止 MySQL 服务并等待进程退出 */
  stopService(name: string): Promise<void>
  /** 启动 MySQL 服务（是否可连接由核心经 MySQL 客户端探测，非本层职责） */
  startService(name: string): Promise<void>
  /** 复位路径权限，使服务账号可读写（Linux chown / Windows icacls /reset / macOS 无操作） */
  resetPermissions(target: string): Promise<void>
}
