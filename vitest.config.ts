// vitest 配置：默认不启用 coverage，通过 pnpm test:coverage 生成覆盖率报告
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      // 排除纯编排/入口/外部进程边界：这些需真实 MySQL 实例才能覆盖，非纯函数逻辑不在单测范围
      exclude: ["src/**/__tests__/**", "src/cli.ts", "src/index.ts", "src/**/command.ts", "src/**/mysql-client.ts", "src/**/recover.ts", "src/**/report.ts"]
    }
  }
})
