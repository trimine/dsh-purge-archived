import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { apply } from '../index.js'

const ID = 'session-aaaaaaaa-1111-2222-3333-444444444444'
const OTHER = 'session-bbbbbbbb-1111-2222-3333-444444444444'

/**
 * Isolated fixture: a temporary session directory that mimics the JSONL
 * backend's on-disk shape (one log generation plus a lock file). No real DSH
 * home or user conversation is touched.
 */
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-regress-'))
  t.after(async () => {
    assert.ok(path.basename(root).startsWith('purge-regress-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  const directory = path.join(root, 'project', ID)
  await fs.mkdir(directory, { recursive: true })
  const log = path.join(directory, 'session.v4.jsonl.zstd')
  const lock = path.join(directory, 'session.lock')
  if (!options.missingLog) {
    await fs.writeFile(log, 'fixture-log')
    await fs.writeFile(lock, '')
  }

  const archived = new Set(options.unarchived ? [] : [ID])
  const cache = new Map(options.cached === false ? [] : [[ID, { rows: {} }]])
  const calls = { open: 0, close: 0, detach: [], emit: [], unarchive: 0 }
  const routes = new Map()
  let logExistsAtClose = null
  let closeCount = 0

  const stat = async (id) => {
    if (id !== ID) return undefined
    try {
      await fs.stat(log)
    } catch {
      return undefined
    }
    return {
      header: { id, version: 4, createdAt: 1, isSeeded: false },
      revision: 'r1',
      sizeBytes: 11,
      location: { kind: options.kind ?? 'jsonl', path: options.location?.(log) ?? log },
    }
  }

  const ctx = {
    connection: {
      admit: () =>
        options.auth === false
          ? { rejection: 401 }
          : { peer: { principal: { kind: 'owner' } } },
    },
    effect: (fn) => fn(),
    emit: (name, id) => calls.emit.push([name, id]),
    webServer: {
      register: (route) => {
        routes.set(route.path, route.handler)
        return () => {}
      },
    },
    workspaceController: {
      async *follow() {
        if (options.archiveFailure) throw new Error('offline')
        yield { type: 'baseline', value: { archivedSessionIds: [...archived] } }
      },
    },
    workspaceRegistry: {
      list: () => [
        {
          id: 'ws-1',
          title: 'workspace',
          sessionIds: [],
          detachSession: async (id) => {
            if (options.fail === 'workspace') throw new Error('workspace unavailable')
            calls.detach.push(id)
          },
        },
      ],
      unarchiveSession: async (id) => {
        calls.unarchive += 1
        archived.delete(id)
      },
    },
    agents: { get: () => (options.live ? { id: ID } : undefined) },
    sessions: { get: () => undefined },
    sessionPersistence: {
      stat,
      open: async (id, access) => {
        calls.open += 1
        if (options.owned) {
          const error = new Error('already owned')
          error.name = 'SessionAlreadyOwnedError'
          throw error
        }
        assert.equal(access, 'write')
        return {
          id,
          close: async () => {
            calls.close += 1
            closeCount += 1
            logExistsAtClose = await fs
              .stat(log)
              .then(() => true)
              .catch(() => false)
            if (options.resurrectOnClose) await fs.writeFile(log, 'resurrected')
          },
        }
      },
    },
    storageDomain: {
      get: (name) =>
        name === 'session_projcache'
          ? {
              table: (table) => ({
                get: (id) => cache.get(id),
                delete: async (id) => {
                  if (options.fail === 'cache') throw new Error('cache unavailable')
                  return cache.delete(id)
                },
              }),
            }
          : undefined,
    },
    sessionQuery: { readTitleSnapshots: async () => [] },
  }

  apply(ctx)

  async function request(route = 'delete', body = { sessionIds: [ID] }) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))])
    req.method = 'POST'
    req.headers = { host: 'localhost', 'content-type': 'application/json' }
    let status
    let payload
    await routes.get('/dsh-purge-archived/' + route)(req, {
      writeHead: (value) => {
        status = value
      },
      end: (text) => {
        payload = JSON.parse(text)
      },
    })
    return { status, ...payload }
  }

  return {
    request,
    directory,
    log,
    lock,
    archived,
    cache,
    calls,
    get closeCount() {
      return closeCount
    },
    get logExistsAtClose() {
      return logExistsAtClose
    },
    stat,
  }
}

const exists = (target) =>
  fs
    .stat(target)
    .then(() => true)
    .catch(() => false)

test('cold archived session is deleted while holding the writer lock', async (t) => {
  const f = await fixture(t)
  const result = await f.request()
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.results[0].reason, 'archived')
  assert.equal(f.calls.open, 1, 'the backend write lock is taken')
  assert.equal(f.calls.close, 1, 'the lock is released')
  assert.equal(f.logExistsAtClose, false, 'log files are gone before the lock is released')
  assert.equal(await exists(f.log), false)
  assert.equal(await exists(f.lock), true, 'do not unlink a persistent backend lock')
  assert.deepEqual(await fs.readdir(f.directory), ['session.lock'])
  assert.equal(f.cache.has(ID), false, 'projection cache is cleared')
  assert.deepEqual(f.calls.detach, [ID], 'workspace membership is detached')
  assert.equal(f.archived.has(ID), false, 'archive mark is cleared')
  assert.deepEqual(f.calls.emit, [['api-session/removed', ID]])
})

