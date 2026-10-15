import type {
  ModelCompleteResult,
  On,
  PaneOpenArgs,
  PromptFillMode,
  PromptFillResult,
  SessionMessage,
  UiOpenResult,
} from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { REPLY, SESSION } from './fixtures'

// The last words of the session's last answer (SESSION's last message).
const LAST = 'Тесты темы падают. Хранить выбор темы в shared_preferences или в Hive?'

// A block of Claude's reply in the transcript.
const reply = (text: string, extra: { isSummary?: true } = {}) =>
  ({
    plugin: 'next-step',
    component: 'AssistantMessage',
    requestId: 'msg-1',
    props: { text, isFirstOfReply: true, ...extra },
    viewport: { columns: 105, rows: 40, isFullscreen: true },
  }) as const

const PANE = {
  plugin: 'next-step',
  component: 'Pane',
  requestId: 'next-step',
  props: {
    title: 'Что дальше?',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
  viewport: { columns: 140, rows: 40, isFullscreen: true },
} as const

// A reply and a pane are drawn on every surface.
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const answered = (text: string): ModelCompleteResult => ({
  isAnswered: true,
  text,
  usage: { input_tokens: 3_000, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
})

type World = {
  messages: SessionMessage[]
  asked: { model: string; system?: string; prompt: string; effort?: string }[]
  opens: PaneOpenArgs[]
  closes: string[]
  fills: { text: string; mode: PromptFillMode }[]
  submits: string[]
  toasts: string[]
  copies: string[]
  draft: string
  fill: PromptFillResult
  placed: UiOpenResult
  reply: () => ModelCompleteResult | Promise<ModelCompleteResult>
}

// The engine beneath the plugin: the session's transcript, a model that answers by the rules,
// panes that open, a prompt box that takes what is put in it, the reply as the engine draws it.
function engine(on: On, messages: SessionMessage[] = SESSION): World {
  const world: World = {
    messages,
    asked: [],
    opens: [],
    closes: [],
    fills: [],
    submits: [],
    toasts: [],
    copies: [],
    draft: '',
    fill: { isFilled: true },
    placed: { isPlaced: true },
    reply: () => answered(REPLY),
  }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.messages', () => ({ value: world.messages }))
  on('model.complete', async (_, e) => {
    world.asked.push({ model: e.model, system: e.system, prompt: e.prompt, effort: e.effort })

    return { value: await world.reply() }
  })
  on('ui.open', (_, e) => {
    world.opens.push(e)

    return { value: world.placed }
  })
  on('ui.close', (_, e) => {
    world.closes.push(e.id)

    return { value: undefined }
  })
  on('prompt.read', () => ({ value: { text: world.draft, cursor: world.draft.length } }))
  on('prompt.fill', (_, e) => {
    world.fills.push({ text: e.text, mode: e.mode })

    return world.fill
  })
  on('prompt.submit', (_, e) => {
    world.submits.push(e.text)

    return { text: e.text }
  })
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.copy', (_, e) => {
    world.copies.push(e.text)

    return { value: { isCopied: true as const } }
  })
  // The engine's own drawing of a reply.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.component === 'AssistantMessage' ? e.props.text : ''}</Text>
  })

  return world
}

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

