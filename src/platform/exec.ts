// 外部命令执行的统一封装：同步执行、命令存在性探测、进程存在性探测（平台差异在此收敛）
import { spawnSync } from "node:child_process"

/** 命令执行结果 */
export interface RunResult {
  /** 退出码 */
  code: number
  /** 标准输出 */
  stdout: string
  /** 标准错误 */
  stderr: string
}

/** 执行选项 */
export interface RunOptions {
  /** 工作目录 */
  cwd?: string
  /** 写入子进程标准输入的内容 */
  input?: string
}

/** 等待若干毫秒 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 同步执行外部命令，返回退出码与输出；不因非 0 退出码抛错（由调用方判定）。
 * 参数以数组传入（不经 shell），路径含空格亦安全。
 * @param command 命令名或绝对路径
 * @param args 参数数组
 * @param opts 执行选项
 * @return 退出码与输出
 * @example const r = run("systemctl", ["stop", "mysql"])
 */
export function run(command: string, args: string[], opts: RunOptions = {}): RunResult {
  const res = spawnSync(command, args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024
  })
  return { code: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
}

/**
 * 执行命令并在非 0 退出码时抛错（附退出码与 stderr）。
 * @param command 命令名或绝对路径
 * @param args 参数数组
 * @param opts 执行选项
 * @return 退出码与输出
 * @example runOrThrow("icacls", [target, "/reset"])
 */
export function runOrThrow(command: string, args: string[], opts: RunOptions = {}): RunResult {
  const r = run(command, args, opts)
  if (r.code !== 0) {
    const detail = (r.stderr || r.stdout).trim()
    throw new Error(`命令执行失败（${command} ${args.join(" ")}，退出码 ${r.code}）：${detail}`)
  }
  return r
}

/**
 * 判断命令是否存在于 PATH（unix 用 which，Windows 用 where）。
 * @param name 命令名
 * @return 存在返回 true
 */
export function hasCommand(name: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which"
  return run(probe, [name]).code === 0
}

/**
 * 判断进程是否存在（unix 用 pgrep -x，Windows 用 tasklist 过滤）。
 * @param name 进程名（不含扩展名）
 * @return 存在返回 true
 */
export function hasProcess(name: string): boolean {
  if (process.platform === "win32") {
    const r = run("tasklist", ["/FI", `IMAGENAME eq ${name}.exe`, "/NH"])
    return r.stdout.toLowerCase().includes(`${name}.exe`)
  }
  return run("pgrep", ["-x", name]).code === 0
}

/**
 * 轮询等待进程退出，超时抛错。
 * @param name 进程名（不含扩展名）
 * @param timeoutMs 最长等待毫秒数
 * @example await waitProcessExit("mysqld", 120000)
 */
export async function waitProcessExit(name: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!hasProcess(name)) return
    await sleep(1000)
  }
  throw new Error(`进程 ${name} 在 ${timeoutMs / 1000} 秒内未退出`)
}
