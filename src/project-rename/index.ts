// project-rename 能力出口：目录改名并迁移各宿主中跟随目录名的关联状态
// 外部只从此处引用本能力；子模块为内部实现细节，避免外部耦合
export { registerProjectRename } from "./command"
export { renameProject } from "./engine"
export type { RenameOptions } from "./engine"
export { buildPlan } from "./plan"
export type { BuildPlanInput, MigrationPlan } from "./plan"
export { allHosts, resolveHosts } from "./adapters/registry"
export type { HostAdapter } from "./adapters/types"
export { VSCODE_FAMILY_VARIANTS, createVscodeFamilyAdapter } from "./adapters/vscode-family"
export type { HostRoots, HostVariant } from "./adapters/vscode-family"
export type { Artifact, ArtifactKind, TwoPassMeta } from "./artifacts"
export { pathName, replaceUri, toFileUri } from "./paths"
