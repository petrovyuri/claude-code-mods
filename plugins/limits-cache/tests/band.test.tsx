import type { ModelForkResult, On, SessionUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { WARM_GLYPH } from '../hooks/band'
import { LEAD_MS, TTL_MS, WARM_PROMPT } from '../hooks/cache'
import { assistantLine, slashes } from './fixtures'

const BAND = {
  plugin: 'limits-cache',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
  viewport: { columns: 105, rows: 40, isFullscreen: true },
} as const

const SURFACES = ['terminal', 'desktop'] as const

// A test that winds the clock on by an hour or more runs the band's one-second tick thousands
// of times: a few seconds, near the default five-second limit.
const LONG_CLOCK = { timeoutMs: 20_000 }

const START = Date.parse('2026-10-15T10:00:00Z')

// Most tests count a five-minute cache down: the store holds the TTL picked earlier.
const FIVE_MINUTES = { ttl: '5m' }

const USAGE: SessionUsage = {
  startedAt: START,
  context: { tokens: 84_000, window: 200_000, percent: 42 },
  rateLimits: [
    { kind: 'seven_day', percentUsed: 41, resetsAt: '2026-10-18T14:00:00Z' },
    { kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-15T12:15:00Z' },
  ],
}

const TURN_USAGE = {
  input_tokens: 20,
  output_tokens: 300,
  cache_read_input_tokens: 80_000,
  cache_creation_input_tokens: 4_000,
  model: 'claude-opus-5-5',
}

const forked = (read: number, write = 0): ModelForkResult => ({
  isAnswered: true,
  text: 'ok',
  usage: { input_tokens: 15, output_tokens: 1, cache_read_input_tokens: read, cache_creation_input_tokens: write },
})

type World = { forks: string[]; toasts: string[]; commands: string[] }

// The engine beneath the plugin: the session's figures, a fork that reads the whole cache,
// toasts written down rather than shown.
function engine(on: On, fork: () => ModelForkResult | Promise<ModelForkResult> = () => forked(84_000)): World {
  const world: World = { forks: [], toasts: [], commands: [] }
  on('command.register', (_, e) => {
    world.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('model.fork', async (_, e) => {
    world.forks.push(e.prompt)

    return { value: await fork() }
  })
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })

  return world
}

// Where the session's transcript is, and what it holds: `files` by path, in forward slashes.
function disk(on: On, files: Record<string, string>, folders: string[] = []): string[] {
  const reads: string[] = []
  mock.env(on, { USERPROFILE: 'C:\\Users\\dev' })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: 'C:\\work\\app' }))
  on('fs.exists', (_, e) => ({ value: slashes(e.path) in files }))
  on('fs.list', () => ({
    value: folders.map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_, e) => {
    reads.push(slashes(e.path))

    return { value: files[slashes(e.path)] ?? '' }
  })

  return reads
}

const TRANSCRIPT = 'C:/Users/dev/.claude/projects/C--work-app/sess-1.jsonl'

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

// One main-thread turn: the person asks, Claude answers over the cache.
async function answer($: Engine, turnId = 't1'): Promise<void> {
  await $.turn.start({ text: 'привет', turnId })
  await $.turn.complete({
    answer: 'готово',
    durationMs: 1000,
    isAborted: false,
    turnId,
    reason: 'answer',
    usage: TURN_USAGE,
  })
}

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

// A keyed Box holds one Text: the color it is drawn in.
async function colorOf(ui: Pick<Mounted, 'find'>, key: string): Promise<unknown> {
  const text = (await ui.find({ key }))?.children[0] as Drawn | undefined

  return text?.props?.color
}

const TONES: Record<string, string> = { '#3fb950': 'success', '#d29922': 'warning', '#f85149': 'error' }

type Bar = { fill: number; tone: unknown }

// A bar as either surface draws it, read back as how full it is and its tone.
async function barOf(ui: Pick<Mounted, 'find'>, key: string): Promise<Bar> {
  const parts = ((await ui.find({ key }))?.children ?? []) as Drawn[]
  const svg = parts.find(part => part.type === 'Svg')
  if (svg !== undefined) {
    const source = String(svg.props?.source)
    const width = Number(/width="(\d+)"/.exec(source)?.[1] ?? Number.NaN)
    const match = /<rect width="(\d+)" height="6" fill="(#[0-9a-f]{6})"\/><\/g>/.exec(source)

    return { fill: Number(match?.[1] ?? Number.NaN) / width, tone: TONES[match?.[2] ?? ''] }
  }
  const text = (part: Drawn | undefined) => String((part?.children ?? []).join(''))
  const filled = parts.find(part => part.props?.color !== undefined)
  const cells = parts.reduce((sum, part) => sum + text(part).length, 0)

  return { fill: text(filled).length / cells, tone: filled?.props?.color ?? null }
}

