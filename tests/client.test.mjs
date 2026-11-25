import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
function harness(fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, entries: [] }) })) {
  let api, plugin, cursor = 0
  const state = [], effects = [], handlers = new Map(), timers = new Map()
  let timerId = 0
  const document = { activeElement: null }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment',
    useState(initial) {
      const i = cursor++
      if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }]
    },
    useRef(initial) { const i = cursor++; return state[i] ??= { current: initial } },
    useEffect(fn) { effects.push(fn) },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  }
  const locale = { getLocale: () => ({ active: 'zh' }), subscribe: () => () => {}, bind: () => key => key, register: () => () => {} }
  const sandbox = {
    AbortController, document, console,
    navigator: { language: 'en', clipboard: { writeText: async () => {} } },
    fetch: fetchImpl,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId },
    clearTimeout: id => timers.delete(id),
    window: {
      addEventListener: (key, fn) => handlers.set(key, fn),
      removeEventListener: key => handlers.delete(key),
      __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => React) } },
    },
    expose: value => { api = value },
  }
  vm.runInNewContext(source.replace('    return {\n      inject:', '    expose({ postJson, requestPurge, retryIds, copy, setPending, store, PurgeDialog, PurgePage, CopyButton });\n    return {\n      inject:'), sandbox)
  plugin.apply({ locale, effect: () => {}, slots: { inject: () => {} } })
  return { api, effects, handlers, timers, state, document, render: (component, props = {}) => { cursor = 0; return component(props) } }
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)]

test('HTTP failure preserves the safe-delete refusal code', async () => {
  const h = harness(async () => ({ ok: false, status: 409, json: async () => ({ ok: false, code: 'UNSUPPORTED_SAFE_DELETE' }) }))
  assert.equal((await h.api.requestPurge(['a'])).code, 'UNSUPPORTED_SAFE_DELETE')
})

test('menu confirmation checks capability and never posts delete when disabled', async () => {
  const calls = []
  const h = harness(async url => {
    calls.push(url)
    return { ok: true, json: async () => ({ ok: true, deletionAvailable: false, entries: [] }) }
  })
  h.api.setPending({ ids: ['a'] })
  const tree = h.render(h.api.PurgeDialog)
  h.effects[0]()
  await nodes(tree).filter(n => n.type === 'button').at(-1).props.onClick()
  assert.deepEqual(calls, ['/dsh-purge-archived/scan'])
  const updated = h.render(h.api.PurgeDialog)
  assert.ok(nodes(updated).some(n => n.props.role === 'alert' && n.children.some(c => typeof c === 'string' && c.includes('不支持删除'))))
})

test('scan disabled capability disables page deletion controls and displays explanation', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ ok: true, deletionAvailable: false, entries: [{ sessionId: 'a', logFound: false }] }) }))
  h.render(h.api.PurgePage)
  h.effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  const tree = h.render(h.api.PurgePage)
  assert.ok(nodes(tree).some(n => n.props.role === 'status' && n.children[0].includes('不支持删除')))
  const controls = nodes(tree).filter(n => n.type === 'button' && n.children.some(c => typeof c === 'string' && /删除所选|清理全部/.test(c)))
  assert.equal(controls.length, 2)
  assert.ok(controls.every(n => n.props.disabled))
})

test('locale comes from DSH, not browser language', () => {
  assert.equal(harness().api.copy('cancel'), '取消')
})

test('POST contract includes JSON and abort signal; HTTP errors cannot become success', async () => {
  let captured
  const h = harness(async (url, options) => {
    captured = { url, options }
    return { ok: false, status: 403, json: async () => ({ ok: true }) }
  })
  const result = await h.api.requestPurge(['a'])
  assert.equal(captured.url, '/dsh-purge-archived/delete')
  assert.equal(captured.options.method, 'POST')
  assert.deepEqual(JSON.parse(captured.options.body), { sessionIds: ['a'] })
  assert.ok(captured.options.signal)
  assert.equal(result.code, 'HTTP_403')
  assert.equal(h.timers.size, 0)
})

test('batch limit rejects more than 500 without a network call', async () => {
  let calls = 0
  const h = harness(async () => { calls++; return { ok: true, json: async () => ({ ok: true }) } })
  assert.equal((await h.api.requestPurge(Array(501).fill('id'))).code, 'INVALID_BATCH')
  assert.equal(calls, 0)
  await h.api.requestPurge(Array.from({ length: 500 }, (_, i) => String(i)))
  assert.equal(calls, 1)
})

