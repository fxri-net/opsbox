---
layout: home
# 首页无正文 h1，显式给 title 避免浏览器标签出现「方弦运维工具箱 - 方弦运维工具箱」重复
title: 跨平台运维能力集

hero:
  name: 方弦运维工具箱
  text: 跨平台运维能力集
  tagline: 把一次性运维脚本沉淀为可长期演进的工具集。以「能力」为单位组织，平台差异经适配层隔离、平台无关核心只写一份，Linux / macOS / Windows 开箱即用。
  actions:
    - theme: brand
      text: 30 秒上手
      link: ./getting-started
    - theme: alt
      text: 完整攻略
      link: ./guide
    - theme: alt
      text: GitHub
      link: https://github.com/fxri-net/opsbox

features:
  - icon: 🧩
    title: 以能力为单位
    details: 一能力一目录、自注册进单一 CLI 入口；新增能力不动其余代码，命令树按能力自动生长。
  - icon: 🌍
    title: 平台差异只隔离一处
    details: 所有能力默认全平台支持；平台特有操作（停服 / 起服 / 权限复位）收敛进 PlatformAdapter，平台无关核心只写一份。
  - icon: 🗄️
    title: MySQL 库恢复
    details: 重装 MySQL 后，从遗留的数据目录经 SDI 还原建表 DDL，再把孤儿库文件重新挂回实例——两阶段、可预演、可校验。
  - icon: 📁
    title: 项目目录改名
    details: 目录改名后，把各宿主（IDE / 编辑器）中跟随目录名的关联状态一并迁移到新路径，双趟续迁、可备份可回滚。
  - icon: ⚙️
    title: 三层配置体系
    details: 全局层 / 项目层 / 本地层分作用域落盘，段级整体覆盖 + 段内字段级浅合并，覆盖链一眼看清。
  - icon: 🤖
    title: 机器可读输出
    details: 关键命令支持 --format json，机器载荷只走 stdout、诊断提示只走 stderr，统一携带 schemaVersion 锚点供脚本消费。
---

## 30 秒上手

按你的包管理器选一条全局安装，随后查看命令树：

::: code-group

```sh [pnpm]
pnpm i -g @fxri/opsbox
```

```sh [npm]
npm i -g @fxri/opsbox
```

```sh [yarn]
yarn global add @fxri/opsbox
```

```sh [bun]
bun add -g @fxri/opsbox
```

:::

```sh
# 查看帮助（命令树）
opsbox --help

# 一个典型恢复流程：先生成 DDL 产物，再依产物把孤儿库挂回实例
opsbox mysql-recover ddl --data <MySQL 数据目录> --out .opsbox
opsbox mysql-recover restore --work .opsbox --user root
```

`restore` 缺省交互式输入口令（可用 `--password` 传入）；`--dry-run` 仅做前置校验并打印执行计划。

详细步骤见[新手指南](./getting-started)。

## 解决什么痛点

| 痛点 | 本工具的做法 |
| --- | --- |
| 一次性运维脚本散落各处，复用时找不到、改起来怕踩坑 | 把脚本沉淀为「能力」：一能力一目录、自注册进单一 CLI 入口，可长期演进 |
| 同一件事在 Linux / macOS / Windows 上写法不同，维护多份 | 平台差异经 `PlatformAdapter` 隔离，平台无关核心只写一份；平台运行期自动探测，无需手工指定 |
| 重装 MySQL 后旧数据目录还在，库却挂不回实例 | `mysql-recover` 两阶段恢复：`ddl` 只读还原建表语句，`restore` 把孤儿库文件重新挂回实例 |
| 项目目录改名后，IDE / 编辑器的历史、工作区关联全部失效 | `project-rename` 迁移各宿主中跟随目录名的关联状态，双趟续迁（`--resume`），可备份可回滚 |
| 配置项与个人偏好混在一起，团队配置被个人改动污染 | 三层配置分作用域：全局层个人跨项目、项目层团队共享、本地层个人私有（默认被 git 忽略） |
| 想在脚本 / 平台里消费命令结果，却只能人肉解析日志 | 关键命令支持 `--format json`，载荷只走 stdout、统一 `schemaVersion` 锚点 |

## 文档索引

| 文档 | 适合谁 |
| --- | --- |
| [新手指南](./getting-started) | 第一次接触，想快速跑起来 |
| [操作手册](./handbook) | 日常照着做：每个能力该说什么、做什么 |
| [完整攻略](./guide) | 了解架构：能力组织、平台适配层、三层配置、机器可读输出 |
| [CLI 参考](./cli) | 查命令、参数、默认值、退出码 |
| [API 参考](./api) | 作为库引入 Node 项目，写脚本或二次开发 |
| [配置参考](./config) | 查 `.opsboxrc.json` 字段 |
| [更新日志](./changelog) | 查各版本变更内容 |
| [FAQ](./faq) | 遇到问题先来这里找 |

## 环境要求

- Node.js >= 20.19.0

## 相关仓库文件

- [规范 SPEC.md](https://github.com/fxri-net/opsbox/blob/main/SPEC.md)：工具集结构约定与对外契约的单一事实源
