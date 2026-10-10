// 平台探测：按运行期 process.platform 选择适配器，未知平台直接报错而非静默降级
import { DARWIN_DEFAULTS, LINUX_DEFAULTS, createUnixAdapter } from "./adapters/unix"
import { createWindowsAdapter } from "./adapters/windows"
import type { PlatformAdapter, PlatformId } from "./types"

/**
 * 获取当前运行平台标识。
 * @return 平台标识
 */
export function currentPlatformId(): PlatformId {
  if (process.platform === "linux") return "linux"
  if (process.platform === "darwin") return "darwin"
  if (process.platform === "win32") return "win32"
  return "unknown"
}

/**
 * 解析平台适配器。
 * @param id 平台标识，默认取当前平台
 * @return 平台适配器
 * @example const adapter = resolveAdapter()
 */
export function resolveAdapter(id: PlatformId = currentPlatformId()): PlatformAdapter {
  switch (id) {
    case "linux":
      return createUnixAdapter("linux", "Linux", LINUX_DEFAULTS)
    case "darwin":
      return createUnixAdapter("darwin", "macOS", DARWIN_DEFAULTS)
    case "win32":
      return createWindowsAdapter()
    default:
      // 未知平台不猜测，明确报错以免用错误默认路径误操作数据
      throw new Error(`暂不支持的运行平台：${process.platform}（当前仅支持 linux / macOS / Windows）`)
  }
}