// A bar is filled to the fraction as near as its cells allow: the coarsest has five, so it
// may be half a cell off.
function expectBar(bar: Bar, fill: number, tone: string): void {
  expect(Math.abs(bar.fill - fill)).toBeLessThanOrEqual(1 / 10 + 1e-9)
  expect(bar.tone).toBe(tone)
}

// Whether the Auto button is drawn on: it is the primary button only while Auto is on.
async function autoOn(ui: Pick<Mounted, 'find'>): Promise<boolean> {
  return (await ui.find({ key: 'auto' }))?.props.variant === 'primary'
}

// Auto is off at the start: a test that wants it warming turns it on first.
async function turnAutoOn(ui: Pick<Mounted, 'find' | 'press'>): Promise<void> {
  expect(await autoOn(ui)).toBe(false)
  await ui.press({ key: 'auto' })
  expect(await autoOn(ui)).toBe(true)
}

for (const surface of SURFACES) {
  test(`the limits are colored progress bars (${surface})`, async ($, on) => {
    mock.clock(on, { now: START })
    mock.store(on, FIVE_MINUTES)
    engine(on)
    await start($)
    const ui = await $.ui.mount({ ...BAND, surface })

    // The five-hour window leads: almost spent, it is red.
    expectBar(await barOf(ui, 'bar:five_hour'), 0.92, 'error')
    expect((await ui.find({ key: 'percent:five_hour' }))?.text).toBe('92%')
    expect(await colorOf(ui, 'percent:five_hour')).toBe('error')
    expect(await ui.find({ type: 'Text', text: '↻ 2ч 15м' })).toBeDefined()
    // More than half of the week is left: green.
    expectBar(await barOf(ui, 'bar:seven_day'), 0.41, 'success')
    expect(await colorOf(ui, 'percent:seven_day')).toBe('success')
    expect(await ui.find({ type: 'Text', text: '↻ 3д 4ч' })).toBeDefined()

    await $.session.measure({
      context: { tokens: 120_000, window: 200_000, percent: 60 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 60 }],
      changed: ['context', 'rateLimits'],
    })
    expectBar(await barOf(ui, 'bar:five_hour'), 0.6, 'warning')
    expect(await ui.find({ key: 'bar:seven_day' })).toBeUndefined()
    await ui.unmount()
  })

  test(`the cache's life is a bar that drains green, yellow, red (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    mock.store(on, FIVE_MINUTES)
    engine(on)
    await start($)
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ key: 'cache-status' }))?.text).toBe('пусто, ответов ещё не было')
    expect(await ui.find({ key: 'cache-bar' })).toBeUndefined()

    await answer($)
    expect((await ui.find({ key: 'cache-status' }))?.text).toBe('5м')
    expectBar(await barOf(ui, 'cache-bar'), 1, 'success')
    // The bar says it all: no token count, no share served from the cache.
    expect(await ui.find({ key: 'cache-size' })).toBeUndefined()
    expect(await ui.find({ key: 'hit-rate' })).toBeUndefined()

    await clock.advance(3 * 60_000)
    expect((await ui.find({ key: 'cache-status' }))?.text).toBe('2м')
    expect(await colorOf(ui, 'cache-status')).toBe('warning')
    expectBar(await barOf(ui, 'cache-bar'), 0.4, 'warning')

    await clock.advance(90_000)
    expect((await ui.find({ key: 'cache-status' }))?.text).toBe('1м')
    expectBar(await barOf(ui, 'cache-bar'), 0.1, 'error')

    await clock.advance(3.5 * 60_000)
    // A lapsed cache: a full red bar and one word, however long ago it lapsed.
    expect((await ui.find({ key: 'cache-status' }))?.text).toBe('остыл')
    expect(await colorOf(ui, 'cache-status')).toBe('error')
    expectBar(await barOf(ui, 'cache-bar'), 1, 'error')
    await clock.advance(10 * 60_000)
    expect((await ui.find({ key: 'cache-status' }))?.text).toBe('остыл')
    await ui.unmount()
  })
}

test('the cache is counted for an hour unless the session says otherwise', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  await answer($)
  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('1ч')

  await clock.advance(30 * 60_000)
  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('30м')
  expect(await colorOf(ui, 'cache-status')).toBe('success')
  await clock.advance(60_000)
  expect(await colorOf(ui, 'cache-status')).toBe('warning')
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`the band is one line: the limits, a divider, the cache beside 🔥 and the mode (${surface})`, async ($, on) => {
    mock.clock(on, { now: START })
    mock.store(on)
    engine(on)
    await start($)
    const ui = await $.ui.mount({ ...BAND, surface })

    const band = await ui.find({ key: 'band' })
    expect(band?.props).toMatchObject({ flexDirection: 'row', flexWrap: 'nowrap' })
    const parts = (band?.children ?? []) as Drawn[]
    expect(parts.map(part => part.props?.key)).toEqual(['close', 'limits', 'divider', 'cache', 'controls'])
    expect((await ui.find({ key: 'divider' }))?.text).toBe('│')
    // The limits take the room the rest leave and give way when there is none: ✕ keeps the
    // left end, the cache and the controls the right end.
    expect(parts.map(part => part.props?.flexShrink)).toEqual([0, 1, 0, 0, 0])
    expect(parts[1]?.props).toMatchObject({ flexGrow: 1, minWidth: 0, overflow: 'hidden' })
    expect(((parts[4]?.children ?? []) as Drawn[]).map(control => control.type)).toEqual(['Button', 'Button'])
    const limits = ((await ui.find({ key: 'limits' }))?.children ?? []) as Drawn[]
    expect(limits.map(limit => limit.props?.key)).toEqual(['limit:five_hour', 'limit:seven_day'])

    // ✕ closes the band; then warm the cache now, and Auto on or off. Nothing picks the TTL.
    expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).toEqual(['close-button', 'warm', 'auto'])
    expect((await ui.find({ key: 'close-button' }))?.props).toMatchObject({ label: '✕', plain: true, dimColor: true })
    expect(await ui.findAll({ type: 'Select' })).toEqual([])
    expect((await ui.find({ key: 'warm' }))?.props).toMatchObject({ label: '↻', plain: true })
    // Auto is off at the start: grey, not the primary button.
    expect((await ui.find({ key: 'auto' }))?.props).toMatchObject({ label: 'Авто', variant: 'secondary', dimColor: true })
    await ui.unmount()
  })
}

for (const surface of SURFACES) {
  test(`the cache's group holds its label, its bar and its timer, nothing more (${surface})`, async ($, on) => {
    mock.clock(on, { now: START })
    mock.store(on)
    engine(on)
    await start($)
    const ui = await $.ui.mount({ ...BAND, surface })
    await answer($)
    await ui.press({ key: 'warm' })

    // A warmup restarts the countdown; when it ran is not written beside it.
    const cache = ((await ui.find({ key: 'cache' }))?.children ?? []) as Drawn[]
    expect(cache.map(part => part.props?.key ?? part.type)).toEqual(['Text', 'cache-bar', 'cache-status'])
    expect((await ui.find({ key: 'cache' }))?.text).not.toContain('↺')
    await ui.unmount()
  })
}

