// 迁移计划：把「路径 + 宿主适配器」编排为一份可打印、可复核的载体清单
import { resolve } from "node:path"
import type { Artifact } from "./artifacts"
import { resolveHosts } from "./adapters/registry"
import type { HostAdapter } from "./adapters/types"
import { pathName, toFileUri } from "./paths"

// ---------- 类型定义 ----------

/** 构建计划入参 */
export interface BuildPlanInput {
  /** 旧路径 */
  oldPath: string
  /** 新路径 */
  newPath: string
  /** 限定宿主 id（缺省全部检出） */
  hosts?: string[]
}

/** 迁移计划 */
export interface MigrationPlan {
  /** 旧路径（绝对） */
  oldPath: string
  /** 新路径（绝对） */
  newPath: string
  /** 新目录名 */
  newName: string
  /** 旧 file URI */
  oldUri: string
  /** 新 file URI */
  newUri: string
  /** 参与迁移的宿主 */
  hosts: HostAdapter[]
  /** 待迁移载体 */
  artifacts: Artifact[]
}

// ---------- 函数（按英文首字母排序） ----------

/**
 * 构建迁移计划：解析路径、解析宿主、汇总各宿主扫描出的载体。
 * @param input 构建入参
 * @return 迁移计划
 */
export function buildPlan(input: BuildPlanInput): MigrationPlan {
  const oldPath = resolve(input.oldPath)
  const newPath = resolve(input.newPath)
  const hosts = resolveHosts(input.hosts)
  const artifacts = hosts.flatMap((host) => host.scan(oldPath, newPath))
  return {
    oldPath,
    newPath,
    newName: pathName(newPath),
    oldUri: toFileUri(oldPath),
    newUri: toFileUri(newPath),
    hosts,
    artifacts
  }
}
