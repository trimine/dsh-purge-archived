/**
 * Host half of the archived-Session purge bundle.
 *
 * DSH ships no Session deletion on purpose: `dsh-session-persistence-jsonl`
 * documents that nothing removes session logs ("logs accumulate under `root`
 * until removed externally; the seam has no deletion API"), and
 * `dsh-client-ui-workspace` lists "No Session deletion" as a known
 * limitation. This plugin adds exactly that one operation, plus the read-only
 * scan the cleanup page lists its rows from.
 *
 * One purge removes every artifact a Session leaves behind:
 *   - `<DSH_HOME>/sessions/<project>/<sessionId>/`  the stored log generation(s)
 *   - `<DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json`
 *   - the id in the registry's durable archive set
 *   - the id in any Workspace membership list
 * Connected Clients drop the row through the ordinary `api-session/removed`
 * notification, the same one a disposed Agent produces.
 *
 * Two entry kinds are accepted, and nothing else:
 *   - `archived`  the registry's durable archive set contains the id;
 *   - `dangling`  no stored log and no live Session remain, so only registry
 *                 residue is left (a conversation whose files were deleted by
 *                 hand, outside this plugin).
 * An ordinary, unarchived, still-stored conversation is always refused.
 *
 * The browser reaches this through named HTTP routes on `ctx.webServer` (a
 * plain-JS plugin cannot add a generated Remote namespace: the Client's
 * capability set is fixed at build time). Both routes accept only a
 * same-origin, JSON-bodied POST, so a cross-origin page cannot drive them.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const inject = [
  'webServer',
  'workspaceRegistry',
  'workspaceController',
  'sessionQuery',
  'sessionPersistence',
  'sessions',
]

/** Routes the Client half posts to; keep in sync with `client.js`. */
const ROUTE_DELETE = '/dsh-purge-archived/delete'
const ROUTE_SCAN = '/dsh-purge-archived/scan'
/** Session ids are `session-<uuid>`; anything else is refused before touching a path. */
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const MAX_BODY_BYTES = 64 * 1024
const ARCHIVE_SET_TIMEOUT_MS = 4000

/** The Host home whose `sessions`/`storages` trees the persistence and storage rows use. */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.length > 0) return configured
  return path.join(os.homedir(), '.dsh')
}

/**
 * Every project directory holding a log directory for this Session id.
 * The backend escapes ids into one path segment; a Session id that this build
 * mints (`session-<uuid>`) needs no escaping, so the id is the directory name.
 */
async function findSessionDirectories(sessionsRoot, sessionId) {
  const found = []
  let projects
  try {
    projects = await fs.readdir(sessionsRoot, { withFileTypes: true })
  } catch {
    return found
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const candidate = path.join(sessionsRoot, project.name, sessionId)
    // `sessionId` already passed SAFE_SESSION_ID, so the join cannot escape.
    if (!candidate.startsWith(sessionsRoot + path.sep)) continue
    try {
      const info = await fs.stat(candidate)
      if (info.isDirectory()) found.push(candidate)
    } catch {
      // No log directory for this id under that project.
    }
  }
  return found
}

/**
 * Remove the on-disk artifacts of one Session: its stored log directory in
 * every project directory, and its projection-cache checkpoint. Registry state
 * is the caller's job. Throws when a log directory cannot be removed, so the
 * caller can report the untouched remainder instead of claiming success.
 */
export async function removeSessionArtifacts({ sessionId, sessionsRoot, projectionCacheRoot }) {
  if (typeof sessionId !== 'string' || !SAFE_SESSION_ID.test(sessionId)) {
    throw new Error(`refusing to delete an unsafe Session id: ${String(sessionId)}`)
  }
  const removed = []
  const directories = await findSessionDirectories(sessionsRoot, sessionId)
  for (const directory of directories) {
    await fs.rm(directory, { recursive: true, force: true })
    removed.push(directory)
  }
  const cacheFile = path.join(projectionCacheRoot, `${sessionId}.json`)
  try {
    await fs.rm(cacheFile, { force: true })
    removed.push(cacheFile)
  } catch {
    // A missing or unremovable checkpoint is not a deletion failure: the log is gone.
  }
  return { directories, removed }
}

