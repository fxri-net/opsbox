// ESLint 扁平配置：@eslint/js 推荐 + typescript-eslint 推荐
import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**", ".opsbox/**", "docs/.vitepress/dist/**", "docs/.vitepress/cache/**", "docs/.vitepress/.temp/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // scripts/ 下的 Node 脚本（非 TS 源码）直接跑在 Node 环境，未引入 globals 包故按需声明
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    rules: {
      // SDI 的 dd_object 为 MySQL 导出的动态 JSON，字段随版本浮动，跨模块 interop 需 any 兜底
      "@typescript-eslint/no-explicit-any": "off",
      // 任务元数据行/报告文本需用全角空格与特殊排版，模板字符串中属有意书写
      "no-irregular-whitespace": "off"
    }
  }
)
