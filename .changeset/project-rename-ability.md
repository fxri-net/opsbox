---
"@fxri/opsbox": minor
---

新增：新增 project-rename 能力，项目目录改名后自动迁移各宿主跟随目录名的关联状态
  - 新增 project-rename 命令与 --dry-run / --yes / --host / --backup-dir / --no-backup / --resume 选项
  - 双趟迁移：第一趟改写文本与全局状态库引用、目录改名、丢弃缓存；第二趟按新工作区反查并补齐状态库、清理旧目录
