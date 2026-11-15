import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'pair',
  component: 'Pane',
  requestId: 'pair',
  props: {
    title: 'pair',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const
const BAND = {
  plugin: 'pair',
  component: 'AbovePrompt',
  props: { bodyColumns: 120, hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 3, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

const DATA = '/home/u/.claude/plugins/data'
const DIR = `${DATA}/pair-inline/sessions/S1`
/** The engine hands Windows paths (C:\home\u\...) on Windows: the test world compares in POSIX form. (15-Nov-26) */
const posix = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const ANN = 'u@h · Ann · a@x'
const line = (kind: string, content: string, meta: Record<string, unknown> = {}) =>
  `${JSON.stringify({ meta: { kind, peer: ANN, ...meta }, content })}\n`

/** The engine beneath: a session id, a file system in memory, pair's MCP tools, the pane's placement. */
function world(on: On) {
  const files: Record<string, string> = { [`${DIR}/inbox.jsonl`]: '' }
  const w = {
    files,
    calls: [] as { tool: string; args: unknown }[],
    prompts: [] as string[],
    opened: 0,
    isUp: true, // pair has made this session's folder
    isPlaced: true, // a surface places the pane when opened
    toolText: undefined as string | undefined, // what the model reads from a tool call
    askAnswer: '', // the label the person picks in a question dialog ($.ui.ask)
    alive: false, // something delivers events to Claude (the monitor's watch.alive is fresh)
  }
  mock.env(on, { HOME: '/home/u' })
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 14, 14, 2) })
  on('session.id', () => ({ value: 'S1' }))
  on('command.register', () => ({ value: { command: 'pair-pane' } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'Darwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.open', () => {
    w.opened++
    return { value: w.isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: '144 columns' } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({ value: posix(e.path) === DATA || (w.isUp && (posix(e.path) === DIR || posix(e.path) in files)) }))
  on('fs.list', () => ({
    value: ['other-plugin', 'pair-inline'].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_, e) => {
    const text = w.isUp ? files[posix(e.path)] : undefined
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('fs.write', (_, e) => {
    files[posix(e.path)] = e.text
    return { value: undefined }
  })
  on('mcp.call', (_, e) => {
    w.calls.push({ tool: e.tool, args: e.args })
    return { value: { content: [{ type: 'text', text: `${e.tool} ok` }], isError: false } }
  })
  on('prompt.submit', (_, e) => {
    w.prompts.push(e.text)
    return { text: e.text }
  })
  on('tool.call', (_, e) => {
    // $.ui.ask raises AskUserQuestion: answer with the person's pick. (AI Shipmates pane, 15-Nov-26)
    if (e.tool === 'AskUserQuestion') {
      const q = (e as unknown as { questions: { question: string }[] }).questions[0]!.question
      return { result: { answers: { [q]: w.askAnswer } } }
    }
    return { result: {}, ...(w.toolText === undefined ? {} : { text: w.toolText }) }
  })
  // watch.alive "touched just now" while w.alive (a far-future mtime always counts as recent); nothing else exists.
  on('fs.stat', (_, e) => {
    if (w.alive && posix(e.path).endsWith('/watch.alive')) {
      return { value: { kind: 'file' as const, size: 0, mtimeMs: 9e15, isLink: false } }
    }
    throw new Error('missing')
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { w, clock, inbox: (s: string) => (files[`${DIR}/inbox.jsonl`] += s) }
}

test('a pairing request, Accept, then a message handed to Claude', async ($, on) => {
  const { w, clock, inbox } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  inbox(line('pair_request', 'Someone named …'))
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Ann wants to pair/ })).toBeDefined()
    expect(await ui.find({ key: 'accept' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'accept' })
  expect(w.calls).toEqual([{ tool: 'pair_accept', args: {} }])
  expect(await ui.find({ type: 'Text', text: /trust: read-only/ })).toBeDefined()

  inbox(line('message', 'hello there', { trust: 'ask', via: 'direct' }))
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /hello there/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /· direct/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ new$/ })).toBeDefined()
  await ui.press({ key: 'hand-in-1' })
  expect(w.prompts[0]).toMatch(/^pair · message from Ann, handed to Claude by you\nhello there/)
  expect(await ui.find({ type: 'Text', text: /handed to Claude \d\d:\d\d/ })).toBeDefined()
  await ui.unmount()
})

test('chat goes to the outbox with an id, earlier lines kept', async ($, on) => {
  const { w, clock, inbox } = world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  inbox(line('paired', 'Ann accepted.'))
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /sent as you, not via Claude/ })).toBeDefined()
  await ui.input({ key: 'chat', text: 'first' })
  await ui.input({ key: 'chat', text: 'second' })
  const sent = w.files[`${DIR}/outbox.jsonl`]!.trim().split('\n').map(l => JSON.parse(l))
  expect(sent.map(m => m.text)).toEqual(['first', 'second'])
  expect(new Set(sent.map(m => m.id)).size).toBe(2)
  expect(await ui.find({ type: 'Text', text: /^second$/ })).toBeDefined()
  await ui.unmount()
})

