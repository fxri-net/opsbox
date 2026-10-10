// project-rename 宿主适配层契约（Ports）：核心经此访问各宿主的关联状态，宿主差异不外泄
import type { Artifact } from "../artifacts"

/** 宿主适配器：描述一个宿主（IDE / 工具）中「跟随项目目录名」的关联状态 */
export interface HostAdapter {
  /** 宿主标识（如 trae-cn / vscode） */
  readonly id: string
  /** 宿主显示名 */
  readonly label: string
  /** 探测本机是否使用该宿主（按数据目录存在性判定） */
  detect(): boolean
  /** 扫描本宿主中与旧路径关联、需迁移的载体 */
  scan(oldPath: string, newPath: string): Artifact[]
}