for (const [name, options] of Object.entries({
  'wrong backend': { kind: 'other' },
  'wrong parent': { location: log => path.join(path.dirname(path.dirname(log)), path.basename(log)) },
  'wrong filename': { location: log => path.join(path.dirname(log), 'notes.txt') },
})) {
  test(`reject ${name} without deleting files or metadata`, async t => {
    const f = await fixture(t, options)
    assert.equal((await f.request()).ok, false)
    assert.equal(f.calls.open, 0)
    assert.equal(await fs.readFile(f.log, 'utf8'), 'fixture-log')
    assert.ok(f.archived.has(ID) && f.cache.has(ID))
    assert.deepEqual(f.calls.emit, [])
  })
}
for (const type of ['file', 'directory']) {
  test(`unknown ${type} aborts before the first unlink`, async t => {
    const f = await fixture(t)
    const extra = path.join(f.directory, 'zzz-personal')
    if (type === 'file') await fs.writeFile(extra, 'keep'); else await fs.mkdir(extra)
    const old = path.join(f.directory, 'session.jsonl.zstd')
    await fs.writeFile(old, 'old')
    assert.equal((await f.request()).ok, false)
    assert.equal(f.calls.open, 0)
    assert.ok(await exists(extra) && await exists(f.log) && await exists(old))
    assert.ok(f.cache.has(ID) && f.archived.has(ID))
    assert.deepEqual(f.calls.emit, [])
  })
}
for (const fail of ['cache', 'workspace']) {
  test(`${fail} failure keeps the entry visible and retry finishes cleanup`, async t => {
    const options = { fail }
    const f = await fixture(t, options)
    const first = await f.request()
    assert.equal(first.results[0].code, 'CLEANUP_INCOMPLETE')
    assert.equal(await exists(f.log), false)
    assert.ok(f.archived.has(ID))
    assert.equal(f.calls.unarchive, 0)
    assert.deepEqual(f.calls.emit, [])
    options.fail = null
    assert.equal((await f.request()).ok, true)
    assert.equal(f.calls.open, 1)
    assert.equal(f.cache.has(ID) || f.archived.has(ID), false)
    assert.deepEqual(f.calls.emit, [['api-session/removed', ID]])
  })
}

test('a live session is refused before any lock or deletion', async (t) => {
  const f = await fixture(t, { live: true })
  const result = await f.request()
  assert.equal(result.ok, false)
  assert.equal(result.results[0].code, 'SESSION_IN_USE')
  assert.equal(f.calls.open, 0)
  assert.equal(await exists(f.log), true)
})

test('a writer owned by someone else is reported as in use', async (t) => {
  const f = await fixture(t, { owned: true })
  const result = await f.request()
  assert.equal(result.results[0].code, 'SESSION_IN_USE')
  assert.equal(await exists(f.log), true)
})

test('an unarchived conversation is never deleted', async (t) => {
  const f = await fixture(t, { unarchived: true })
  const result = await f.request()
  assert.equal(result.ok, false)
  assert.equal(result.results[0].code, 'NOT_ARCHIVED')
  assert.equal(f.calls.open, 0)
  assert.equal(await exists(f.log), true)
})

test('a resurrected log is detected and registry state is left untouched', async (t) => {
  const f = await fixture(t, { resurrectOnClose: true })
  const result = await f.request()
  assert.equal(result.ok, false)
  assert.equal(result.results[0].code, 'LOG_STILL_PRESENT')
  assert.equal(f.archived.has(ID), true, 'archive mark survives for a retry')
  assert.equal(f.calls.detach.length, 0)
})

test('a dangling entry only clears registry and cache', async (t) => {
  const f = await fixture(t, { missingLog: true })
  const result = await f.request()
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.results[0].reason, 'dangling')
  assert.equal(f.calls.open, 0, 'no lock is needed without a stored log')
  assert.equal(f.cache.has(ID), false)
  assert.equal(f.archived.has(ID), false)
})

test('scan reports real locations, cache state and deletion availability', async (t) => {
  const f = await fixture(t)
  const result = await f.request('scan', {})
  assert.equal(result.ok, true)
  assert.equal(result.deletionAvailable, true)
  const entry = result.entries.find((item) => item.sessionId === ID)
  assert.equal(entry.logFound, true)
  assert.equal(entry.cacheFound, true)
  assert.deepEqual(entry.directories, [f.directory])
  assert.equal(entry.sizeBytes, 11, 'the lock file does not count toward size')
  assert.equal(entry.files.some((file) => file.path.endsWith('session.lock')), true)
})

test('unauthenticated requests are rejected', async (t) => {
  const f = await fixture(t, { auth: false })
  assert.equal((await f.request()).status, 401)
  assert.equal((await f.request('scan', {})).status, 401)
  assert.equal(await exists(f.log), true)
})

test('an unreadable archive state blocks scan and deletion', async (t) => {
  const f = await fixture(t, { archiveFailure: true })
  assert.equal((await f.request('scan', {})).ok, false)
  const result = await f.request()
  assert.equal(result.ok, false)
  assert.equal(f.calls.open, 0)
  assert.equal(await exists(f.log), true)
})

test('duplicate ids run once and malformed ids reject the batch', async (t) => {
  const f = await fixture(t)
  const dup = await f.request('delete', { sessionIds: [ID, ID] })
  assert.equal(dup.results.length, 1)
  const g = await fixture(t)
  const bad = await g.request('delete', { sessionIds: [ID, '../escape'] })
  assert.equal(bad.status, 400)
  assert.equal(await exists(g.log), true)
})

test('an unrelated id is not deleted by another id', async (t) => {
  const f = await fixture(t)
  const result = await f.request('delete', { sessionIds: [OTHER] })
  assert.equal(result.results[0].code, 'NOT_ARCHIVED')
  assert.equal(await exists(f.log), true)
})