test('the limits draw shorter bars than the cache on the desktop', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await answer($)

  const svgWidth = async (key: string) => {
    const svg = (await ui.find({ key }))?.children[0] as Drawn | undefined

    return svg?.props?.width
  }
  expect(await svgWidth('cache-bar')).toBe(40)
  expect(await svgWidth('bar:five_hour')).toBe(36)
  await ui.unmount()
})

test('the Auto button turns Auto on and off; under the hour-long TTL it warms three minutes ahead', LONG_CLOCK, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  const world = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await answer($)

  // Off from the start, the button is grey through and through: dim, its label the theme's
  // inactive grey.
  const offButton = await ui.find({ key: 'auto' })
  expect(offButton?.props).toMatchObject({ label: 'Авто', variant: 'secondary', dimColor: true })
  expect((offButton?.children[0] as Drawn | undefined)?.props).toMatchObject({ color: 'inactive', dimColor: true })
  expect(offButton?.text).toBe('Авто')

  await ui.press({ key: 'auto' })
  const onButton = await ui.find({ key: 'auto' })
  expect(onButton?.props).toMatchObject({ label: 'Авто', variant: 'primary', dimColor: false })
  expect(onButton?.children).toEqual([])
  await clock.advance(TTL_MS['1h'] - LEAD_MS['1h'])
  expect(world.forks).toHaveLength(1)
  await ui.unmount()
})

