# dsh-purge-archived

[English](#english) | [中文](#中文)

## English

**Permanently delete archived conversations in DeepSeek Harness — the stored log, the projection cache, the archive mark, and the workspace membership.**

DeepSeek Harness deliberately ships no Session deletion: `@deepseek-ai/dsh-session-persistence-jsonl` documents that "logs accumulate under `root` until removed externally; the seam has no deletion API", and `@deepseek-ai/dsh-client-ui-workspace` lists "No Session deletion" as a known limitation. Archiving only sets a mark; the log stays on disk forever. This plugin adds exactly that one missing operation.

### Features

- **Delete permanently…** — a red row at the end of an archived Session's `...` menu, with a confirmation dialog.
- **Clean up archived chats** — a first-class sidebar panel (beside Plugins and Automation tasks) listing every archived conversation with its size, last activity, and title.
- **Bulk delete** — select any rows, or delete everything in one go.
- **Dangling-entry cleanup** — conversations whose log files were already deleted by hand still leave an archive mark and workspace membership behind. They are listed as **No log** and can be cleaned in one click.
- Bilingual UI (English / 简体中文), theme-token styling, keyboard-accessible dialog.

### What one purge removes

| Artifact | Path |
| --- | --- |
| Stored log generation(s) | `<DSH_HOME>/sessions/<project>/<sessionId>/` |
| Projection-cache checkpoint | `<DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json` |
| Archive mark | the registry's durable archive set |
| Workspace membership | every Workspace's `sessionIds` |

Connected Clients drop the row immediately through the ordinary `api-session/removed` notification.

**Safety.** Only two kinds of entry are accepted: an id in the durable archive set, or an id with no stored log and no live Session (pure registry residue). An ordinary, still-stored, unarchived conversation is always refused. The HTTP routes accept only a same-origin, JSON-bodied `POST`.

### Install

From the Plugins page: sidebar **Plugins** → **Add plugin** → type `dsh-purge-archived` → **Install**.

With the `dsh` CLI:

```sh
dsh plugin --profile desktop add dsh-purge-archived
```

From a local checkout, point the plugin manager at the directory:

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-purge-archived
```

A local directory install links the checkout, so the folder must stay in place.

After installing a *new version* of an already-installed plugin, restart DeepSeek Harness once so the Host half loads the fresh module, then refresh the page.

### Use

1. **Single conversation** — set the sidebar's view options to **All conversations** or **Archived only** so archived rows are visible, then open a row's `...` menu and pick **Delete permanently…**.
2. **Bulk** — click **Clean up archived chats** in the sidebar's panel list, select rows (or **Select all**), then **Delete selected**.
3. **Dangling entries** — the same page lists entries marked **No log**; **Clean up all N invalid entries** removes just those.

### Compatibility

Verified against DeepSeek Harness `0.2.1-rc.5` (V4 session-log generation, Windows desktop). The deletion path is format-agnostic: it removes the whole Session directory instead of naming a log file, so later log generations keep working.

Requires the `@deepseek-ai/dsh-client-ui-workspace` client package (part of the standard Web/Desktop composition) and the Workspace registry on the Host.

### Develop

Plain JavaScript, no build step. `index.js` is the Host half (Cordis plugin), `client.js` is the browser module (`window.__ModuleLoader__`), `cordis.patch.yml` inserts the row, `locale/*.json` carries the Plugin Manager metadata.

`index.js` exports `removeSessionArtifacts()` — the filesystem layer — so it can be exercised against a temporary DSH home without a running Host.

### Publish checklist

The manifest still carries `OWNER` placeholders in `author`, `repository`, `homepage`, `bugs`, and in `LICENSE`. Replace them, then:

```sh
# 1. rename if you want your own scope (also update client.js `id:` and cordis.patch.yml `name:`)
npm pkg set name=@you/dsh-purge-archived

# 2. publish
npm publish --access public
```

A published package installs by name in the Add-plugin wizard. For a marketplace listing, submit the repository to the community plugin index your deployment points at (the `plugin-market` row's `indexes` config).

## 中文

**彻底删除 DeepSeek Harness 中已归档的对话 —— 会话日志、投影缓存、归档标记与工作区成员记录一并清除。**

DeepSeek Harness 有意不提供会话删除能力：`@deepseek-ai/dsh-session-persistence-jsonl` 明确写着「日志会在 `root` 下不断累积，直到被外部删除；该接缝没有删除 API」，`@deepseek-ai/dsh-client-ui-workspace` 也把「No Session deletion（不支持删除会话）」列为已知限制。归档只是打了一个标记，日志文件永远留在磁盘上。这个插件补上的正是这一个缺失的操作。

### 功能

- **永久删除…** —— 已归档会话「…」菜单末尾的一行红色操作，带二次确认对话框。
- **清理已归档对话** —— 侧边栏一级面板（与「插件」「自动化任务」同级），列出每个已归档对话的标题、占用大小与最近活动时间。
- **批量删除** —— 勾选任意条目，或一次全选删除。
- **无效条目清理** —— 曾被手动删掉日志文件的对话，归档标记与工作区成员记录仍会残留；它们会被标记为「日志已丢失」，可一键清干净。
- 中英双语界面、跟随主题 token 的样式、可用键盘操作的对话框。

### 一次删除会移除什么

| 内容 | 位置 |
| --- | --- |
| 会话日志（全部格式代） | `<DSH_HOME>/sessions/<项目>/<sessionId>/` |
| 投影缓存检查点 | `<DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json` |
| 归档标记 | 注册表中持久化的归档集合 |
| 工作区成员记录 | 各 Workspace 的 `sessionIds` |

已连接的客户端会通过标准的 `api-session/removed` 通知立即移除该行，无需刷新页面。

**安全性。** 只接受两类条目：存在于持久化归档集合中的 id，或「磁盘上已无日志且不是活会话」的 id（纯注册表残留）。普通、未归档、日志仍在的对话一律拒绝。两个 HTTP 路由只接受同源、JSON 体的 `POST`。

### 安装

插件页安装：侧边栏 **插件** → **添加插件** → 输入 `dsh-purge-archived` → **安装**。

`dsh` 命令行安装：

```sh
dsh plugin --profile desktop add dsh-purge-archived
```

从本地目录安装，直接把插件管理器指向该目录即可：

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-purge-archived
```

本地目录安装是 link 方式，源目录不能删除或移动。

已安装插件升级到新版本后，需要重启一次 DeepSeek Harness 让 Host 半加载新模块，然后刷新页面。

### 使用

1. **单个对话** —— 先把侧边栏「视图选项」切到 **全部对话** 或 **仅归档** 让归档行可见，再打开该行「…」菜单选择 **永久删除…**。
2. **批量** —— 点击侧边栏面板列表里的 **清理已归档对话**，勾选条目（或 **全选**），再点 **删除所选**。
3. **无效条目** —— 同一页面中标记为「日志已丢失」的条目，用 **清理全部 N 个无效条目** 一次清掉。

### 兼容性

在 DeepSeek Harness `0.2.1-rc.5`（V4 会话日志格式，Windows 桌面端）上验证通过。删除逻辑与日志格式无关：它整目录删除，而不是写死某个日志文件名，因此后续日志格式代仍可正常工作。

依赖 `@deepseek-ai/dsh-client-ui-workspace` 客户端包（标准 Web/桌面组合自带）以及 Host 侧的 Workspace 注册表。

### 开发

纯 JavaScript，无需构建。`index.js` 是 Host 半（Cordis 插件），`client.js` 是浏览器模块（`window.__ModuleLoader__`），`cordis.patch.yml` 插入插件行，`locale/*.json` 提供插件管理器的显示元数据。

`index.js` 导出了文件系统层 `removeSessionArtifacts()`，可以针对临时 DSH 目录单独测试，无需运行 Host。

### 发布清单

清单文件里的 `author`、`repository`、`homepage`、`bugs` 以及 `LICENSE` 仍带 `OWNER` 占位符，替换后：

```sh
# 1. 想用自己的 scope 就改名（同时改 client.js 的 id: 与 cordis.patch.yml 的 name:）
npm pkg set name=@you/dsh-purge-archived

# 2. 发布
npm publish --access public
```

发布后即可在「添加插件」中按包名安装。要在插件市场展示，需要向部署所指向的社区插件索引（`plugin-market` 行的 `indexes` 配置）提交条目。

## License

MIT
