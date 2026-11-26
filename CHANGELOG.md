# Changelog / 更新记录

## 1.1.1

- 中文：README 和 npm 包中的 AI 贡献者仅按模型名称署名，不再列出模型来源或路由标识。开发者与维护者仍为 trimine。本次不改变插件功能。
- English: The README and npm package credit AI contributors by model name only, without provider or routing identifiers. trimine remains the developer and maintainer. Plugin behavior is unchanged.

## 1.1.0 — 2026-11-16

### 中文

**恢复插件内删除，并改为持锁删除。** 不再需要在 DSH 之外手动清理磁盘文件。

- 删除前通过 `sessionPersistence.open(id, 'write')` 取得跨进程写入锁；持锁期间删除日志文件，释放后再清理归档标记、工作区成员与投影缓存。
- 删除后重新校验 `stat(id)`：日志仍在则不动登记记录，返回 `LOG_STILL_PRESENT`，避免假删除。
- 会话正在打开或存在运行中的写入者时拒绝删除（`SESSION_IN_USE` / `LOCK_UNAVAILABLE`），不再要求重启 DSH。
- 路径取自后端返回的 `location`，不再假设 `DSH_HOME` 布局，支持自定义存储根目录。
- 投影缓存改为通过存储域记录删除，而非按固定路径删文件。
- 工作区成员对所有工作区无条件执行幂等 detach，修复成员被过滤后漏清理的问题。
- 批量删除串行化；重复 id 只处理一次；非法 id 整批拒绝。
- 扫描与删除仍要求 DSH owner 身份与同源请求。

### English

**Restored in-plugin deletion, now lock-based.** No more manual disk cleanup outside DSH.

- Before deleting, take the cross-process writer lock via `sessionPersistence.open(id, 'write')`; remove log files while holding it, then clear the archive mark, workspace membership and projection cache.
- Re-check `stat(id)` afterwards: if a log survives, registry state is left untouched and `LOG_STILL_PRESENT` is returned, so a deletion is never faked.
- Refuse when the conversation is open or has a running writer (`SESSION_IN_USE` / `LOCK_UNAVAILABLE`); no DSH restart is required.
- Paths come from the backend's `location`, so custom storage roots work instead of assuming the `DSH_HOME` layout.
- The projection cache is cleared through the storage domain record rather than a fixed file path.
- Workspace membership is detached idempotently on every workspace, fixing members hidden by the filtered getter.
- Batch deletions are serialized; duplicate ids run once; malformed ids reject the whole batch.
- Scan and delete still require an authenticated DSH owner and same-origin requests.

## 1.0.2 — 2026-11-10

### 中文

**重要变更：暂停 DSH 运行期间的本地会话删除。** 此版本保留扫描和详情查看，不执行文件、缓存或登记记录清理，也不包含离线清理工具。

- 澄清操作对象是本地会话存储，而非云端数据；DSH 登记记录不是 Windows 注册表。
- 扫描和删除入口增加 DSH owner 身份验证。删除入口明确返回 `UNSUPPORTED_SAFE_DELETE`，避免与会话恢复或其他写入者竞争。
- 归档状态和文件系统读取失败不再静默视为文件不存在；拒绝链接存储路径。
- 修复语言跟随 DSH 设置、复制文件路径混入大小、弹窗焦点管理、重复提交、部分失败重试和请求取消/超时。
- 增加批量上限和活会话保护；删除暂停状态在界面中明确显示。
- 重写中英双语用户说明，列出实际可用功能、默认存储布局限制和数据范围。
- 新增 19 项隔离回归测试，覆盖 Host 安全边界与 Client 交互。

### English

**Important change: deletion of local conversation data while DSH is running is paused.** Scanning and details remain available. This version does not remove files, caches or registry records and does not include an offline cleanup utility.

- Clarify that the scope is local conversation storage, not cloud data; DSH registry records are not the Windows Registry.
- Require authenticated DSH owner access for scan and deletion entry points. Deletion explicitly returns `UNSUPPORTED_SAFE_DELETE` to avoid races with session restoration and other writers.
- Do not silently treat archive-state or filesystem read errors as missing files; reject linked storage paths.
- Fix DSH locale synchronization, raw path copying, modal focus management, duplicate submissions, partial retries and request cancellation/timeouts.
- Add batch limits and live-session protection; clearly display the paused deletion state.
- Rewrite the bilingual user documentation with available features, default-layout limitations and data scope.
- Add 19 isolated regression tests for Host security boundaries and Client interactions.

## 1.0.1 — 2026-11-05

### 中文

- 新增侧边栏归档管理面板、批量选择及无效条目清理入口。
- 新增会话 ID、日志文件及大小、缓存路径、工作目录和日志格式等详情。
- 统一插件显示名称为「清理已归档对话」，补充中文文档。
- 修复确认按钮文字不可见及批量确认文案问题。

> 此版本的运行期删除实现已在 1.0.2 中暂停，不应将旧版行为理解为当前可用能力。

### English

- Add a sidebar archive-management panel, batch selection and missing-log cleanup entry points.
- Add session IDs, log files and sizes, cache paths, working directories and log-format details.
- Align the display name to “Clean up archived chats” and add Chinese documentation.
- Fix confirmation-button text visibility and batch-confirmation wording.

> The runtime deletion implementation from this version is paused in 1.0.2; historical behavior does not describe the current feature set.