test('↻ shows an hourglass while it warms', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  let release = () => {}
  const reply = new Promise<void>(resolve => {
    release = resolve
  })
  engine(on, async () => (await reply, forked(84_000)))
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await answer($)

  const pressing = ui.press({ key: 'warm' })
  await clock.settle()
  expect((await ui.find({ key: 'warm' }))?.props).toMatchObject({ label: '⏳' })
  release()
  await pressing
  expect((await ui.find({ key: 'warm' }))?.props).toMatchObject({ label: WARM_GLYPH })
  await ui.unmount()
})

// The account's usage summary, as the server answers /usage: the top-level windows, and the
// rows that name a model's own weekly window.
const SUMMARY = JSON.stringify({
  five_hour: { utilization: 80, resets_at: '2026-10-15T12:15:00Z' },
  seven_day: { utilization: 41, resets_at: '2026-10-18T14:00:00Z' },
  seven_day_opus: null,
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
  limits: [
    { kind: 'session', group: 'session', percent: 80, resets_at: '2026-10-15T12:15:00Z' },
    { kind: 'weekly_all', group: 'weekly', percent: 41, resets_at: '2026-10-18T14:00:00Z' },
    {
      kind: 'model',
      group: 'weekly',
      percent: 63,
      resets_at: '2026-10-18T14:00:00Z',
      scope: { model: { display_name: 'Fable' } },
    },
  ],
})

// A subscription's credential, and the server behind it: what was asked of it, written down.
function server(on: On, kind: 'bearer' | 'api-key', text = SUMMARY): string[] {
  const asked: string[] = []
  on('session.authorize', () => ({ value: { handle: 'h1', kind } }))
  on('http.fetch', (_, e) => {
    asked.push(`${e.url} ${e.init?.auth ?? ''}`)

    return { value: { status: 200, ok: true, headers: {}, text } }
  })

  return asked
}

