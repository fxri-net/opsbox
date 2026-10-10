// VS Code 系宿主适配（Trae / VS Code / Cursor / Windsurf / VSCodium 布局同构）：
// 数据分两处根——应用数据根下 User/（workspaceStorage、History、globalStorage），用户数据根下 worktrees 与缓存
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { isDir, listDir } from "../../platform"
import { fileContains, readJsonField } from "../artifacts"
import type { Artifact, TwoPassMeta } from "../artifacts"
import { pathForms, pathName, toFileUri } from "../paths"
import type { HostAdapter } from "./types"

// ---------- 类型定义 ----------

/** 宿主变体：同一套布局下的不同发行版 */
export interface HostVariant {
  /** 宿主标识 */
  id: string
  /** 宿主显示名 */
  label: string
  /** 应用数据根下的目录名 */
  appDirName: string
  /** 用户数据根下的隐藏目录名（无则留空） */
  userDirName?: string
}

/** 宿主数据根（可注入以便测试） */
export interface HostRoots {
  /** 应用数据根（User 的父目录） */
  appDataBase: string
  /** 用户数据根（家目录） */
  homeBase: string
}

// ---------- 常量 ----------

/** VS Code 系宿主变体表（布局同构，差异仅目录名） */
export const VSCODE_FAMILY_VARIANTS: HostVariant[] = [
  { id: "trae-cn", label: "Trae CN", appDirName: "Trae CN", userDirName: ".trae-cn" },
  { id: "trae", label: "Trae", appDirName: "Trae", userDirName: ".trae" },
  { id: "vscode", label: "VS Code", appDirName: "Code" },
  { id: "cursor", label: "Cursor", appDirName: "Cursor" },
  { id: "windsurf", label: "Windsurf", appDirName: "Windsurf" },
  { id: "vscodium", label: "VSCodium", appDirName: "VSCodium" }
]

// ---------- 函数（按英文首字母排序） ----------

/**
 * 当前平台的应用数据根目录（运行期由环境推导）。
 * @return 应用数据根绝对路径
 */
function appDataBase(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support")
  }
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
}

/**
 * 创建 VS Code 系宿主适配器。
 * @param variant 宿主变体
 * @param roots 数据根（缺省按当前平台推导，测试可注入）
 * @return 宿主适配器
 * @example const adapter = createVscodeFamilyAdapter({ id: "vscode", label: "VS Code", appDirName: "Code" })
 */
export function createVscodeFamilyAdapter(variant: HostVariant, roots: HostRoots = defaultRoots()): HostAdapter {
  const userRoot = join(roots.appDataBase, variant.appDirName, "User")
  const homeRoot = variant.userDirName ? join(roots.homeBase, variant.userDirName) : ""
  return {
    id: variant.id,
    label: variant.label,
    detect: () => isDir(userRoot) || (homeRoot !== "" && isDir(homeRoot)),
    scan: (oldPath, newPath) => [
      ...scanHomeRoot(homeRoot, oldPath, newPath, variant.id),
      ...scanGlobalStorage(userRoot, oldPath, variant.id),
      ...scanHistory(userRoot, oldPath, variant.id),
      ...scanWorkspaceStorage(userRoot, oldPath, variant.id)
    ]
  }
}

/**
 * 按当前平台推导默认数据根。
 * @return 数据根
 */
function defaultRoots(): HostRoots {
  return { appDataBase: appDataBase(), homeBase: homedir() }
}

/**
 * 扫描全局存储：storage.json 含旧 URI 则改写；state.vscdb 含旧路径则按状态库改写（实验性重关联）。
 * @param userRoot 宿主 User 根
 * @param oldPath 旧路径
 * @param host 宿主标识
 * @return 载体数组
 */
