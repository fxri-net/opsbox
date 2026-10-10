// 平台层统一出口：核心仅从此处引用平台能力
export type { PlatformAdapter, PlatformDefaults, PlatformId } from "./types"
export { currentPlatformId, resolveAdapter } from "./detect"
export { DARWIN_DEFAULTS, LINUX_DEFAULTS } from "./adapters/unix"
export { deriveWindowsDefaults } from "./adapters/windows"
export { hasCommand, hasProcess, run, runOrThrow, sleep, waitProcessExit } from "./exec"
export type { RunOptions, RunResult } from "./exec"
export { copyFile, copyTree, dirSize, ensureDir, formatSize, freeSpace, isDir, listDir, movePath } from "./fsx"
