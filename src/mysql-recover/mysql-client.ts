// MySQL 客户端封装：经 --defaults-extra-file 传口令（不落命令行），统一 query / exec / 就绪探测
import { existsSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run, sleep } from "../platform"
import type { RunResult } from "../platform"

/** 客户端构造参数 */
export interface MysqlClientOptions {
  /** MySQL 二进制目录 */
  binDir: string
  /** 连接用户 */
  user: string
  /** 连接口令 */
  password: string
}

/** SQL 执行选项 */
export interface MysqlExecOptions {
  /** 追加 --force，遇错继续执行以一次性收集全部报错 */
  force?: boolean
}

/**
 * 转义选项文件中的口令：反斜杠与双引号需前置反斜杠。
 * @param value 原始口令
 * @return 可嵌入选项文件的值
 */
function escapeCnf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/**
 * 解析 MySQL 工具可执行路径：优先二进制目录下的实体，缺失时回落 PATH 命令名。
 * @param binDir 二进制目录
 * @param base 工具基名（不含平台扩展名）
 * @return 可执行文件绝对路径或命令名
 * @example resolveTool("/www/server/mysql/bin", "mysql") // "/www/server/mysql/bin/mysql"
 */
export function resolveTool(binDir: string, base: string): string {
  const name = process.platform === "win32" ? `${base}.exe` : base
  const full = join(binDir, name)
  return existsSync(full) ? full : base
}

/** MySQL 客户端：一个实例对应一次任务期的连接上下文 */
export class MysqlClient {
  /** mysql 可执行路径 */
  private readonly exe: string
  /** 选项文件路径 */
  private readonly cnf: string

  constructor(opts: MysqlClientOptions) {
    this.exe = resolveTool(opts.binDir, "mysql")
    this.cnf = join(tmpdir(), `opsbox-my-client-${process.pid}.cnf`)
    const lines = [
      "[client]",
      "host=127.0.0.1",
      "protocol=TCP",
      `user=${opts.user}`,
      `password="${escapeCnf(opts.password)}"`,
      "default-character-set=utf8mb4",
      "connect-timeout=10"
    ]
    writeFileSync(this.cnf, lines.join("\r\n") + "\r\n", "utf8")
  }

  /** 删除选项文件（任务结束须调用，避免口令残留磁盘） */
  dispose(): void {
    rmSync(this.cnf, { force: true })
  }

  /**
   * 执行一段 SQL。
   * @param sql SQL 文本
   * @param opts 执行选项
   * @return 退出码与输出
   */
  exec(sql: string, opts: MysqlExecOptions = {}): RunResult {
    // 选项文件必须位于参数首位，否则 mysql 会忽略
    const args = ["--defaults-extra-file=" + this.cnf, "--batch", "--skip-column-names", "--comments"]
    if (opts.force) args.push("--force")
    return run(this.exe, args, { input: sql })
  }

  /**
   * 执行查询并返回去空行后的输出行；非 0 退出码时抛错。
   * @param sql 查询 SQL
   * @return 输出行数组
   */
  query(sql: string): string[] {
    const result = this.exec(sql)
    if (result.code !== 0) throw new Error(`查询失败（退出码 ${result.code}）：${result.stderr.trim()}`)
    return result.stdout.split(/\r?\n/).filter((line) => line.trim() !== "")
  }

  /**
   * 从执行结果中抽取真实报错行（忽略口令告警等非 ERROR 文本）。
   * @param result 执行结果
   * @return 报错行数组
   */
  errors(result: RunResult): string[] {
    const text = result.stderr || ""
    if (!text) return []
    return text.split(/\r?\n/).filter((line) => /^ERROR \d+/.test(line))
  }

  /**
   * 轮询等待服务可连接。
   * @param timeoutSec 最长等待秒数
   */
  async waitReady(timeoutSec = 180): Promise<void> {
    const deadline = Date.now() + timeoutSec * 1000
    while (Date.now() < deadline) {
      if (this.exec("SELECT 1;").code === 0) return
      await sleep(2000)
    }
    throw new Error(`MySQL 服务在 ${timeoutSec} 秒内仍未就绪`)
  }

  /**
   * 读取服务端版本号。
   * @return 版本字符串，取不到时返回空串
   */
  version(): string {
    return this.query("SELECT VERSION();")[0] ?? ""
  }
}