async function answer($: Engine, text = 'готово'): Promise<void> {
  await $.turn.complete({ answer: text, durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
}

// The person typing /next-step at the prompt.
const NEXT_STEP = {
  command: 'next-step',
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 105 },
}

// A keyed Box's texts, joined as the kit joins them: a heading runs into its paragraph.
const textOf = async (ui: Pick<Mounted, 'find'>, key: string) => (await ui.find({ key }))?.text

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

// The button under the last reply pressed: the pane opens and the model reads the session.
async function askFromReply($: Engine, surface: (typeof SURFACES)[number] = 'terminal'): Promise<void> {
  const ui = await $.ui.mount({ ...reply(LAST), surface })
  await ui.press({ key: 'next-step:ask' })
  await ui.unmount()
}

for (const surface of SURFACES) {
  test(`the button sits under the block the last answer ends with, once it has come (${surface})`, async ($, on) => {
    engine(on, [])
    await start($)
    const before = await $.ui.mount({ ...reply('готово'), surface })
    expect(await before.find({ key: 'next-step:ask' })).toBeUndefined()
    await before.unmount()

    await answer($, 'Сделал экран.\n\nготово')
    const last = await $.ui.mount({ ...reply('готово'), surface })
    expect((await last.find({ key: 'next-step:ask' }))?.props).toMatchObject({ label: '💡 Что дальше?', dimColor: true })
    await last.unmount()

    // An earlier block, or a summary of one, is no place for it.
    const earlier = await $.ui.mount({ ...reply('Смотрю файлы'), surface })
    expect(await earlier.find({ key: 'next-step:ask' })).toBeUndefined()
    await earlier.unmount()
    const summary = await $.ui.mount({ ...reply('готово', { isSummary: true }), surface })
    expect(await summary.find({ key: 'next-step:ask' })).toBeUndefined()
    await summary.unmount()

    // While the next turn runs the button waits for its answer.
    await $.prompt.submit({ text: 'дальше', wait: false, origin: { kind: 'composer' } })
    const running = await $.ui.mount({ ...reply('готово'), surface })
    expect(await running.find({ key: 'next-step:ask' })).toBeUndefined()
    await running.unmount()
  })

  test(`the reply keeps the engine's drawing; the button goes under it (${surface})`, async ($, on) => {
    engine(on)
    await start($)
    const ui = await $.ui.mount({ ...reply(LAST), surface })

    const drawn = (await ui.drawn()) as Drawn
    expect(drawn.props).toMatchObject({ key: 'next-step:reply', flexDirection: 'column' })
    const parts = (drawn.children ?? []) as Drawn[]
    expect(parts.map(part => part.type)).toEqual(['Text', 'Box'])
    expect(parts[0]?.children).toEqual([LAST])
    // A row of air between the reply and the button, which keeps to the right.
    expect(parts[1]?.props).toMatchObject({ key: 'next-step:under', paddingTop: 1, justifyContent: 'flex-end' })
    await ui.unmount()
  })

  test(`the button opens the pane on a brief the cheap model made (${surface})`, async ($, on) => {
    const world = engine(on)
    await start($)
    await askFromReply($, surface)

    expect(world.opens).toEqual([{ id: 'next-step', title: 'Что дальше?', focus: true, closeOnEscape: true }])
    expect(world.asked).toHaveLength(1)
    expect(world.asked[0]?.model).toBe('haiku')
    expect(world.asked[0]?.effort).toBe('low')
    expect(world.asked[0]?.prompt).toContain('[>] Переключатель темы')
    expect(world.asked[0]?.prompt).toContain('→ Bash flutter test — ошибка: 2 tests failed')
    expect(world.asked[0]?.system).toContain('JSON')
  })
}

const OPTIONS = ['Храни тему в shared_preferences', 'Почини падающие тесты темы', 'Покажи, что сделано по плану']

// The pane opened on a ready brief: the press waits for the model's reply.
async function openReady($: Engine, surface: (typeof SURFACES)[number]) {
  await askFromReply($)

  return $.ui.mount({ ...PANE, surface })
}

for (const surface of SURFACES) {
  test(`the pane: where it stopped, what comes next, room around it, Обновить on the right (${surface})`, async ($, on) => {
    engine(on)
    await start($)
    const ui = await openReady($, surface)

    expect(await textOf(ui, 'next-step:status')).toBe(
      'На чём остановилисьЭкран настроек готов, переключатель темы в работе; два теста падают.',
    )
    expect(await textOf(ui, 'next-step:next')).toBe('Что дальшеВыбрать хранилище для темы и починить тесты.')
    expect((await ui.find({ key: 'next-step' }))?.props).toMatchObject({ paddingX: 1, paddingY: 1 })
    expect((await ui.find({ key: 'next-step:options' }))?.props).toMatchObject({ rowGap: 1 })
    const actions = await ui.find({ key: 'next-step:actions' })
    expect(actions?.props).toMatchObject({ flexDirection: 'row', justifyContent: 'flex-end' })
    expect((actions?.children as Drawn[]).map(child => child.props?.key)).toEqual(['next-step:refresh'])
    await ui.unmount()
  })
}

// Off the desktop each card is a frame: the whole message wrapped, and a Выбрать button whose
// digit picks it.
for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
  test(`a card is a frame with the whole message and a Выбрать button (${surface})`, async ($, on) => {
    const world = engine(on)
    await start($)
    const ui = await openReady($, surface)

    expect((await ui.find({ key: 'next-step:option:1:card' }))?.props).toMatchObject({ borderStyle: 'round', paddingX: 1 })
    expect(await Promise.all([1, 2, 3].map(n => textOf(ui, `next-step:option:${n}:text`)))).toEqual(OPTIONS)
    const text = ((await ui.find({ key: 'next-step:option:1:text' }))?.children ?? []) as Drawn[]
    expect(text[0]?.props).toMatchObject({ wrap: 'wrap' })
    const buttons = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('next-step:option:'))
    expect(buttons.map(button => [button.key, button.props.label, button.props.hotkey])).toEqual([
      ['next-step:option:1', 'Выбрать', '1'],
      ['next-step:option:2', 'Выбрать', '2'],
      ['next-step:option:3', 'Выбрать', '3'],
    ])

    // A pick lands in the empty prompt box, and the pane has done its part.
    await ui.press({ key: 'next-step:option:2' })
    expect(world.fills).toEqual([{ text: 'Почини падающие тесты темы', mode: 'replace' }])
    expect(world.closes).toEqual(['next-step'])
    await ui.unmount()
  })
}