export function apply(ctx) {
  const home = dshHome()
  const sessionsRoot = path.join(home, 'sessions')
  const projectionCacheRoot = path.join(home, 'storages', 'session_projcache', 'sessions')

  /**
   * Read the registry's durable archive set from the controller's own baseline
   * frame. The registry has no getter, and the controller stream is the public
   * projection of that set; the first frame is the complete baseline.
   */
  async function readArchiveSet() {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ARCHIVE_SET_TIMEOUT_MS)
    try {
      for await (const frame of ctx.workspaceController.follow(controller.signal)) {
        if (frame.type === 'baseline' || frame.type === 'replace') {
          return new Set(frame.value.archivedSessionIds)
        }
      }
      return undefined
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }

  /** On-disk footprint of one Session: log directories, their files, and its cache checkpoint. */
  async function measureArtifacts(sessionId) {
    const directories = await findSessionDirectories(sessionsRoot, sessionId)
    const files = []
    let sizeBytes = 0
    let updatedAt = 0
    for (const directory of directories) {
      let entries
      try {
        entries = await fs.readdir(directory, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const filePath = path.join(directory, entry.name)
        try {
          const info = await fs.stat(filePath)
          files.push({ path: filePath, bytes: info.size })
          sizeBytes += info.size
          updatedAt = Math.max(updatedAt, info.mtimeMs)
        } catch {
          // A file that vanished mid-scan contributes nothing.
        }
      }
    }
    const cachePath = path.join(projectionCacheRoot, `${sessionId}.json`)
    let cacheFound = false
    try {
      const info = await fs.stat(cachePath)
      cacheFound = true
      sizeBytes += info.size
      updatedAt = Math.max(updatedAt, info.mtimeMs)
    } catch {
      // No checkpoint for this Session.
    }
    return { directories, files, cachePath, sizeBytes, updatedAt, cacheFound }
  }

  /** Best-effort titles from the log-backed title fold; never fatal. */
  async function readTitles(sessionIds) {
    const titles = new Map()
    if (sessionIds.length === 0) return titles
    try {
      const results = await ctx.sessionQuery.readTitleSnapshots(sessionIds)
      for (const result of results) {
        if (result.status !== 'fulfilled') continue
        const title = result.value.title?.title
        if (typeof title === 'string' && title.length > 0) titles.set(result.sessionId, title)
      }
    } catch {
      // Titles are display sugar: a corpus read failure leaves ids only.
    }
    return titles
  }

  /** Header facts for one stored Session; undefined when its log is unreadable. */
  async function readHeader(sessionId) {
    try {
      const snapshot = await ctx.sessionPersistence.stat(sessionId)
      if (snapshot === undefined) return undefined
      return {
        ...(snapshot.header.cwd === undefined ? {} : { cwd: snapshot.header.cwd }),
        createdAt: snapshot.header.createdAt,
        formatVersion: snapshot.header.version,
        ...(snapshot.formatStatus === undefined ? {} : { formatStatus: snapshot.formatStatus }),
      }
    } catch {
      return undefined
    }
  }

  /**
   * Every id worth showing on the cleanup page: the archive set, plus any
   * Workspace membership whose stored log is already gone. An ordinary,
   * still-stored, unarchived conversation is excluded.
   */
  async function scanEntries() {
    const archiveSet = await readArchiveSet()
    const archived = archiveSet ?? new Set()
    const registryWorkspaces = ctx.workspaceRegistry.list()
    const candidates = new Map()
    for (const sessionId of archived) {
      candidates.set(sessionId, { archived: true, workspaceIds: [] })
    }
    for (const workspace of registryWorkspaces) {
      for (const sessionId of workspace.sessionIds) {
        const record = candidates.get(sessionId) ?? { archived: false, workspaceIds: [] }
        record.workspaceIds.push(workspace.id)
        candidates.set(sessionId, record)
      }
    }

    const entries = []
    for (const [sessionId, record] of candidates) {
      if (typeof sessionId !== 'string' || !SAFE_SESSION_ID.test(sessionId)) continue
      const measured = await measureArtifacts(sessionId)
      const logFound = measured.directories.length > 0
      if (!record.archived && logFound) continue // an ordinary conversation
      const workspaceTitles = registryWorkspaces
        .filter((workspace) => workspace.sessionIds.includes(sessionId))
        .map((workspace) => workspace.title)
      entries.push({
        sessionId,
        archived: record.archived,
        logFound,
        cacheFound: measured.cacheFound,
        live: ctx.sessions.get(sessionId) !== undefined,
        inWorkspaces: record.workspaceIds.length,
        workspaceTitles,
        sizeBytes: measured.sizeBytes,
        updatedAt: measured.updatedAt,
        directories: measured.directories,
        files: measured.files,
        ...(measured.cacheFound ? { cachePath: measured.cachePath } : {}),
        ...(logFound ? { header: await readHeader(sessionId) } : {}),
      })
    }

    const titles = await readTitles(entries.filter((entry) => entry.logFound).map((entry) => entry.sessionId))
    for (const entry of entries) {
      const title = titles.get(entry.sessionId)
      if (title !== undefined) entry.title = title
    }

    entries.sort((left, right) => right.updatedAt - left.updatedAt)
    return {
      archiveVerified: archiveSet !== undefined,
      archivedCount: archived.size,
      entries,
      danglingCount: entries.filter((entry) => entry.logFound !== true).length,
      totalBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    }
  }

  /**
   * Delete one Session. Every step is independent and reported, so a partial
   * failure names what remains instead of claiming success.
   */
  async function purgeSession(sessionId, archiveSet) {
    if (typeof sessionId !== 'string' || !SAFE_SESSION_ID.test(sessionId)) {
      return { ok: false, sessionId, code: 'INVALID_SESSION_ID' }
    }

    const measured = await measureArtifacts(sessionId)
    const logFound = measured.directories.length > 0
    const live = ctx.sessions.get(sessionId) !== undefined
    if (logFound) {
      if (archiveSet !== undefined && !archiveSet.has(sessionId)) {
        return { ok: false, sessionId, code: 'NOT_ARCHIVED' }
      }
    } else if (live) {
      // A blank, not-yet-materialized Session: live state, no log to delete.
      return { ok: false, sessionId, code: 'SESSION_LIVE' }
    }

    const warnings = []
    let removed = []
    let directories = []

    try {
      const outcome = await removeSessionArtifacts({ sessionId, sessionsRoot, projectionCacheRoot })
      directories = outcome.directories
      removed = outcome.removed
    } catch (error) {
      return {
        ok: false,
        sessionId,
        code: 'LOG_DELETE_FAILED',
        message: error instanceof Error ? error.message : String(error),
        removed,
      }
    }

    try {
      await ctx.workspaceRegistry.unarchiveSession(sessionId)
    } catch (error) {
      warnings.push(`archive set: ${error instanceof Error ? error.message : String(error)}`)
    }

    for (const workspace of ctx.workspaceRegistry.list()) {
      if (!workspace.sessionIds.includes(sessionId)) continue
      try {
        await workspace.detachSession(sessionId)
      } catch (error) {
        warnings.push(`workspace ${workspace.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Same notification a disposed Agent produces: connected Clients drop the row.
    try {
      ctx.emit('api-session/removed', sessionId)
    } catch (error) {
      warnings.push(`removal notice: ${error instanceof Error ? error.message : String(error)}`)
    }

    return {
      ok: true,
      sessionId,
      reason: logFound ? 'archived' : 'dangling',
      archiveVerified: archiveSet !== undefined,
      logDirectories: directories.length,
      removed,
      ...(warnings.length === 0 ? {} : { warnings }),
    }
  }

  function isSameOrigin(request) {
    const origin = request.headers.origin
    if (origin === undefined) return true // non-browser caller (local tooling)
    try {
      return new URL(origin).host === request.headers.host
    } catch {
      return false
    }
  }

  async function readJsonBody(request) {
    const chunks = []
    let bytes = 0
    for await (const chunk of request) {
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) throw new Error('request body too large')
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    return text.length === 0 ? {} : JSON.parse(text)
  }

  /** Shared admission for both routes: POST, same origin, JSON body. */
  function admit(request, response) {
    const send = (status, body) => {
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(JSON.stringify(body))
    }
    if (request.method !== 'POST') {
      send(405, { ok: false, code: 'METHOD_NOT_ALLOWED' })
      return undefined
    }
    if (!isSameOrigin(request)) {
      send(403, { ok: false, code: 'CROSS_ORIGIN_REFUSED' })
      return undefined
    }
    const contentType = String(request.headers['content-type'] ?? '')
    if (!contentType.toLowerCase().startsWith('application/json')) {
      send(415, { ok: false, code: 'JSON_BODY_REQUIRED' })
      return undefined
    }
    return send
  }

  const scanHandler = async (request, response) => {
    const send = admit(request, response)
    if (send === undefined) return
    try {
      await readJsonBody(request)
    } catch (error) {
      send(400, {
        ok: false,
        code: 'INVALID_BODY',
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }
    try {
      send(200, { ok: true, ...(await scanEntries()) })
    } catch (error) {
      send(500, {
        ok: false,
        code: 'SCAN_FAILED',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const deleteHandler = async (request, response) => {
    const send = admit(request, response)
    if (send === undefined) return

    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      send(400, {
        ok: false,
        code: 'INVALID_BODY',
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const requested = Array.isArray(body?.sessionIds)
      ? body.sessionIds
      : typeof body?.sessionId === 'string'
        ? [body.sessionId]
        : []
    if (requested.length === 0) {
      send(400, { ok: false, code: 'NO_SESSION_IDS' })
      return
    }
    if (requested.length > 500) {
      send(400, { ok: false, code: 'TOO_MANY_SESSION_IDS' })
      return
    }

    const archiveSet = await readArchiveSet()
    const results = []
    for (const sessionId of requested) results.push(await purgeSession(sessionId, archiveSet))
    send(200, { ok: results.every((result) => result.ok === true), results })
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ROUTE_SCAN, handler: scanHandler }),
    'purge-archived: scan route',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ROUTE_DELETE, handler: deleteHandler }),
    'purge-archived: deletion route',
  )
}
