# 操作手册

> 目标读者：任何想用起来的人。按「场景 → 该做什么 → 会发生什么」组织；每节末尾的「更多」指向对应文档。

## 一、首次使用

**目标**：装好工具集，跑通「查看命令树 → 看某一能力用法 → 执行能力」的最小闭环。

| 步骤 | 该做什么 | 会发生什么 |
| --- | --- | --- |
| 1 安装 | `pnpm i -g @fxri/opsbox`（推荐；项目 devDependency 见[新手指南 · 安装](./getting-started#安装)） | 全局可用 `opsbox` 命令 |
| 2 看命令树 | `opsbox --help` | 列出全部能力与每行的简单说明 |
| 3 看能力用法 | `opsbox <能力> --help` | 列出该能力的子命令、选项与默认值 |
| 4 预演再执行 | 先加 `--dry-run`，确认无误后去掉 | `--dry-run` 只做前置校验并打印计划，不落盘 |

平台在运行期自动探测，无需手工指定；数据目录、二进制目录、服务名等默认值随平台给出，均可经命令选项覆盖。

## 二、MySQL 库恢复（mysql-recover）

**目标**：重装 MySQL 后，从遗留的数据目录还原库结构与数据。

能力分两阶段，`ddl` 只读、不触碰实例；`restore` 据产物把孤儿库挂回实例。

| 场景 | 该做什么 | 会发生什么 |
| --- | --- | --- |
| 生成 DDL 产物 | `opsbox mysql-recover ddl --data <数据目录> --out .opsbox` | 从数据目录的 SDI 还原逐表 `CREATE TABLE`，落盘 `ddl/` 与 `manifest.json` |
| 只看某个库 | `opsbox mysql-recover ddl --only <库名>` | 仅处理指定库（`--only` 可多次传入） |
| 把孤儿库挂回实例 | `opsbox mysql-recover restore --work .opsbox --user root` | 依 `manifest.json` 走 Phase 0~4：冷备 → 停靠 → 建表 → 导入表空间 → 校验 |
| 先看计划 | 对 `restore` 加 `--dry-run` | 仅做前置校验并打印执行计划，不落盘 |
| 跳过冷备 / 校验 | `--skip-backup` / `--skip-validate` | 分别跳过整目录冷备与恢复后 Phase 4 校验（谨慎使用） |

⚠️ `restore` 缺省交互式掩码输入口令（非交互终端拒绝读取），也可用 `--password` 传入；`restore` 缺失 `ddl` 产物时以明确中文错误终止，提示先执行 `ddl`。

更多见[完整攻略 · MySQL 库恢复](./guide#mysql-库恢复-mysql-recover)。

## 三、项目目录改名（project-rename）

**目标**：项目目录改名后，把各宿主（IDE / 编辑器）中跟随目录名的关联状态一并迁移到新路径。项目目录内的内容不动，由改名动作自身承载。

**第一次用？按这五步走**：

| 步 | 做什么 | 会发生什么 |
| --- | --- | --- |
| 1 备好前提 | 关闭目标宿主，记下旧、新路径 | ⚠️ 迁移前须关闭宿主，避免其改写状态文件与迁移动作竞争 |
| 2 预览 | `opsbox project-rename <旧路径> <新路径> --dry-run` | 只输出迁移计划，不落盘；先确认改写哪些文件、搬迁哪些目录 |
| 3 第一趟 | `opsbox project-rename <旧路径> <新路径>` | 改写文本载体、丢弃缓存、搬迁目录、备份二进制状态，落 `resume.json`，最后移动项目目录 |
| 4 用新路径打开项目 | 让宿主按新路径生成新的工作区 id 目录 | 新工作区 id 由宿主生成、不可预先推算，故须先完成第一趟再续迁 |
| 5 第二趟 | `opsbox project-rename <旧路径> <新路径> --resume` | 按 `resume.json` 清单定位宿主新 id 目录，落位二进制状态副本并清理旧工作区目录 |

**检查点**：第 3 步后旧路径应已不存在、新路径出现且其下含 `.opsbox/project-rename/<时间戳>/` 备份；第 5 步后宿主里该项目的历史 / 工作区应指向新路径。

**回滚**：备份目录默认 `<旧路径>/.opsbox/project-rename/<时间戳>`，随目录改名移动到 `<新路径>` 下；需要回退时据其中备份还原。

**常用变体**：

| 选项 | 作用 |
| --- | --- |
| `--host <id>`（可多次传入） | 限定宿主；缺省迁移全部已检出宿主 |
| `--yes` | 跳过交互确认 |
| `--backup-dir <dir>` | 指定备份根 |
| `--no-backup` | 跳过备份（危险：将无法回滚） |
| `--format json` | 结果摘要输出到 stdout，见[五、机器可读输出](#五机器可读输出) |

更多见[完整攻略 · 项目目录改名](./guide#项目目录改名-project-rename)。

## 四、配置分层体检

**目标**：只读查看三层配置文件的生效情况与来源，不打印任何配置值。

```bash
opsbox config status                 # 三层命中 / 来源层 / 环境变量层
opsbox config status --format json   # JSON 载荷输出到 stdout
opsbox config status --cwd <path>    # 指定向上查找的起始目录
```

`config status` 只读、退出码恒 0；它只列来源层与命中的环境变量键名，**不打印配置值**（避免把个人规则、本机路径落到终端 / CI 日志）。

更多见[配置参考](./config)与 [CLI 参考 · config](./cli#config)。

## 五、机器可读输出

**目标**：把命令结果交给脚本消费。

| 命令 | `--format json` 载荷 |
| --- | --- |
| `mysql-recover ddl` | 产物清单 |
| `project-rename` | 结果摘要 |
| `config status` | 体检报告 |

⚠️ 机器载荷只走 stdout，一切诊断 / 提示 / 告警走 stderr；`--format` 传入非法值时 stderr 告警并置退出码 1，不产出载荷。`mysql-recover restore` 返回 `void`，未接入 `--format`。

更多见[完整攻略 · 机器可读输出](./guide#机器可读输出)。

## 六、退出码与错误

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功（含 `config status` 正常路径） |
| `1` | 操作失败或参数错误、校验不通过、文件 / 目录异常等 |

未命中中文映射的 commander 原生错误（帮助 / 版本）原样放行。详见 [CLI 参考 · 退出码](./cli#退出码)。

## 相关页面

- 快速上手 → [新手指南](./getting-started)
- 架构与完整流程 → [完整攻略](./guide)
- 查命令参数 → [CLI 参考](./cli)
- 遇到问题 → [FAQ](./faq)
