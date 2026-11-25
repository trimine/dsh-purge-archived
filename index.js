/**
 * Host half of the archived-Session purge bundle.
 *
 * Deletion strategy: the JSONL persistence backend already owns a real
 * cross-process single-writer lock (`open(id, 'write')`). Holding that handle
 * means no Agent, no resume and no other DSH process can write the session.
 * While it is held we remove the stored generation files, then close the
 * handle and remove the now-empty directory. A later resume therefore finds no
 * log and fails with NotFound instead of resurrecting the session.
 *
 * Registry side effects (archive mark, workspace membership, projection-cache
 * checkpoint) are applied only after the log is gone, so an interrupted run
 * degrades into a "dangling" entry that a later run can finish.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { assertPlainPath } from './path-safety.js'

export const inject = [
  'webServer',
  'connection',
  'workspaceRegistry',
  'workspaceController',
  'sessionQuery',
  'sessionPersistence',
  'sessions',
  'agents',
  'storageDomain',
]

const ROUTE_DELETE = '/dsh-purge-archived/delete'
const ROUTE_SCAN = '/dsh-purge-archived/scan'
const SAFE_SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_BODY_BYTES = 64 * 1024
const MAX_BATCH = 500
const ARCHIVE_SET_TIMEOUT_MS = 4000
const LOG_FILE = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/
const LOCK_FILES = new Set(['session.lock'])
const CACHE_DOMAIN = 'session_projcache'
const CACHE_TABLE = 'sessions'

function ownedDirectory(id, snapshot) {
  const file = snapshot?.location?.path
  if (snapshot?.header?.id !== id || snapshot?.location?.kind !== 'jsonl' ||
      typeof file !== 'string' || !path.isAbsolute(file) || path.resolve(file) !== file ||
      !LOG_FILE.test(path.basename(file)) || path.basename(path.dirname(file)) !== id) {
    throw new Error('Storage location is not a dedicated JSONL directory for this session')
  }
  return path.dirname(file)
}

async function generationPlan(directory, current) {
  await assertPlainPath(directory)
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || (!LOCK_FILES.has(entry.name) && !LOG_FILE.test(entry.name))) {
      throw new Error(`Unrecognized session directory entry: ${entry.name}`)
    }
    if (!LOCK_FILES.has(entry.name)) files.push(path.join(directory, entry.name))
  }
  if (!files.includes(current)) throw new Error('The selected log is missing')
  // Keep the backend's selected generation until last so an interrupted purge remains discoverable.
  return [...files.filter(file => file !== current), current]
}

export function apply(ctx) {
  function isLive(sessionId) {
    return ctx.agents?.get(sessionId) !== undefined || ctx.sessions.get(sessionId) !== undefined
  }

  function cacheTable() {
    try {
      return ctx.storageDomain?.get(CACHE_DOMAIN)?.table(CACHE_TABLE)
    } catch {
      return undefined
    }
  }

  /**
   * Read the registry's durable archive set from the controller's own baseline
   * frame; the registry exposes no direct getter.
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
      throw new Error('ARCHIVE_STATE_UNAVAILABLE')
    } catch (error) {
      throw new Error('ARCHIVE_STATE_UNAVAILABLE', { cause: error })
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }

  /** On-disk facts for one Session, taken from the backend's own location. */
  async function inspect(sessionId) {
    let snapshot
    try {
      snapshot = await ctx.sessionPersistence.stat(sessionId)
    } catch (error) {
      throw new Error(`STAT_INSPECTION_FAILED: ${error.message}`, { cause: error })
    }
    if (snapshot === undefined) {
      return { logFound: false, sizeBytes: 0, updatedAt: 0, directory: undefined, files: [] }
    }
    const location = snapshot.location
    if (location === undefined || typeof location.path !== 'string') {
      throw new Error('SESSION_LOCATION_UNAVAILABLE')
    }
    const directory = ownedDirectory(sessionId, snapshot)
    await assertPlainPath(directory)
    const files = []
    let sizeBytes = 0
    let updatedAt = 0
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const filePath = path.join(directory, entry.name)
      const info = await fs.stat(filePath)
      files.push({ path: filePath, bytes: info.size, lock: LOCK_FILES.has(entry.name) })
      if (LOCK_FILES.has(entry.name)) continue
      sizeBytes += info.size
      updatedAt = Math.max(updatedAt, info.mtimeMs)
    }
    return { logFound: true, sizeBytes, updatedAt, directory, files, current: location.path, formatStatus: snapshot.formatStatus }
  }

  async function readTitle(sessionId) {
    try {
      const results = await ctx.sessionQuery.readTitleSnapshots([sessionId])
      const result = results[0]
      if (result?.status !== 'fulfilled') return undefined
      const title = result.value.title?.title
      return typeof title === 'string' && title.length > 0 ? title : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Every archived id, plus any Workspace membership whose stored log is
   * already gone (a dangling registry entry). An ordinary, still-stored,
   * unarchived conversation is excluded.
   */
  async function scanEntries() {
    const archiveSet = await readArchiveSet()
    const workspaces = ctx.workspaceRegistry.list()
    const candidates = new Map()
    for (const sessionId of archiveSet) candidates.set(sessionId, true)
    for (const workspace of workspaces) {
      for (const sessionId of workspace.sessionIds) {
        if (!candidates.has(sessionId)) candidates.set(sessionId, false)
      }
    }

    const table = cacheTable()
    const entries = []
    for (const [sessionId, archived] of candidates) {
      if (typeof sessionId !== 'string' || !SAFE_SESSION_ID.test(sessionId)) continue
      const facts = await inspect(sessionId)
      const live = isLive(sessionId)
      if (!archived && (facts.logFound || live)) continue
      const workspaceTitles = workspaces
        .filter((workspace) => workspace.sessionIds.includes(sessionId))
        .map((workspace) => workspace.title)
      const entry = {
        sessionId,
        archived,
        logFound: facts.logFound,
        live,
        cacheFound: table?.get(sessionId) !== undefined,
        inWorkspaces: workspaceTitles.length,
        workspaceTitles,
        sizeBytes: facts.sizeBytes,
        updatedAt: facts.updatedAt,
        directories: facts.directory === undefined ? [] : [facts.directory],
        files: facts.files,
        ...(facts.formatStatus === undefined ? {} : { formatStatus: facts.formatStatus }),
      }
      const title = facts.logFound ? await readTitle(sessionId) : undefined
      if (title !== undefined) entry.title = title
      entries.push(entry)
    }

    entries.sort((left, right) => right.updatedAt - left.updatedAt)
    return {
      deletionAvailable: true,
      archiveVerified: true,
      archivedCount: archiveSet.size,
      entries,
      danglingCount: entries.filter((entry) => !entry.logFound && !entry.live).length,
      totalBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    }
  }

  /**
   * Delete one archived Session. The stored log is removed while the backend's
   * exclusive write lock is held; registry state follows, then everything is
   * re-verified.
   */
  async function purgeOne(sessionId, archiveSet) {
    if (typeof sessionId !== 'string' || !SAFE_SESSION_ID.test(sessionId)) {
      return { ok: false, sessionId, code: 'INVALID_SESSION_ID' }
    }
    if (!archiveSet.has(sessionId)) {
      return { ok: false, sessionId, code: 'NOT_ARCHIVED' }
    }
    if (isLive(sessionId)) {
      return { ok: false, sessionId, code: 'SESSION_IN_USE' }
    }

    const facts = await inspect(sessionId)
    const warnings = []
    let handle
    let removed = []

    if (facts.logFound) {
      try {
        await generationPlan(facts.directory, facts.current)
        handle = await ctx.sessionPersistence.open(sessionId, 'write')
      } catch (error) {
        const name = String(error?.name ?? '')
        if (name === 'SessionAlreadyOwnedError') {
          return { ok: false, sessionId, code: 'SESSION_IN_USE' }
        }
        if (name === 'SessionPersistenceNotFoundError') {
          return { ok: false, sessionId, code: 'SESSION_CHANGED', message: 'Refresh before retrying.' }
        } else {
          return {
            ok: false,
            sessionId,
            code: 'LOCK_UNAVAILABLE',
            message: error instanceof Error ? error.message : String(error),
          }
        }
      }
    }

    try {
      if (facts.logFound && handle !== undefined) {
        const locked = await ctx.sessionPersistence.stat(sessionId)
        if (handle.id !== sessionId || ownedDirectory(sessionId, locked) !== facts.directory) {
          throw new Error('Session location changed before acquiring the writer lock')
        }
        const files = await generationPlan(facts.directory, locked.location.path)
        if (isLive(sessionId) || !(await readArchiveSet()).has(sessionId)) {
          throw new Error('Session is no longer eligible for deletion')
        }
        for (const file of files) {
          await assertPlainPath(file)
          await fs.unlink(file)
          removed.push(file)
        }
      }
    } catch (error) {
      warnings.push(`log deletion: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (handle !== undefined) {
        try {
          await handle.close()
        } catch (error) {
          // A close failure after the files are gone is not a data-loss risk.
          warnings.push(`lock release: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    // Re-verify: the log must really be gone before registry state is touched.
    let after
    try {
      after = await ctx.sessionPersistence.stat(sessionId)
    } catch (error) {
      return {
        ok: false,
        sessionId,
        code: 'VERIFY_FAILED',
        message: error instanceof Error ? error.message : String(error),
        removed,
      }
    }
    if (after !== undefined) {
      return {
        ok: false,
        sessionId,
        code: 'LOG_STILL_PRESENT',
        message: 'The stored log survived deletion; nothing was changed in the registry.',
        removed,
      }
    }

    if (warnings.length) return { ok: false, sessionId, code: 'CLEANUP_INCOMPLETE', warnings, removed }
    if (facts.directory !== undefined) {
      try {
        await assertPlainPath(facts.directory)
        await fs.rmdir(facts.directory) // Empty only. Never unlink a backend lock file.
        removed.push(facts.directory)
      } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) {
          return { ok: false, sessionId, code: 'CLEANUP_INCOMPLETE', warnings: [error.message], removed }
        }
      }
    }

    const table = cacheTable()
    if (table !== undefined) {
      try {
        await table.delete(sessionId)
      } catch (error) {
        warnings.push(`projection cache: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      warnings.push('projection cache: storage domain is not open')
    }

    for (const workspace of ctx.workspaceRegistry.list()) {
      try {
        await workspace.detachSession(sessionId)
      } catch (error) {
        warnings.push(`workspace ${workspace.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (warnings.length) return { ok: false, sessionId, code: 'CLEANUP_INCOMPLETE', warnings, removed }
    try {
      await ctx.workspaceRegistry.unarchiveSession(sessionId)
    } catch (error) {
      return { ok: false, sessionId, code: 'CLEANUP_INCOMPLETE', warnings: [`archive set: ${error.message}`], removed }
    }

    try {
      ctx.emit('api-session/removed', sessionId)
    } catch (error) {
      warnings.push(`removal notice: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (warnings.length > 0) {
      return { ok: false, sessionId, code: 'CLEANUP_INCOMPLETE', warnings, removed }
    }
    return {
      ok: true,
      sessionId,
      reason: facts.logFound ? 'archived' : 'dangling',
      removed,
      warnings,
    }
  }

  function isSameOrigin(request) {
    const origin = request.headers.origin
    if (origin === undefined) return true
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
    const admission = ctx.connection.admit(request)
    if ('rejection' in admission || admission.peer.principal.kind !== 'owner') {
      send('rejection' in admission ? admission.rejection : 403, { ok: false, code: 'AUTH_REQUIRED' })
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

  let queue = Promise.resolve()

  const scanHandler = async (request, response) => {
    const send = admit(request, response)
    if (send === undefined) return
    try {
      await readJsonBody(request)
    } catch (error) {
      send(400, { ok: false, code: 'INVALID_BODY', message: error instanceof Error ? error.message : String(error) })
      return
    }
    try {
      send(200, { ok: true, ...(await scanEntries()) })
    } catch (error) {
      send(500, { ok: false, code: 'SCAN_FAILED', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const deleteHandler = async (request, response) => {
    const send = admit(request, response)
    if (send === undefined) return

    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      send(400, { ok: false, code: 'INVALID_BODY', message: error instanceof Error ? error.message : String(error) })
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
    if (requested.length > MAX_BATCH) {
      send(400, { ok: false, code: 'TOO_MANY_SESSION_IDS' })
      return
    }
    if (requested.some((id) => typeof id !== 'string' || !SAFE_SESSION_ID.test(id))) {
      send(400, { ok: false, code: 'INVALID_SESSION_ID' })
      return
    }

    const run = async () => {
      const results = []
      for (const sessionId of new Set(requested)) {
        try {
          const archiveSet = await readArchiveSet()
          results.push(await purgeOne(sessionId, archiveSet))
        } catch (error) {
          results.push({
            ok: false,
            sessionId,
            code: 'CLEANUP_FAILED',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      send(200, { ok: results.every((result) => result.ok), results })
    }
    const operation = queue.then(run)
    queue = operation.catch(() => {})
    await operation
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
