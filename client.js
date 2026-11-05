/**
 * Client half of the archived-Session purge bundle.
 *
 * Three surfaces, one operation:
 *   - a row on a Session's "..." menu, only on a row the archive set contains;
 *   - a sidebar panel entry ("清理已归档对话") opening the bulk cleanup page;
 *   - one frame-wide confirmation dialog shared by both.
 *
 * Deletion itself is one same-origin JSON POST to the Host half's routes,
 * because a plain-JS bundle cannot add a generated Remote namespace.
 */
window.__ModuleLoader__.load({
  id: 'dsh-purge-archived',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dshPurgeArchived'
    const ROUTE_DELETE = '/dsh-purge-archived/delete'
    const ROUTE_SCAN = '/dsh-purge-archived/scan'
    const PANEL_ID = 'purge-archived'

    const DICT = {
      en: {
        menuItem: 'Delete permanently…',
        panelLabel: 'Clean up archived chats',
        pageTitle: 'Clean up archived conversations',
        pageIntro:
          'Archived conversations stay on disk until removed here. Deleting one removes its stored log, its projection cache, its archive mark, and its workspace membership.',
        summary: '{archived} archived · {dangling} without a stored log · {size} on disk',
        refresh: 'Refresh',
        selectAll: 'Select all',
        clearSelection: 'Clear',
        deleteSelected: 'Delete selected ({count})',
        deleteDangling: 'Clean up all {count} invalid entries',
        empty: 'No archived conversations.',
        emptyDangling: 'Nothing to clean up: every archived conversation still has its log.',
        loading: 'Reading archived conversations…',
        columnSession: 'Conversation',
        columnSize: 'On disk',
        columnUpdated: 'Last activity',
        badgeDangling: 'No log',
        badgeDanglingHint: 'The stored log is already gone; only the archive mark and workspace membership remain.',
        badgeUnarchived: 'Workspace residue',
        untitled: 'Untitled',
        title: 'Delete this conversation permanently?',
        titleMany: 'Delete {count} conversations permanently?',
        body: 'The complete stored log of "{title}" will be removed from disk.',
        bodyMany: 'The complete stored logs of {count} conversations will be removed from disk.',
        bodyDangling: 'Nothing is left on disk for "{title}"; only its archive mark and workspace membership are removed.',
        bodyManyDangling: 'Nothing is left on disk for these {count} conversations; only their archive marks and workspace memberships are removed.',
        hint: 'This cannot be undone, and the conversations cannot be restored or exported afterwards.',
        cancel: 'Cancel',
        confirm: 'Delete permanently',
        confirmMany: 'Delete {count}',
        working: 'Deleting…',
        errNotArchived: 'This conversation is no longer archived, so nothing was deleted.',
        errInvalidId: 'A conversation id was rejected, so nothing was deleted.',
        errLive: 'That conversation is live in this process, so nothing was deleted.',
        errBusy: 'The log file is still held open by this process. Restart DSH and try again.',
        errNetwork: 'The Host did not answer the request.',
        errGeneric: 'The deletion failed: {detail}',
        errMore: '{detail} (+{count} more)',
        errScan: 'Reading archived conversations failed: {detail}',
      },
      zh: {
        menuItem: '永久删除…',
        panelLabel: '清理已归档对话',
        pageTitle: '清理已归档对话',
        pageIntro:
          '归档只做标记，日志仍留在磁盘上。在这里删除会同时移除会话日志、投影缓存、归档标记与工作区成员记录。',
        summary: '已归档 {archived} 个 · 无日志的无效条目 {dangling} 个 · 占用 {size}',
        refresh: '刷新',
        selectAll: '全选',
        clearSelection: '取消选择',
        deleteSelected: '删除所选（{count}）',
        deleteDangling: '清理全部 {count} 个无效条目',
        empty: '没有已归档的对话。',
        emptyDangling: '没有需要清理的条目：每个归档对话的日志都还在。',
        loading: '正在读取已归档对话…',
        columnSession: '对话',
        columnSize: '占用',
        columnUpdated: '最近活动',
        badgeDangling: '日志已丢失',
        badgeDanglingHint: '磁盘上的日志已被删除，只剩归档标记和工作区成员记录。',
        badgeUnarchived: '工作区残留',
        untitled: '未命名',
        title: '永久删除这个对话？',
        titleMany: '永久删除 {count} 个对话？',
        body: '“{title}”的完整日志将从磁盘删除。',
        bodyMany: '这 {count} 个对话的完整日志将从磁盘删除。',
        bodyDangling: '“{title}”在磁盘上已无内容，只移除它的归档标记与工作区成员记录。',
        bodyManyDangling: '这些对话在磁盘上已无内容，只移除它们的归档标记与工作区成员记录。',
        hint: '此操作无法撤销，删除后无法恢复或导出这些对话。',
        cancel: '取消',
        confirm: '永久删除',
        confirmMany: '删除 {count} 个',
        working: '正在删除…',
        errNotArchived: '该对话已不在归档中，未删除任何内容。',
        errInvalidId: '对话 id 未通过校验，未删除任何内容。',
        errLive: '该对话仍在本进程中运行，未删除任何内容。',
        errBusy: '日志文件仍被本进程占用。请重启 DSH 后再试。',
        errNetwork: 'Host 未响应请求。',
        errGeneric: '操作失败：{detail}',
        errMore: '{detail}（另有 {count} 个失败）',
        errScan: '读取已归档对话失败：{detail}',
      },
    }

    const CSS = `
.dsh-pa-menu-item {
  display: flex; align-items: center; box-sizing: border-box; width: 100%;
  margin: 4px 0 0; padding: 7px 10px; border: 0;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: transparent; color: var(--dsw-alias-state-error-primary);
  font: inherit; font-size: 13px; line-height: 18px; text-align: left; cursor: pointer;
}
.dsh-pa-menu-item:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-pa-menu-item:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dsh-pa-backdrop {
  position: fixed; inset: 0; z-index: 60; display: grid; place-items: center;
  background: rgba(0, 0, 0, 0.45); pointer-events: auto;
}
.dsh-pa-dialog {
  box-sizing: border-box; width: min(460px, calc(100vw - 48px)); padding: 20px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  font-size: 13px; line-height: 20px;
}
.dsh-pa-title { margin: 0 0 10px; font-size: 15px; font-weight: 600; line-height: 22px; }
.dsh-pa-body { margin: 0 0 8px; }
.dsh-pa-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-pa-error { margin: 12px 0 0; color: var(--dsw-alias-state-error-primary); }
.dsh-pa-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.dsh-pa-btn { font: inherit; font-size: 13px; }
.dsh-pa-page { height: 100%; overflow: auto; box-sizing: border-box; padding: 28px 24px 40px; }
.dsh-pa-page-inner { max-width: 900px; margin: 0 auto; }
.dsh-pa-page-title { margin: 0 0 6px; font-size: 20px; font-weight: 600; line-height: 28px; }
.dsh-pa-page-intro { margin: 0 0 18px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.dsh-pa-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px 10px 0 0; border-bottom: 0;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-pa-toolbar-spacer { flex: 1 1 auto; }
.dsh-pa-summary { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-pa-list {
  margin: 0; padding: 0; list-style: none;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 0 0 10px 10px;
  background: var(--dsw-alias-bg-layer-1); overflow: hidden;
}
.dsh-pa-row {
  display: grid; grid-template-columns: 24px minmax(0, 1fr) auto auto;
  align-items: center; gap: 12px;
  padding: 10px 14px; border-top: 1px solid var(--dsw-alias-border-l1);
  font-size: 13px;
}
.dsh-pa-row:first-child { border-top: 0; }
.dsh-pa-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-pa-row-main { min-width: 0; }
.dsh-pa-row-title {
  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}
.dsh-pa-row-id {
  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-secondary); font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.dsh-pa-row-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: nowrap; }
.dsh-pa-badge {
  display: inline-flex; align-items: center; height: 18px; padding: 0 7px;
  border-radius: 9px; font-size: 11px; white-space: nowrap;
  border: 1px solid var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-state-warn-primary);
}
.dsh-pa-badge-info { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.dsh-pa-empty { padding: 40px 16px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.dsh-pa-check { width: 15px; height: 15px; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
`

    const prefersChinese = (() => {
      try {
        return String(navigator.language || '').toLowerCase().startsWith('zh')
      } catch {
        return false
      }
    })()

    function interpolate(text, vars) {
      if (vars === undefined) return text
      return text.replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
      )
    }

    /** Prefer the slot-projected translator; fall back to the local dictionary. */
    function translate(t, key, vars) {
      if (typeof t === 'function') {
        try {
          const value = t(key, vars)
          if (typeof value === 'string' && value.length > 0 && value !== key) return value
        } catch {
          // Fall through to the local dictionary.
        }
      }
      const dict = prefersChinese ? DICT.zh : DICT.en
      return interpolate(dict[key] ?? key, vars)
    }

    /** Copy without a translator (panel label thunks and page chrome). */
    function copy(key, vars) {
      return interpolate((prefersChinese ? DICT.zh : DICT.en)[key] ?? key, vars)
    }

    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || bytes <= 0) return '—'
      const units = ['B', 'KB', 'MB', 'GB']
      let value = bytes
      let unit = 0
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
      }
      return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
    }

    function formatTime(ms) {
      if (typeof ms !== 'number' || ms <= 0) return '—'
      try {
        return new Date(ms).toLocaleString()
      } catch {
        return '—'
      }
    }

    // One pending request plus a data revision shared by the menu row, the
    // dialog, and the cleanup page.
    const store = { pending: null, version: 0 }
    const listeners = new Set()
    function emit() {
      for (const listener of [...listeners]) listener()
    }
    function subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
    function setPending(next) {
      store.pending = next
      emit()
    }
    function bumpVersion() {
      store.version += 1
      emit()
    }
    function usePending() {
      return React.useSyncExternalStore(
        subscribe,
        () => store.pending,
        () => store.pending,
      )
    }
    function useVersion() {
      return React.useSyncExternalStore(
        subscribe,
        () => store.version,
        () => store.version,
      )
    }

    /** Map one Host result code onto localized copy. */
    function describeFailure(result, t) {
      const code = result?.code
      if (code === 'NOT_ARCHIVED') return translate(t, 'errNotArchived')
      if (code === 'INVALID_SESSION_ID') return translate(t, 'errInvalidId')
      if (code === 'SESSION_LIVE') return translate(t, 'errLive')
      if (code === 'LOG_DELETE_FAILED') {
        const detail = String(result?.message ?? '')
        if (/EBUSY|EPERM|EACCES|resource busy|being used by another process/i.test(detail)) {
          return translate(t, 'errBusy')
        }
        return translate(t, 'errGeneric', { detail: detail || code })
      }
      return translate(t, 'errGeneric', { detail: code ?? 'unknown' })
    }

    async function postJson(url, body) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        })
        const payload = await response.json().catch(() => null)
        if (payload !== null) return payload
        return { ok: false, code: `HTTP_${response.status}` }
      } catch {
        return { ok: false, code: 'NETWORK' }
      }
    }

    function requestPurge(sessionIds) {
      return postJson(ROUTE_DELETE, { sessionIds })
    }

    function requestScan() {
      return postJson(ROUTE_SCAN, {})
    }

    /** Session menu row: visible only on a Session the archive set contains. */
    function PurgeMenuItem(props) {
      const { sessionId, displayTitle, useWorkspaces, useMenuOpenState, t } = props
      const archived =
        typeof useWorkspaces === 'function'
          ? useWorkspaces(
              (snapshot) =>
                Array.isArray(snapshot?.archivedSessionIds) &&
                snapshot.archivedSessionIds.includes(sessionId),
            )
          : false
      const menuState = typeof useMenuOpenState === 'function' ? useMenuOpenState() : undefined
      const closeMenu = menuState?.[1]

      if (archived !== true) return null

      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, CSS),
        h(
          'button',
          {
            key: 'row',
            type: 'button',
            role: 'menuitem',
            className: 'dsh-pa-menu-item',
            onClick: () => {
              if (typeof closeMenu === 'function') closeMenu(false)
              setPending({ ids: [sessionId], title: displayTitle ?? '', dangling: false })
            },
          },
          translate(t, 'menuItem'),
        ),
      )
    }

    /** Frame-wide confirmation dialog shared by the menu row and the page. */
    function PurgeDialog(props) {
      const { t } = props
      const request = usePending()
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const cancelRef = React.useRef(null)

      React.useEffect(() => {
        if (request === null) return undefined
        setError(null)
        setBusy(false)
        const focusTimer = setTimeout(() => cancelRef.current?.focus(), 0)
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          setPending(null)
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => {
          clearTimeout(focusTimer)
          window.removeEventListener('keydown', onKeyDown, true)
        }
      }, [request])

      if (request === null) return null

      const count = request.ids.length
      const many = count > 1
      const close = () => {
        if (busy) return
        setPending(null)
      }

      const confirm = async () => {
        if (busy) return
        setBusy(true)
        setError(null)
        const outcome = await requestPurge(request.ids)
        if (outcome.ok === true) {
          setBusy(false)
          setPending(null)
          bumpVersion()
          return
        }
        setBusy(false)
        bumpVersion()
        const failed = Array.isArray(outcome.results)
          ? outcome.results.filter((result) => result.ok !== true)
          : []
        if (failed.length > 0) {
          const first = describeFailure(failed[0], t)
          setError(
            failed.length > 1 ? translate(t, 'errMore', { detail: first, count: failed.length - 1 }) : first,
          )
        } else if (outcome.code === 'NETWORK') {
          setError(translate(t, 'errNetwork'))
        } else {
          setError(describeFailure(outcome, t))
        }
      }

      const title = many
        ? translate(t, 'titleMany', { count })
        : translate(t, 'title')
      let body
      if (request.dangling === true) {
        body = many
          ? translate(t, 'bodyManyDangling', { count })
          : translate(t, 'bodyDangling', { title: request.title || translate(t, 'untitled') })
      } else {
        body = many
          ? translate(t, 'bodyMany', { count })
          : translate(t, 'body', { title: request.title || translate(t, 'untitled') })
      }

      // Inline styles on the buttons: a host button rule must never be able to
      // paint the destructive action white-on-white.
      const neutralStyle = {
        height: 30,
        padding: '0 14px',
        borderRadius: 8,
        cursor: busy ? 'default' : 'pointer',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        opacity: busy ? 0.55 : 1,
      }
      const dangerStyle = {
        height: 30,
        padding: '0 14px',
        borderRadius: 8,
        cursor: busy ? 'default' : 'pointer',
        border: '1px solid var(--dsw-alias-state-error-primary, #d93a3a)',
        background: 'var(--dsw-alias-state-error-primary, #d93a3a)',
        color: '#ffffff',
        fontWeight: 600,
        opacity: busy ? 0.55 : 1,
      }

      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, CSS),
        h(
          'div',
          {
            key: 'backdrop',
            className: 'dsh-pa-backdrop',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) close()
            },
          },
          h(
            'div',
            {
              className: 'dsh-pa-dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': 'dsh-pa-dialog-title',
            },
            h('h2', { className: 'dsh-pa-title', id: 'dsh-pa-dialog-title' }, title),
            h('p', { className: 'dsh-pa-body' }, body),
            h('p', { className: 'dsh-pa-hint' }, translate(t, 'hint')),
            error === null ? null : h('p', { className: 'dsh-pa-error' }, error),
            h(
              'div',
              { className: 'dsh-pa-actions' },
              h(
                'button',
                {
                  type: 'button',
                  ref: cancelRef,
                  className: 'dsh-pa-btn',
                  style: neutralStyle,
                  disabled: busy,
                  onClick: close,
                },
                translate(t, 'cancel'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-pa-btn',
                  style: dangerStyle,
                  disabled: busy,
                  onClick: confirm,
                },
                busy
                  ? translate(t, 'working')
                  : many
                    ? translate(t, 'confirmMany', { count })
                    : translate(t, 'confirm'),
              ),
            ),
          ),
        ),
      )
    }

    /** Sidebar panel icon; the shell owns the button and its selection state. */
    function PurgePanelIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { opacity: props.active === true ? 1 : 0.9, display: 'block' },
        },
        h('path', { d: 'M4 7.2h16' }),
        h('path', { d: 'M9.8 4.2h4.4' }),
        h('path', { d: 'M6.6 7.2 7.5 19a2.1 2.1 0 0 0 2.1 1.9h4.8a2.1 2.1 0 0 0 2.1-1.9l.9-11.8' }),
        h('path', { d: 'M10.4 11v6.2M13.6 11v6.2' }),
      )
    }

    /** Bulk cleanup page: one row per archived or dangling conversation. */
    function PurgePage() {
      const version = useVersion()
      const [data, setData] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [selected, setSelected] = React.useState(() => new Set())
      const [reloadToken, setReloadToken] = React.useState(0)

      React.useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(null)
        requestScan().then((payload) => {
          if (cancelled) return
          setLoading(false)
          if (payload.ok !== true) {
            setError(translate(undefined, 'errScan', { detail: payload.code ?? 'unknown' }))
            return
          }
          const entries = Array.isArray(payload.entries) ? payload.entries : []
          setData({ ...payload, entries })
          const live = new Set(entries.map((entry) => entry.sessionId))
          setSelected((previous) => new Set([...previous].filter((id) => live.has(id))))
        })
        return () => {
          cancelled = true
        }
      }, [version, reloadToken])

      const entries = data?.entries ?? []
      const dangling = entries.filter((entry) => entry.logFound !== true)
      const allSelected = entries.length > 0 && selected.size === entries.length

      const toggle = (sessionId) => {
        setSelected((previous) => {
          const next = new Set(previous)
          if (next.has(sessionId)) next.delete(sessionId)
          else next.add(sessionId)
          return next
        })
      }

      const openDialog = (ids, extra) => {
        if (ids.length === 0) return
        const allDangling = ids.every((id) => dangling.some((entry) => entry.sessionId === id))
        setPending({
          ids,
          title: extra?.title ?? '',
          dangling: extra?.dangling === true || allDangling,
        })
      }

      const toolbar = h(
        'div',
        { className: 'dsh-pa-toolbar' },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-pa-btn',
            style: {
              height: 28,
              padding: '0 12px',
              borderRadius: 8,
              cursor: 'pointer',
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'transparent',
              color: 'var(--dsw-alias-label-primary)',
            },
            onClick: () => setReloadToken((value) => value + 1),
            disabled: loading,
          },
          copy('refresh'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-pa-btn',
            style: {
              height: 28,
              padding: '0 12px',
              borderRadius: 8,
              cursor: entries.length === 0 ? 'default' : 'pointer',
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'transparent',
              color: 'var(--dsw-alias-label-primary)',
              opacity: entries.length === 0 ? 0.5 : 1,
            },
            disabled: entries.length === 0,
            onClick: () =>
              setSelected(allSelected ? new Set() : new Set(entries.map((entry) => entry.sessionId))),
          },
          copy(allSelected ? 'clearSelection' : 'selectAll'),
        ),
        h('div', { className: 'dsh-pa-toolbar-spacer' }),
        h(
          'span',
          { className: 'dsh-pa-summary' },
          copy('summary', {
            archived: data?.archivedCount ?? 0,
            dangling: data?.danglingCount ?? 0,
            size: formatBytes(data?.totalBytes ?? 0),
          }),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-pa-btn',
            style: {
              height: 28,
              padding: '0 12px',
              borderRadius: 8,
              cursor: selected.size === 0 ? 'default' : 'pointer',
              border: '1px solid var(--dsw-alias-state-error-primary)',
              background: 'transparent',
              color: 'var(--dsw-alias-state-error-primary)',
              opacity: selected.size === 0 ? 0.5 : 1,
            },
            disabled: selected.size === 0,
            onClick: () => openDialog([...selected]),
          },
          copy('deleteSelected', { count: selected.size }),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-pa-btn',
            style: {
              height: 28,
              padding: '0 12px',
              borderRadius: 8,
              cursor: dangling.length === 0 ? 'default' : 'pointer',
              border: '1px solid transparent',
              background: 'var(--dsw-alias-state-warn-primary, #c77b18)',
              color: '#ffffff',
              fontWeight: 600,
              opacity: dangling.length === 0 ? 0.5 : 1,
            },
            disabled: dangling.length === 0,
            onClick: () =>
              openDialog(
                dangling.map((entry) => entry.sessionId),
                { dangling: true },
              ),
          },
          copy('deleteDangling', { count: dangling.length }),
        ),
      )

      let body
      if (loading && data === null) {
        body = h('div', { className: 'dsh-pa-empty' }, copy('loading'))
      } else if (entries.length === 0) {
        body = h('div', { className: 'dsh-pa-empty' }, copy('empty'))
      } else {
        body = h(
          'ul',
          { className: 'dsh-pa-list' },
          entries.map((entry) =>
            h(
              'li',
              { className: 'dsh-pa-row', key: entry.sessionId },
              h('input', {
                type: 'checkbox',
                className: 'dsh-pa-check',
                checked: selected.has(entry.sessionId),
                onChange: () => toggle(entry.sessionId),
                'aria-label': entry.title || entry.sessionId,
              }),
              h(
                'div',
                { className: 'dsh-pa-row-main' },
                h(
                  'span',
                  { className: 'dsh-pa-row-title', title: entry.title || entry.sessionId },
                  entry.title || copy('untitled'),
                ),
                h('span', { className: 'dsh-pa-row-id' }, entry.sessionId),
              ),
              h(
                'span',
                { className: 'dsh-pa-row-meta' },
                entry.logFound === true
                  ? formatBytes(entry.sizeBytes)
                  : h(
                      'span',
                      { className: 'dsh-pa-badge', title: copy('badgeDanglingHint') },
                      copy('badgeDangling'),
                    ),
              ),
              h(
                'span',
                { className: 'dsh-pa-row-meta' },
                entry.logFound === true
                  ? formatTime(entry.updatedAt)
                  : h('span', { className: 'dsh-pa-badge dsh-pa-badge-info' }, copy('badgeUnarchived')),
              ),
            ),
          ),
        )
      }

      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, CSS),
        h(
          'div',
          { className: 'dsh-pa-page', key: 'page' },
          h(
            'div',
            { className: 'dsh-pa-page-inner' },
            h('h1', { className: 'dsh-pa-page-title' }, copy('pageTitle')),
            h('p', { className: 'dsh-pa-page-intro' }, copy('pageIntro')),
            error === null ? null : h('p', { className: 'dsh-pa-error' }, error),
            toolbar,
            body,
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const localeId = () => {
          try {
            const snapshot = ctx.locale.getLocale()
            const id = snapshot?.id ?? snapshot?.locale ?? snapshot?.current
            if (typeof id === 'string' && id.length > 0) return id.toLowerCase()
          } catch {
            // Fall back to the browser's own preference.
          }
          return prefersChinese ? 'zh' : 'en'
        }

        ctx.effect(
          () => ctx.locale.register(NS, { en: DICT.en, zh: DICT.zh }),
          'purge-archived: dictionaries',
        )

        // Order 500 places the row after the shipped Copy Session ID (450).
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'purge-archived.delete',
              order: 500,
              locale: NS,
            },
            PurgeMenuItem,
          ),
        )

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'purge-archived.confirm', order: 1000, locale: NS },
            PurgeDialog,
          ),
        )

        // The sidebar button and the page it opens share one id.
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              label: () => {
                const id = localeId()
                return id.startsWith('zh') ? DICT.zh.panelLabel : DICT.en.panelLabel
              },
            },
            PurgePanelIcon,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, PurgePage),
        )
      },
    }
  },
})