test("Claude's own messages and files show as yours", async ($, on) => {
  const { clock, inbox } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  inbox(line('paired', 'Ann accepted.'))
  await clock.advance(1000)
  await $.tool.call({ tool: 'mcp__plugin_pair_pair__send_to_peer', text: 'patch incoming' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^your Claude$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^patch incoming$/ })).toBeDefined()
  await ui.unmount()
})

test('messages the peer confirmed show delivered, matched by id', async ($, on) => {
  const { w, clock, inbox } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  inbox(line('paired', 'Ann accepted.'))
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'from me' })
  const id = JSON.parse(w.files[`${DIR}/outbox.jsonl`]!.trim()).id
  w.toolText = 'queued for sending (not confirmed yet; message id 18a2f-c)'
  await $.tool.call({ tool: 'mcp__plugin_pair_pair__send_to_peer', text: 'from Claude' })
  expect(await ui.find({ type: 'Text', text: /^ delivered$/ })).toBeUndefined()
  inbox(line('message_delivered', 'Ann received your message.', { id }))
  inbox(line('message_delivered', 'Ann received your message.', { id: '18a2f-c' }))
  await clock.advance(1000)
  expect(await ui.findAll({ type: 'Text', text: /^ delivered$/ })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /received your message/ })).toBeUndefined() // no row of its own
  await ui.unmount()
})

test('Files tab: received file with Open, Reveal and → Claude; f switches to it', async ($, on) => {
  const { clock, inbox } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  inbox(line('paired', 'Ann accepted.'))
  inbox(line('file', 'Ann sent a file …', { name: 'upload-fail.har', size: 2_200_000, path: '/r/upload-fail.har' }))
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-files' })
  expect(await ui.find({ type: 'Text', text: /Received from Ann/ })).toBeDefined()
  for (const key of ['open-in-1', 'reveal-in-1', 'hand-in-1']) expect(await ui.find({ key })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Shared files/ })).toBeDefined()
  await ui.unmount()
})

test('pane closed: the band shows what is new; Open pane opens it and the band goes', async ($, on) => {
  const { w, clock, inbox } = world(on)
  w.isPlaced = false // too narrow to dock: the band is how the person hears
  // The engine's own band, drawn when pair has nothing to show there.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  inbox(line('paired', 'Ann accepted.'))
  await clock.advance(1000)
  inbox(line('message', 'No rush on the retry one.'))
  await clock.advance(1000)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^1 new$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /No rush on the retry one/ })).toBeDefined()
  w.isPlaced = true
  const before = w.opened // the paired event already tried once, unasked
  await band.press({ key: 'open' })
  expect(w.opened).toBe(before + 1)
  expect(await band.find({ key: 'open' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await band.unmount()
})

// Multi-peer (added 14-Nov-26): one row per pairing, Accept answers the pending request by its peer id, chat goes to
// the pairing picked in the header, your rows say who they went to, and an unpaired pairing leaves the list.
test('three peers: a row each, Accept names the request, chat goes to the picked peer', async ($, on) => {
  const { w, clock, inbox } = world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const as = (who: string, id: string) => ({ peer: `u@h · ${who} · x@y`, peer_id: id })
  inbox(line('paired', 'Ann accepted.', { peer_id: 'p1' }))
  inbox(line('paired', 'Bo accepted.', as('Bo', 'p2')))
  inbox(line('pair_request', 'Someone named …', as('Cy', 'p3')))
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /3 of 3 pairings open/ })).toBeDefined()
  await ui.press({ key: 'accept' })
  expect(w.calls.at(-1)).toEqual({ tool: 'pair_accept', args: { peer: 'p3' } })
  await ui.press({ key: 'peer-p2' })
  await ui.input({ key: 'chat', text: 'hi Bo' })
  expect(JSON.parse(w.files[`${DIR}/outbox.jsonl`]!.trim())).toMatchObject({ text: 'hi Bo', peer: 'p2' })
  expect(await ui.find({ type: 'Text', text: /^you → Bo$/ })).toBeDefined()

  inbox(line('unpaired', 'Pairing ended: the other side unpaired', as('Bo', 'p2')))
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /2 of 3/ })).toBeDefined()
  await ui.unmount()
})

test('pair starts after the pane: it says so, then finds the session; mobile can type too', async ($, on) => {
  const { w, clock, inbox } = world(on)
  w.isUp = false
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /isn’t running in this session/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Not paired\.$/ })).toBeDefined()

  w.isUp = true
  inbox(line('pair_request', 'Someone named …'))
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /isn’t running in this session/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Ann wants to pair/ })).toBeDefined()
  await ui.unmount()

  inbox(line('paired', 'Ann accepted.'))
  await clock.advance(1000)
  const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
  // CHANGED 15-Nov-26: Claude Code's mobile surface now has an Input (claude-code.d.ts Elements.mobile), so the box shows.
  expect(await phone.find({ key: 'chat' })).toBeDefined()
  await phone.unmount()
})