test('on the desktop a card is the module’s, and a click anywhere on it picks the message', async ($, on) => {
  const world = engine(on)
  await start($)
  await askFromReply($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Loaded, the tree names the module by its path under the plugin.
  const cards = (await ui.findAll({ type: 'Client' })).map(card => [card.key, card.props.module, card.props.props])
  expect(cards).toEqual([
    ['next-step:option:1', 'hooks/card.tsx', { n: 1, text: OPTIONS[0] }],
    ['next-step:option:2', 'hooks/card.tsx', { n: 2, text: OPTIONS[1] }],
    ['next-step:option:3', 'hooks/card.tsx', { n: 3, text: OPTIONS[2] }],
  ])
  // The card draws the number and the whole message, wrapped, in a frame with room inside.
  const drawn = (await ui.drawn({ in: 'next-step:option:2' })) as Drawn
  expect(drawn.props).toMatchObject({ borderStyle: 'round', paddingX: 1 })
  expect(await ui.find({ type: 'Text', text: OPTIONS[1], in: 'next-step:option:2' })).toBeDefined()

  await ui.pointer({ type: 'down', x: 20, y: 1, button: 'left', in: 'next-step:option:2' })
  expect(world.fills).toEqual([{ text: 'Почини падающие тесты темы', mode: 'replace' }])
  expect(world.closes).toEqual(['next-step'])
  await ui.unmount()
})

test('a post naming no message of the brief picks nothing', async ($, on) => {
  const world = engine(on)
  await start($)
  await askFromReply($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.post({ pick: 9 }, { in: 'next-step:option:1' })
  await ui.post({ other: true }, { in: 'next-step:option:1' })

  expect(world.fills).toEqual([])
  await ui.unmount()
})

// A desktop that cannot run the card module raises `ui.fault`, which the kit does not let a
// test raise: the fallback it switches to is the frame the other surfaces draw, tested above.

test('a brief that stands ready is shown again, not asked for again; Обновить asks anew', async ($, on) => {
  const world = engine(on)
  await start($)
  await askFromReply($)
  await askFromReply($)
  expect(world.opens).toHaveLength(2)
  expect(world.asked).toHaveLength(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'next-step:refresh' })
  expect(world.asked).toHaveLength(2)
  await ui.unmount()
})

test('a draft the person typed is kept: the pick goes after it', async ($, on) => {
  const world = engine(on)
  world.draft = 'и ещё:'
  await start($)
  await askFromReply($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'next-step:option:1' })

  expect(world.fills).toEqual([{ text: '\nХрани тему в shared_preferences', mode: 'append' }])
  await ui.unmount()
})

// The engine's own refusals (no box of its own, a dialog over it) reach a plugin from the engine
// alone, never from a hook beneath it: tests/fill.test.ts holds what a pick does after each.
test('a box a hook keeps the text out of: the text goes to the clipboard, the pane stays', async ($, on) => {
  const world = engine(on)
  world.fill = { isFilled: false }
  await start($)
  await askFromReply($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'next-step:option:2' })

  expect(world.copies).toEqual(['Почини падающие тесты темы'])
  expect(world.toasts).toEqual(['Текст скопирован: вставьте его в поле ввода'])
  expect(world.closes).toEqual([])
  await ui.unmount()
})

