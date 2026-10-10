// 交互式口令输入：掩码不回显，且不经命令行参数，避免进入进程列表与 shell 历史

/**
 * 交互式读取一行掩码输入（不回显）。
 * ⚠️ 非交互终端（管道 / CI）无法掩码，直接拒绝，避免读到半截输入造成误连。
 * @param promptText 提示文本
 * @return 用户输入的文本
 * @example const pwd = await promptPassword("请输入 MySQL root 口令：")
 */
export function promptPassword(promptText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    const stdout = process.stdout
    if (!stdin.isTTY) {
      reject(new Error("当前环境非交互终端，请改用 --password 传入口令"))
      return
    }
    stdout.write(promptText)
    stdin.resume()
    stdin.setRawMode(true)

    let value = ""
    const cleanup = (): void => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off("data", onData)
    }
    const onData = (chunk: Buffer): void => {
      const char = chunk.toString("utf8")
      if (char === "\n" || char === "\r" || char === "\u0004") {
        cleanup()
        stdout.write("\n")
        resolve(value)
        return
      }
      if (char === "\u0003") {
        // Ctrl-C：交回空行后以错误终止，避免静默吞掉中断
        cleanup()
        stdout.write("\n")
        reject(new Error("已取消输入"))
        return
      }
      if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1)
        return
      }
      value += char
    }
    stdin.on("data", onData)
  })
}