function scanGlobalStorage(userRoot: string, oldPath: string, host: string): Artifact[] {
  const artifacts: Artifact[] = []
  const oldUri = toFileUri(oldPath)
  const storage = join(userRoot, "globalStorage", "storage.json")
  if (existsSync(storage) && fileContains(storage, [oldUri])) {
    artifacts.push({ host, kind: "text", path: storage, note: "改写全局存储中含旧路径的键值" })
  }
  const db = join(userRoot, "globalStorage", "state.vscdb")
  // 状态库存的是双反斜杠 / 盘符大小写 / 全大写等形态，探针须覆盖全部形态
  if (fileContains(db, pathForms(oldPath))) {
    artifacts.push({ host, kind: "sqlite", path: db, note: "改写全局状态库中的项目关联引用，实验性重关联" })
  }
  return artifacts
}

/**
 * 扫描历史记录：resource 指向旧路径（或其下文件）的条目改写 URI。
 * @param userRoot 宿主 User 根
 * @param oldPath 旧路径
 * @param host 宿主标识
 * @return 载体数组
 */
function scanHistory(userRoot: string, oldPath: string, host: string): Artifact[] {
  const artifacts: Artifact[] = []
  const oldUri = toFileUri(oldPath)
  const historyRoot = join(userRoot, "History")
  for (const entry of listDir(historyRoot)) {
    const file = join(historyRoot, entry, "entries.json")
    const resource = readJsonField(file, "resource")
    if (resource === oldUri || (resource !== null && resource.startsWith(`${oldUri}/`))) {
      artifacts.push({ host, kind: "text", path: file, note: "改写历史条目中的资源 URI" })
    }
  }
  return artifacts
}

/**
 * 扫描用户数据根：worktree 占位目录改名、会话事件缓存与旧 MCP 作用域目录丢弃。
 * @param homeRoot 宿主用户数据根（无则空串）
 * @param oldPath 旧路径
 * @param newPath 新路径
 * @param host 宿主标识
 * @return 载体数组
 */
function scanHomeRoot(homeRoot: string, oldPath: string, newPath: string, host: string): Artifact[] {
  if (homeRoot === "") return []
  const artifacts: Artifact[] = []
  const worktree = join(homeRoot, "worktrees", pathName(oldPath))
  if (existsSync(worktree)) {
    artifacts.push({ host, kind: "dir", path: worktree, note: `worktree 占位目录改名为 ${pathName(newPath)}` })
  }
  const cache = join(homeRoot, "hub_event_cache")
  if (existsSync(cache)) {
    artifacts.push({ host, kind: "cache", path: cache, note: "会话事件缓存，直接丢弃由宿主重建" })
  }
  // MCP 作用域目录按「项目目录名 + 8 位 hash」命名，改名后旧目录作残留丢弃，新目录由宿主重建
  const mcps = join(homeRoot, "mcps")
  const scopePrefix = `s_${pathName(oldPath)}-`
  for (const entry of listDir(mcps)) {
    if (!entry.startsWith(scopePrefix)) continue
    if (!/^[0-9a-f]{8}$/.test(entry.slice(scopePrefix.length))) continue
    artifacts.push({ host, kind: "cache", path: join(mcps, entry), note: "旧作用域 MCP 目录残留，丢弃由宿主重建" })
  }
  return artifacts
}

/**
 * 扫描工作区存储：folder 指向旧路径的条目改写 workspace.json，并登记其 state.vscdb 以供双趟迁移。
 * @param userRoot 宿主 User 根
 * @param oldPath 旧路径
 * @param host 宿主标识
 * @return 载体数组
 */
function scanWorkspaceStorage(userRoot: string, oldPath: string, host: string): Artifact[] {
  const artifacts: Artifact[] = []
  const oldUri = toFileUri(oldPath)
  const root = join(userRoot, "workspaceStorage")
  for (const entry of listDir(root)) {
    const dir = join(root, entry)
    const workspace = join(dir, "workspace.json")
    if (readJsonField(workspace, "folder") !== oldUri) continue
    artifacts.push({ host, kind: "text", path: workspace, note: "改写工作区存储中的 folder URI" })
    const db = join(dir, "state.vscdb")
    if (existsSync(db)) {
      const twoPass: TwoPassMeta = { oldId: entry, oldDir: dir, workspaceRoot: userRoot, dbFile: db }
      artifacts.push({ host, kind: "binary", path: db, note: "工作区状态库，第一趟备份、第二趟整文件复制入新 id 目录", twoPass })
    }
  }
  return artifacts
}