test('partial retry excludes successful IDs and never imports unrelated IDs', () => {
  const { api } = harness()
  assert.deepEqual(Array.from(api.retryIds(['a', 'b', 'c'], { results: [
    { sessionId: 'a', ok: true }, { sessionId: 'b', ok: false }, { sessionId: 'other', ok: false },
  ] })), ['b', 'c'])
})

test('requests abort on external cancellation and timeout and release timers', async () => {
  const h = harness((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  const controller = new AbortController()
  const pending = h.api.postJson('/scan', {}, controller.signal)
  controller.abort()
  assert.equal((await pending).code, 'ABORTED')
  const timeout = h.api.postJson('/scan', {})
  for (const callback of h.timers.values()) callback()
  assert.equal((await timeout).code, 'TIMEOUT')
  assert.equal(h.timers.size, 0)
})

test('dialog synchronously locks duplicate clicks and Escape while busy; retry sends only failure', async () => {
  const calls = []
  let resolve
  const h = harness((_url, options) => {
    calls.push(JSON.parse(options.body))
    return new Promise(done => { resolve = done })
  })
  h.api.store.deletionAvailable = true
  h.api.setPending({ ids: ['a', 'b'], title: '', dangling: false })
  let tree = h.render(h.api.PurgeDialog)
  const cleanup = h.effects[0]()
  const confirm = nodes(tree).filter(n => n.type === 'button').at(-1).props.onClick
  const first = confirm()
  await confirm()
  h.handlers.get('keydown')({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
  assert.ok(h.api.store.pending)
  assert.equal(calls.length, 1)
  resolve({ ok: true, json: async () => ({ ok: false, results: [{ sessionId: 'a', ok: true }, { sessionId: 'b', ok: false, code: 'SESSION_LIVE' }] }) })
  await first
  tree = h.render(h.api.PurgeDialog)
  const retry = nodes(tree).filter(n => n.type === 'button').at(-1).props.onClick()
  assert.deepEqual(calls[1], { sessionIds: ['b'] })
  resolve({ ok: true, json: async () => ({ ok: true, results: [{ sessionId: 'b', ok: true }] }) })
  await retry
  assert.equal(h.api.store.pending, null)
  cleanup()
})

test('dialog wraps focus and restores its connected opener on disposal', () => {
  const h = harness()
  let restored = 0, focused = ''
  h.document.activeElement = { isConnected: true, focus: () => restored++ }
  h.api.setPending({ ids: ['a'] })
  const tree = h.render(h.api.PurgeDialog)
  const dialog = nodes(tree).find(n => n.props.role === 'dialog')
  const first = { focus: () => { focused = 'first' } }, last = { focus: () => { focused = 'last' } }
  dialog.props.ref.current = { contains: value => value === first || value === last, querySelectorAll: () => [first, last] }
  const cleanup = h.effects[0]()
  h.document.activeElement = last
  h.handlers.get('keydown')({ key: 'Tab', preventDefault() {} })
  assert.equal(focused, 'first')
  h.document.activeElement = first
  h.handlers.get('keydown')({ key: 'Tab', shiftKey: true, preventDefault() {} })
  assert.equal(focused, 'last')
  cleanup()
  assert.equal(restored, 1)
})

test('page excludes live entries, caps selection and copies raw file paths', async () => {
  const entries = Array.from({ length: 502 }, (_, i) => ({ sessionId: String(i), live: i === 0, logFound: false }))
  entries[1].files = [{ path: 'C:\\logs\\session.jsonl', bytes: 1024 }]
  const h = harness(async () => ({ ok: true, json: async () => ({ ok: true, entries }) }))
  h.render(h.api.PurgePage)
  const cleanup = h.effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  let tree = h.render(h.api.PurgePage)
  assert.equal(nodes(tree).find(n => n.type === 'input').props.disabled, true)
  nodes(tree).find(n => n.type === 'button' && n.children.includes('全选')).props.onClick()
  tree = h.render(h.api.PurgePage)
  assert.equal(nodes(tree).filter(n => n.type === 'input' && n.props.checked).length, 500)
  nodes(tree).filter(n => n.props.className === 'dsh-pa-chevron')[1].props.onClick()
  tree = h.render(h.api.PurgePage)
  const copy = nodes(tree).find(n => n.type === h.api.CopyButton && n.props.value === entries[1].files[0].path)
  assert.ok(copy)
  assert.equal(copy.props.value.includes('KB'), false)
  cleanup()
})