for (const surface of SURFACES) {
  test(`the usage summary adds the Fable window the responses omit (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    mock.store(on)
    engine(on)
    const asked = server(on, 'bearer')
    await start($)
    const ui = await $.ui.mount({ ...BAND, surface })
    await clock.settle()

    expect(asked).toEqual(['https://api.anthropic.com/api/oauth/usage h1'])
    const limits = ((await ui.find({ key: 'limits' }))?.children ?? []) as Drawn[]
    expect(limits.map(limit => limit.props?.key)).toEqual(['limit:five_hour', 'limit:seven_day', 'limit:seven_day_fable'])
    expect(await ui.find({ type: 'Text', text: '7д Fable' })).toBeDefined()
    expectBar(await barOf(ui, 'bar:seven_day_fable'), 0.63, 'warning')
    // Fable resets with the week across all models: its reset is not written twice.
    expect(await ui.findAll({ type: 'Text', text: '↻ 3д 4ч' })).toHaveLength(1)
    // The five-hour window the last response reported stays its reading, not the summary's.
    expect((await ui.find({ key: 'percent:five_hour' }))?.text).toBe('92%')
    await ui.unmount()
  })
}

test('the summary is asked again after a turn, no more often than its gap', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  const asked = server(on, 'bearer')
  await start($)
  await clock.settle()
  expect(asked).toHaveLength(1)

  await answer($)
  await clock.settle()
  expect(asked).toHaveLength(1)

  await clock.advance(2 * 60_000)
  await answer($, 't2')
  await clock.settle()
  expect(asked).toHaveLength(2)

  // Idle, it is asked every ten minutes.
  await clock.advance(10 * 60_000)
  expect(asked).toHaveLength(3)
})

test('with an API key there is no summary to ask for', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  const asked = server(on, 'api-key')
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.settle()

  expect(asked).toEqual([])
  expect(await ui.find({ key: 'limit:seven_day_fable' })).toBeUndefined()
  await ui.unmount()
})

test('without a subscription the band says there are no limits', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['rateLimits'] })

  expect((await ui.find({ key: 'no-limits' }))?.text).toBe('Лимиты: нет данных')
  expect(await ui.find({ key: 'cache-size' })).toBeUndefined()
  await ui.unmount()
})

test('loaded mid-session, the band reads the last answer and the TTL from the transcript', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  const reads = disk(on, { [TRANSCRIPT]: assistantLine(new Date(START - 2 * 60_000).toISOString(), { m5: 900 }) })
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(reads).toEqual([TRANSCRIPT])
  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('3м')
  await ui.unmount()
})

test('after a change of directory the transcript is found by the session id', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  const moved = 'C:/Users/dev/.claude/projects/C--work-other/sess-1.jsonl'
  const reads = disk(on, { [moved]: assistantLine(new Date(START - 10 * 60_000).toISOString(), { h1: 900 }) }, [
    'C--work-app',
    'C--work-other',
  ])
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(reads).toEqual([moved])
  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('50м')
  await ui.unmount()
})

test('a new session learns its TTL from the transcript after the first answer', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  const files: Record<string, string> = {}
  disk(on, files)
  on('classic.Stop', () => ({}))
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  await answer($)
  files[TRANSCRIPT] = assistantLine(new Date(START).toISOString(), { m5: 900 })
  await $.classic.Stop({ stop_hook_active: false, transcript_path: TRANSCRIPT })
  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('5м')

  // Once known, the TTL is not read again.
  files[TRANSCRIPT] = assistantLine(new Date(START).toISOString(), { h1: 900 })
  await $.classic.Stop({ stop_hook_active: false, transcript_path: TRANSCRIPT })
  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('5м')
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`Подогреть forks the session and restarts the countdown (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    mock.store(on, FIVE_MINUTES)
    const world = engine(on)
    await start($)
    const ui = await $.ui.mount({ ...BAND, surface })
    await answer($)
    await clock.advance(2 * 60_000)
    expect((await ui.find({ key: 'cache-status' }))?.text).toBe('3м')

    await ui.press({ key: 'warm' })

    expect(world.forks).toEqual([WARM_PROMPT])
    expect(world.toasts).toEqual(['Кеш подогрет: 84k токенов из кеша'])
    expect((await ui.find({ key: 'cache-status' }))?.text).toBe('5м')
    expect((await ui.find({ key: 'warm' }))?.props).toMatchObject({ label: WARM_GLYPH })

    await clock.advance(2 * 60_000)
    expect((await ui.find({ key: 'cache-status' }))?.text).toBe('3м')
    await ui.unmount()
  })
}

test('a warmup of a cache that already lapsed says it was written anew', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on, FIVE_MINUTES)
  const world = engine(on, () => forked(0, 84_000))
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await answer($)
  await clock.advance(TTL_MS['5m'] + 60_000)

  await ui.press({ key: 'warm' })

  expect(world.toasts).toEqual(['Кеш уже остыл — записан заново: 84k токенов'])
  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('5м')
  await ui.unmount()
})

test('Подогреть before Claude answered says there is nothing to warm', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  const world = engine(on, () => ({ isAnswered: false, reason: 'nothing-to-fork' }))
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'warm' })

  // The toast says why; the band keeps no note of it.
  expect(world.toasts).toEqual(['Подогрев не удался: в сессии ещё не было ответа Claude'])
  expect(await ui.find({ key: 'warmup' })).toBeUndefined()
  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('пусто, ответов ещё не было')
  await ui.unmount()
})