test('while the model reads, the pane says so; Cancel drops the late reply', async ($, on) => {
  const world = engine(on)
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  world.reply = async () => {
    await gate

    return answered(REPLY)
  }
  await start($)
  const last = await $.ui.mount({ ...reply(LAST), surface: 'terminal' })
  const pressed = last.press({ key: 'next-step:ask' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Let the press run up to the model's call.
  for (let i = 0; i < 20 && (await ui.find({ key: 'next-step:cancel' })) === undefined; i++) {
    await Promise.resolve()
  }

  expect(await textOf(ui, 'next-step:status')).toBe('Изучаю сессию…')
  await ui.press({ key: 'next-step:cancel' })
  expect((await ui.find({ key: 'next-step:refresh' }))?.props.label).toBe('Собрать сводку')

  release()
  await pressed
  expect(await ui.find({ key: 'next-step:options' })).toBeUndefined()
  expect((await ui.find({ key: 'next-step:refresh' }))?.props.label).toBe('Собрать сводку')
  await ui.unmount()
  await last.unmount()
})

test('a reply with no text says why, and Повторить asks again', async ($, on) => {
  const world = engine(on)
  world.reply = () => ({
    isAnswered: false,
    reason: 'api-error',
    status: 429,
    error: 'rate_limit',
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  })
  await start($)
  await askFromReply($, 'desktop')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await textOf(ui, 'next-step:status')).toBe('Модель не ответила (429)')
  expect((await ui.find({ key: 'next-step:refresh' }))?.props.label).toBe('Повторить')

  world.reply = () => answered(REPLY)
  await ui.press({ key: 'next-step:refresh' })
  expect(world.asked).toHaveLength(2)
  expect(await ui.find({ key: 'next-step:option:1' })).toBeDefined()
  await ui.unmount()
})

test('a reply that is no JSON stands as the status, with nothing to pick', async ($, on) => {
  const world = engine(on)
  world.reply = () => answered('Вы остановились на тестах темы.')
  await start($)
  await askFromReply($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await textOf(ui, 'next-step:status')).toBe('На чём остановилисьВы остановились на тестах темы.')
  expect(await ui.find({ key: 'next-step:options' })).toBeUndefined()
  expect(await ui.find({ key: 'next-step:next' })).toBeUndefined()
  await ui.unmount()
})

test('the model picked in /config reads the session', { options: { model: 'sonnet' } }, async ($, on) => {
  const world = engine(on)
  await start($)
  await askFromReply($)

  expect(world.asked[0]?.model).toBe('sonnet')
})

test('/next-step opens the pane and asks', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on)
  await start($)

  expect(await $.command.run(NEXT_STEP)).toEqual({})
  await clock.settle()
  expect(world.opens.map(open => open.id)).toEqual(['next-step'])
  expect(world.asked).toHaveLength(1)
})

test('an empty session has nothing to read: the pane says what it will show', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, [])
  await start($)
  await $.command.run(NEXT_STEP)
  await clock.settle()

  expect(world.asked).toEqual([])
  expect(world.toasts).toEqual(['В сессии пока нечего пересказывать'])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'next-step:refresh' }))?.props.label).toBe('Собрать сводку')
  await ui.unmount()
})

test('a pane the surface cannot place is said in a toast', async ($, on) => {
  const world = engine(on)
  world.placed = { isPlaced: false, reason: 'the terminal is 80 columns wide; the pane needs 110' }
  await start($)
  await askFromReply($)

  expect(world.toasts).toEqual(['Панель «Что дальше?» не помещается: расширьте окно'])
})

test('a new prompt moves the conversation on: the brief is gone, the pane closed', async ($, on) => {
  const world = engine(on)
  await start($)
  await askFromReply($)

  await $.prompt.submit({ text: 'сделаю по-своему', wait: false, origin: { kind: 'composer' } })
  expect(world.closes).toEqual(['next-step'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'next-step:options' })).toBeUndefined()
  await ui.unmount()
})

test('a /clear forgets the brief, closes the pane and hides the button', async ($, on) => {
  const world = engine(on)
  await start($)
  await askFromReply($)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(world.closes).toEqual(['next-step'])
  const last = await $.ui.mount({ ...reply(LAST), surface: 'terminal' })
  expect(await last.find({ key: 'next-step:ask' })).toBeUndefined()
  await last.unmount()
})
