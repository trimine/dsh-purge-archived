# Changelog

All notable changes to `dsh-purge-archived` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.1 — 2026-11-05

First published release. `1.0.0` was an internal build and was never published to npm, so everything below is new to anyone installing from the registry.

### Added

- **Bulk cleanup panel** — a first-class sidebar entry ("Clean up archived chats" / 清理已归档对话) listing every archived conversation with its title, on-disk size, and last activity. Select any rows, select all, or delete everything at once.
- **Dangling-entry cleanup** — conversations whose log files were already deleted by hand still leave an archive mark and workspace membership behind. They are detected automatically, shown as "No log" / 日志已丢失, and can be cleaned in one click.
- **Per-conversation details** — expand a row to inspect the session ID, log folder(s), log file(s) with sizes, projection-cache path, working directory, creation time, log format generation, and total footprint. Session IDs and every path have a one-click copy button.
- **Bilingual documentation** — English and 中文 in one README, plus `LICENSE`, keywords, repository metadata, and a publish checklist.
- **Two Host routes** — `POST /dsh-purge-archived/scan` (read-only listing) and `POST /dsh-purge-archived/delete`.

### Changed

- **Display name** is now "Clean up archived chats" / 清理已归档对话 in the Plugins page, matching the sidebar panel.
- **Package name** is now the publishable `dsh-purge-archived` (was `@local/dsh-purge-archived`); the client module id and the bundle patch name follow it.
- The deletion gate now accepts two kinds of entry instead of one: an id in the durable archive set, or an id with no stored log and no live session (pure registry residue). An ordinary, still-stored, unarchived conversation is still always refused.

### Fixed

- The **"Delete permanently" button in the confirmation dialog** rendered white-on-white and lost its label under some themes. Destructive buttons now carry inline styles with a hard-coded colour fallback, so a missing or overridden theme token can no longer hide the text.
- Multi-selection confirmation copy now distinguishes "all selected entries have no log" from "these logs will be deleted", instead of always claiming a disk deletion.

---

## 1.0.1 — 2026-11-05（中文）

首个正式发布版本。`1.0.0` 为内部构建、从未发布到 npm，因此以下内容对任何从 registry 安装的用户都是新增的。

### 新增

- **批量清理面板** —— 侧边栏一级入口「清理已归档对话」，列出全部已归档对话的标题、磁盘占用与最近活动时间；支持逐条勾选、全选、批量删除。
- **无效条目清理** —— 曾被手动删掉日志文件的对话仍会残留归档标记与工作区成员记录；插件会自动识别并标记为「日志已丢失」，可一键清干净。
- **单条详情** —— 展开条目可查看会话 ID、日志目录、日志文件及大小、投影缓存路径、工作目录、创建时间、日志格式代与合计占用；会话 ID 与每个路径都带一键复制按钮。
- **双语文档** —— README 中英双语，并补齐 `LICENSE`、关键词、仓库元数据与发布清单。
- **两个 Host 路由** —— `POST /dsh-purge-archived/scan`（只读列举）与 `POST /dsh-purge-archived/delete`。

### 变更

- **显示名称** 改为「清理已归档对话」/ “Clean up archived chats”，与侧边栏面板保持一致。
- **包名** 改为可直接发布的 `dsh-purge-archived`（原为 `@local/dsh-purge-archived`），客户端模块 id 与 bundle patch 名称同步调整。
- 删除闸门从一类放宽为两类：存在于持久化归档集合中的 id，或「磁盘上已无日志且不是活会话」的 id（纯注册表残留）。普通、未归档、日志仍在的对话仍然一律拒绝。

### 修复

- 确认对话框中的 **「永久删除」按钮** 在部分主题下白底白字、文字不可见。危险按钮改用行内样式并给主题变量加硬编码兜底色，主题 token 缺失或被覆盖时也不会再吞掉文字。
- 多选删除时，对话框文案会区分「所选条目均已无日志」与「这些日志将被删除」，不再一律声称会删除磁盘文件。