test('Подогреть while Claude answers sends nothing: the turn refreshes the cache itself', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  const world = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, isWorking: true } })
  await $.turn.start({ text: 'долгая задача', turnId: 't1' })

  expect(await ui.find({ key: 'cache-spinner' })).toBeDefined()
  expectBar(await barOf(ui, 'cache-bar'), 1, 'success')
  await ui.press({ key: 'warm' })

  expect(world.forks).toEqual([])
  expect(world.toasts).toEqual(['Claude отвечает — каждый его запрос и так обновляет кеш'])
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`while Claude answers a spinner stands in for the countdown (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: START })
    mock.store(on)
    engine(on)
    await start($)
    const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, isWorking: true } })
    await answer($)

    expect(await ui.find({ key: 'cache-status' })).toBeUndefined()
    const spinner = (await ui.find({ key: 'cache-spinner' }))?.children[0] as Drawn | undefined
    if (surface === 'desktop') {
      // An Svg animates only in the interactive frame.
      expect(spinner).toMatchObject({ type: 'Svg', props: { isInteractive: true, alt: 'Кеш: идёт ответ' } })
    } else {
      expect(spinner?.children).toEqual(['◐'])
      await clock.advance(1000)
      const turned = (await ui.find({ key: 'cache-spinner' }))?.children[0] as Drawn | undefined
      expect(turned?.children).toEqual(['◓'])
    }
    await ui.unmount()
  })
}

test('Авто warms the cache before it lapses and stops after an idle hour', LONG_CLOCK, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on, FIVE_MINUTES)
  const world = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await answer($)

  await turnAutoOn(ui)
  expect(world.toasts).toEqual([])

  const period = TTL_MS['5m'] - LEAD_MS['5m']
  await clock.advance(period - 1000)
  expect(world.forks).toHaveLength(0)
  await clock.advance(1000)
  expect(world.forks).toHaveLength(1)
  // Each warmup restarts the countdown, so the next one comes a period later.
  await clock.advance(period)
  expect(world.forks).toHaveLength(2)

  // An hour after the last answer Auto gives up; the cache is left to lapse.
  await clock.advance(60 * 60_000 - 2 * period)
  const warmed = world.forks.length
  expect(warmed).toBe(Math.floor((60 * 60_000 - 1) / period))
  expect(await autoOn(ui)).toBe(false)
  expect(world.toasts).toEqual(['Авто-подогрев выключен: час без активности в сессии'])

  await clock.advance(30 * 60_000)
  expect(world.forks).toHaveLength(warmed)
  await ui.unmount()
})

test('Auto is off by default: the cache is left to lapse untouched', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on, FIVE_MINUTES)
  const world = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await answer($)
  expect(await autoOn(ui)).toBe(false)

  await clock.advance(TTL_MS['5m'] + 60_000)
  expect(world.forks).toEqual([])
  expect(world.toasts).toEqual([])
  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('остыл')
  await ui.unmount()
})

test('Auto turned on counts its idle hour from the press', LONG_CLOCK, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on, FIVE_MINUTES)
  const world = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await turnAutoOn(ui)

  await clock.advance(60 * 60_000 - 1000)
  expect(await autoOn(ui)).toBe(true)
  await clock.advance(1000)
  expect(await autoOn(ui)).toBe(false)
  expect(world.toasts).toEqual([
    'Авто включён: начнёт греть кеш после следующего ответа Claude',
    'Авто-подогрев выключен: час без активности в сессии',
  ])
  expect(world.forks).toEqual([])
  await ui.unmount()
})

test('a new answer resets the idle hour Auto counts', LONG_CLOCK, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on, FIVE_MINUTES)
  engine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await turnAutoOn(ui)
  await answer($)

  await clock.advance(50 * 60_000)
  await answer($, 't2')
  await clock.advance(50 * 60_000)

  expect(await autoOn(ui)).toBe(true)
  await ui.unmount()
})

test('Авто turned on over a cold cache waits for the next answer', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on, FIVE_MINUTES)
  const world = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await answer($)
  await clock.advance(TTL_MS['5m'] + 1000)

  await ui.press({ key: 'auto' })
  await clock.advance(10 * 60_000)

  expect(world.toasts).toEqual(['Авто включён: начнёт греть кеш после следующего ответа Claude'])
  expect(world.forks).toEqual([])
  await ui.unmount()
})

test('Авто turns itself off when a warmup is refused', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on, FIVE_MINUTES)
  const world = engine(on, () => ({
    isAnswered: false,
    reason: 'api-error',
    status: 429,
    error: 'rate_limit',
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }))
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await answer($)
  await turnAutoOn(ui)

  await clock.advance(TTL_MS['5m'])

  expect(world.forks).toHaveLength(1)
  expect(world.toasts).toEqual(['Авто-подогрев выключен. Подогрев не удался: ошибка API 429: rate_limit'])
  expect(await autoOn(ui)).toBe(false)
  await ui.unmount()
})

test('the TTL an earlier session learned is read back at the start', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on, FIVE_MINUTES)
  engine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await answer($)

  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('5м')
  await ui.unmount()
})

test('a resumed session counts the cache from its last answer', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on, FIVE_MINUTES)
  engine(on)
  on('classic.SessionStart', () => ({}))
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 120 })

  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('3м')
  await ui.unmount()
})

test('/clear and a compaction forget the cache', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  on('classic.SessionStart', () => ({}))
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  await answer($)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('пусто, ответов ещё не было')
  expect(await ui.find({ key: 'hit-rate' })).toBeUndefined()

  await answer($, 't2')
  await $.classic.SessionStart({ source: 'compact' })
  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('пусто, ответов ещё не было')
  await ui.unmount()
})

test('a model switch names the TTL and leaves the new model nothing cached', async ($, on) => {
  mock.clock(on, { now: START })
  // The plugin's store, kept where the test can read it.
  const stored: Record<string, unknown> = { ...FIVE_MINUTES }
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  engine(on)
  on('classic.PostModelSwitch', () => ({}))
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await answer($)

  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5',
    to_model: 'claude-sonnet-5-5',
    requested_model: 'sonnet',
    source: 'command',
    context_tokens: 84_000,
    prompt_cache_warm: true,
    cache_ttl: '1h',
    estimated_cache_write_usd: 0.42,
    pricing: 'catalog',
  })

  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('пусто, ответов ещё не было')
  expect(stored).toEqual({ ttl: '1h' })
  await answer($, 't2')
  expect((await ui.find({ key: 'cache-status' }))?.text).toBe('1ч')
  await ui.unmount()
})

test('a survey takes the band', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  // The engine's own drawing of the band: the survey.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>Как вам Claude?</Text>
  })
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })

  expect(await ui.find({ type: 'Text', text: 'Как вам Claude?' })).toBeDefined()
  expect(await ui.find({ key: 'warm' })).toBeUndefined()
  await ui.unmount()
})

// The engine's /usage: what it printed, and how many times it ran. Beneath the band, the
// engine draws an empty band of its own.
function usageCommand(on: On): { runs: number } {
  const calls = { runs: 0 }
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box key="engine" />
  })
  on('command.run', { command: 'usage' }, () => {
    calls.runs += 1

    return { text: 'Plan usage' }
  })

  return calls
}

// A slash command typed at the prompt, the way the engine stamps it.
const runCommand = ($: Engine, command: string) =>
  $.command.run({
    command,
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 105 },
  })

test('the mod registers /limits', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  const world = engine(on)
  await start($)

  expect(world.commands).toEqual(['limits'])
})

for (const surface of SURFACES) {
  test(`✕ takes the band away, says /limits brings it back, and /limits does (${surface})`, async ($, on) => {
    mock.clock(on, { now: START })
    mock.store(on)
    const world = engine(on)
    usageCommand(on)
    await start($)
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'band' })).toBeDefined()

    await ui.press({ key: 'close-button' })
    // Nothing of the mod's is left: the engine draws the band as its own.
    expect(await ui.find({ key: 'band' })).toBeUndefined()
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    expect(world.toasts).toEqual(['Полоса лимитов скрыта. Чтобы вернуть её, введите /limits'])
    // Closed, the band stays closed as the clock and the turns redraw it.
    await answer($)
    expect(await ui.find({ key: 'band' })).toBeUndefined()

    const result = await runCommand($, 'limits')
    expect(result.text).toBe('Полоса лимитов снова над полем ввода')
    expect(await ui.find({ key: 'band' })).toBeDefined()
    expect(await ui.find({ key: 'cache-status' })).toBeDefined()
    // Run again with the band open, it says so and changes nothing.
    expect((await runCommand($, 'limits')).text).toBe('Полоса лимитов уже на месте')
    expect(await ui.find({ key: 'band' })).toBeDefined()
    await ui.unmount()
  })
}

test('/usage, where it reaches the engine, brings the band back and runs as it always does', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  const usage = usageCommand(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'close-button' })

  const result = await runCommand($, 'usage')
  expect(result.text).toBe('Plan usage')
  expect(usage.runs).toBe(1)
  expect(await ui.find({ key: 'band' })).toBeDefined()
  await ui.unmount()
})

test('/usage with the band open leaves it open; other commands do not bring it back', async ($, on) => {
  mock.clock(on, { now: START })
  mock.store(on)
  engine(on)
  usageCommand(on)
  on('command.run', { command: 'status' }, () => ({ text: 'Status' }))
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  await runCommand($, 'usage')
  expect(await ui.find({ key: 'band' })).toBeDefined()

  await ui.press({ key: 'close-button' })
  await runCommand($, 'status')
  expect(await ui.find({ key: 'band' })).toBeUndefined()
  await ui.unmount()
})
