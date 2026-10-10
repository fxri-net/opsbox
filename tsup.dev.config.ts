import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"], // 入口文件
  outDir: "dist", // 输出目录
  splitting: false, // 是否开启代码分割
  clean: true, // 是否清理 dist 目录
  dts: false, // 调试构建跳过 .d.ts 类型声明，加快本地编译
  format: ["esm"], // 输出 ESM 格式
  external: ["commander", "node-sqlite3-wasm"], // 运行时依赖不打包进产物（wasm 依赖须保留其自身路径解析）
  minify: process.env.NODE_ENV === "production",
  target: "node20" // Node.js 版本目标
})
