# dsh-purge-archived

[中文](#中文) | [English](#english)

## 中文

**清理已归档对话**是 DeepSeek Harness 的本地会话清理插件：在插件里选好已归档对话，点一次删除，由插件完成本地日志、缓存与登记记录的清理，不需要手动翻磁盘。

### 为什么需要它

DSH 本身不提供会话删除：归档只写一个标记，日志文件会一直留在磁盘上。本插件补上这个缺失的操作，并且只在**归档集合内**的对话上执行。

### 删除是怎么做的

1. 先取得该会话的**存储写入锁**（`sessionPersistence.open(id, 'write')`）。这把锁是跨进程的：拿到它就说明没有别的 DSH 进程、也没有正在运行的 Agent 持有该会话。
2. 持锁删除该会话目录下的日志文件（所有格式代）。
3. 释放锁并确认 `stat(id)` 已查不到该会话；**确认失败就不动登记记录**，避免“列表里没了、磁盘还在”。
4. 再清理：归档标记、各工作区成员记录、投影缓存记录。
5. 通知已连接的客户端移除该行。

日志先删、登记后删，是为了让中断的操作退化成“无效条目”，下次再清理一次即可完成，不会出现数据假删除。

### 面板与入口

- 侧边栏 **清理已归档对话**：列出已归档对话与已无日志的残留条目，支持勾选、全选、批量删除。
- 会话「…」菜单 **永久删除…**：单条删除。
- 展开条目可查看会话 ID、日志目录、日志文件及大小、缓存状态、日志格式，并复制 ID 或路径。

### 会删除什么，不会删除什么

会删除：该会话的本地日志文件、会话目录、投影缓存记录、归档标记、工作区成员记录。

不会删除：工作目录里的文档或代码成果、被多个会话共享的附件、子会话中的历史副本、备份与外部导出。这些数据不属于单个对话独占，需要单独处理。

### 无法删除的情况

插件会明确报告，不会假装成功：

- 会话正在打开或仍有运行中的写入者 → 先关闭该对话或等本轮结束，再重试。
- 日志文件删不掉（被其他程序占用等）→ 登记记录保持不变，可重试；详情里有具体路径。
- 已不在归档集合中 → 拒绝删除，避免误删普通对话。

### 安装与更新

在 DSH 的 **插件 → 添加插件** 中输入 `dsh-purge-archived`。也可以通过 CLI：

```sh
dsh plugin --profile desktop add dsh-purge-archived
```

从源码目录安装时指向该目录即可（链接安装请保留目录）。升级后重启 DSH 并刷新页面。

### 兼容性与隐私

开发与验证环境为 DSH `0.2.1-rc.5`、Windows 桌面端；其他版本与平台未全面验证。依赖标准 Web/Desktop 组合中的会话持久化、工作区注册表、存储域与连接认证服务。

扫描与删除入口仅向通过 DSH 认证的 owner 开放，同源校验；插件不上传对话内容，也不访问外部网络。

问题反馈：[GitHub Issues](https://github.com/trimine/dsh-purge-archived/issues)。

## English

**Clean up archived chats** deletes archived DeepSeek Harness conversations from local storage, from inside the plugin — no manual digging through the disk.

### Why

DSH ships no conversation deletion: archiving only writes a mark, and the log stays on disk forever. This plugin adds that missing operation, restricted to conversations in the **archive set**.

### How deletion works

1. Take the conversation's **storage writer lock** (`sessionPersistence.open(id, 'write')`). The lock is cross-process: holding it proves no other DSH process and no running Agent owns the conversation.
2. While holding it, delete the log files (all format generations) in the conversation directory.
3. Release the lock and confirm `stat(id)` no longer resolves. **If that check fails, registry state is left untouched**, so a conversation never disappears from the list while its data survives.
4. Then clear the archive mark, every workspace membership, and the projection-cache record.
5. Notify connected clients so the row disappears immediately.

Logs are removed before registry state on purpose: an interrupted run degrades into a "dangling" entry that a later cleanup finishes, never into a fake deletion.

### Surfaces

- Sidebar **Clean up archived chats**: archived conversations plus entries whose log is already gone; select, select all, delete in bulk.
- Session `...` menu **Delete permanently…**: single deletion.
- Expand a row for the session ID, log directory, log files and sizes, cache state and log format, with copy buttons.

### What is and is not deleted

Deleted: the conversation's local log files, its session directory, projection-cache record, archive mark and workspace memberships.

Not deleted: documents or code in your working directory, attachments shared by several conversations, history copied into child sessions, backups and external exports. Those are not owned by a single conversation and need separate handling.

### When deletion is refused

The plugin reports the reason instead of pretending success:

- The conversation is open or still has a running writer → close it or wait for the turn to finish, then retry.
- The log file cannot be removed (held by another program, for example) → registry state stays unchanged and the operation can be retried; the exact path is in Details.
- The conversation is no longer in the archive set → refused, so ordinary conversations are never touched.

### Install and update

In DSH, open **Plugins → Add plugin** and enter `dsh-purge-archived`. Or:

```sh
dsh plugin --profile desktop add dsh-purge-archived
```

For a source checkout, point the plugin manager at that directory and keep it in place when linked. Restart DSH and refresh the page after updating.

### Compatibility and privacy

Developed and verified against DSH `0.2.1-rc.5` on Windows desktop; other versions and platforms are not comprehensively verified. Requires the standard Web/Desktop session persistence, workspace registry, storage domain and authenticated connection services.

Scan and delete entry points are restricted to an authenticated DSH owner and checked for same-origin requests. The plugin uploads no conversation content and makes no outbound network calls.

Report issues at [GitHub Issues](https://github.com/trimine/dsh-purge-archived/issues).

## 贡献者 / Contributors

开发者与维护者 / Developer and maintainer: [trimine](https://github.com/trimine).

共创模型 / AI collaborators:

- DeepSeek V4.1 Flash
- GPT-6 Astra
- Gemini 4 Carbon
- GPT-6.2 Astra
- Codex (GPT-5)

## License

MIT © 2026 trimine
