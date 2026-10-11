---
"@fxri/opsbox": patch
---

`mysql-recover ddl` 产物 `manifest.json` 的 `generatedAt` 由 UTC ISO 时刻（如 `2026-10-11T04:11:00.000Z`）改为运行环境本地时区的 `YYYY-MM-DD HH:mm:ss`，便于使用者直接对读，不再需要按 8 小时时差换算。该字段无下游代码解析，`restore` 行为不受影响。