test('the Default trust level setting shows until an event says otherwise', { options: { default_trust: 'normal' } }, async ($, on) => {
  const { clock, inbox } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  inbox(line('paired', 'Ann accepted.'))
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /trust: normal/ })).toBeDefined()
  await ui.unmount()
})

test('hand to Claude automatically: on by default', async ($, on) => {
  const { w, clock } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  expect(w.files[`${DIR}/deliver`]).toBe('on\n')
})

test('hand to Claude automatically, off: the server is told, and the pane says messages wait', { options: { hand_to_claude: false } }, async ($, on) => {
  const { w, clock, inbox } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  inbox(line('paired', 'Ann accepted.'))
  await clock.advance(1000)
  expect(w.files[`${DIR}/deliver`]).toBe('off\n')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Messages wait here until you press → Claude/ })).toBeDefined()
  await ui.unmount()
})

// AI Shipmates pane (added 15-Nov-26, beads ship-anj.1-.6, .10).
const CREW = {
  hub: { name: 'Hub', agent: 'claude', colour: 0 },
  members: [{ handle: 'ann-box', agent: 'claude', colour: 1 }, { handle: 'bo-box', agent: 'codex', colour: 2 }],
  you: 'ann-box',
}
const BOARD = {
  summary: 'Tagging v0.2.0',
  needs: [{ id: 'n3', question: 'Which version?', options: ['0.2.0', '0.1.18'], recommended: 0, context: 'CI is green', from: 'bo-box' }],
  fyi: [{ id: 'f1', from: 'hub', text: 'CI minutes at 80%' }],
}

test('AI Shipmates: summary first, typed text in full, crew and board, Needs you answers through the outbox', async ($, on) => {
  const { w, clock, inbox } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  inbox(line('paired', 'Hub accepted.', { peer_id: 'p1' }))
  inbox(line('crew', 'crew list', { crew: CREW, peer_id: 'p1' }))
  inbox(line('board', 'crew board', { board: BOARD, peer_id: 'p1' }))
  inbox(line('message', '[shipmates] from @bo-box to @all:\nthe long full text', { summary: 'Build green on main', from: 'bo-box', agent: 'codex', colour: 2, peer_id: 'p1' }))
  inbox(line('message', '[shipmates] from @hub to @all:\ntyped hello', { typed: true, from: 'hub', peer_id: 'p1' }))
  inbox(line('message', '[shipmates] Shipmates: @hub (Hub), @bo-box.\nStart a message with @all', { peer_id: 'p1' }))
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^AI Shipmates$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Tagging v0\.2\.0 · @hub, @ann-box, @bo-box/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Build green on main$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /the long full text/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /typed hello/ })).toBeDefined() // a person's text: in full
    expect(await ui.find({ type: 'Text', text: / · no summary$/ })).toBeDefined() // pair's own notice: first line
    expect(await ui.find({ type: 'Text', text: /crew list|crew board/ })).toBeUndefined() // no rows of their own
    expect(await ui.find({ type: 'Text', text: /^Needs you \(1\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^You should know \(1\)$/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'full-in-3' })
  expect(await ui.find({ type: 'Text', text: /the long full text/ })).toBeDefined()
  w.askAnswer = '0.2.0 (Recommended)'
  await ui.press({ key: 'needs' })
  const sent = w.files[`${DIR}/outbox.jsonl`]!.trim().split('\n').map(l => JSON.parse(l))
  expect(sent.at(-1)).toMatchObject({ answer: { item: 'n3', option: '0.2.0', question: 'Which version?' }, peer: 'p1' })
  expect(await ui.find({ type: 'Text', text: /^Needs you \(0\)$/ })).toBeDefined()
  await ui.press({ key: 'know' })
  expect(await ui.find({ type: 'Text', text: /CI minutes at 80%/ })).toBeDefined()
  await ui.unmount()
})

test('AI Shipmates: on the hub the message box writes to the whole crew', async ($, on) => {
  const { w, clock, inbox } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  inbox(line('paired', 'Ann accepted.', { peer_id: 'p1' }))
  inbox(line('crew', 'crew list', { crew: { ...CREW, you: 'hub' }, peer: '' }))
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Message the whole crew/ })).toBeDefined()
  await ui.input({ key: 'chat', text: 'hello crew' })
  expect(JSON.parse(w.files[`${DIR}/outbox.jsonl`]!.trim())).toMatchObject({ text: 'hello crew', peer: 'all' })
  await ui.unmount()
})

test('→ Claude shows only for messages Claude did not already get by itself', async ($, on) => {
  const { w, clock, inbox } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  inbox(line('paired', 'Ann accepted.'))
  w.alive = true
  inbox(line('message', 'delivered by the monitor'))
  await clock.advance(1000)
  w.alive = false
  inbox(line('message', 'nobody delivered this'))
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'hand-in-1' })).toBeUndefined()
  expect(await ui.find({ key: 'hand-in-2' })).toBeDefined()
  await ui.unmount()
})
