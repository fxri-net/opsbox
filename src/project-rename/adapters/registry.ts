// 宿主注册表：能力要求的「跨宿主」在此收口，新增宿主只扩 VSCODE_FAMILY_VARIANTS 或本文件
import type { HostAdapter } from "./types"
import { VSCODE_FAMILY_VARIANTS, createVscodeFamilyAdapter } from "./vscode-family"

// ---------- 函数（按英文首字母排序） ----------

/**
 * 全部已支持的宿主适配器。
 * @return 宿主适配器数组
 */
export function allHosts(): HostAdapter[] {
  return VSCODE_FAMILY_VARIANTS.map((variant) => createVscodeFamilyAdapter(variant))
}

/**
 * 解析参与迁移的宿主：显式指定则按其 id 取用（不校验是否安装），否则取本机全部检出宿主。
 * @param ids 宿主 id 列表（缺省或空则自动检出）
 * @return 宿主适配器数组
 */
export function resolveHosts(ids?: string[]): HostAdapter[] {
  const hosts = allHosts()
  if (!ids || ids.length === 0) return hosts.filter((host) => host.detect())
  const known = hosts.map((host) => host.id)
  for (const id of ids) {
    if (!known.includes(id)) throw new Error(`未知宿主：${id}（可选：${known.join(" / ")}）`)
  }
  const wanted = new Set(ids)
  return hosts.filter((host) => wanted.has(host.id))
}
