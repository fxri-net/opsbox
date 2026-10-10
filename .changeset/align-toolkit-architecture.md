---
"@fxri/opsbox": minor
---

新增：对齐 toolkit 架构，补齐配置分层、机器可读输出与升级提示等横切基础设施
  - 新增三层配置体系（全局 / 项目 / 本地），新增 opsbox config status 命令，mysql-recover / project-rename 接入配置档位
  - 新增机器可读输出契约：mysql-recover ddl 与 project-rename 支持 --format json，manifest 写盘携带 schemaVersion
  - 新增版本比较与升级提示：父进程零网络读缓存，缓存过期派生后台 worker 刷新，支持 OPSBOX_NO_UPDATE_CHECK 关闭
  - 补齐 NOTICE / TRADEMARK.md 版权法务文件，并接入 package.json files 与 README
