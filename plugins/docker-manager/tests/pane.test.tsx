import type { ProcessRunResult } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { DAEMON_DOWN, IMAGES_OUT, NETWORKS_OUT, PS_OUT, VOLUMES_OUT } from './fixtures'

const PANE = {
  component: 'Pane',
  requestId: 'docker',
  props: {
    title: 'Docker',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
  viewport: { columns: 120, rows: 40, isFullscreen: true },
} as const

const DESKTOP = { plugin: 'docker-manager', surface: 'desktop', ...PANE } as const
const TERMINAL = { plugin: 'docker-manager', surface: 'terminal', ...PANE } as const

// A `process.run` hook answers `{ value }`: what `$.process.run` resolves with.
const run = (exitCode: number, stdout = '', stderr = ''): { value: ProcessRunResult } => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

// Docker as the fixtures describe it; every other command succeeds silently.
function dockerHost(calls: string[][], answer?: (argv: readonly string[]) => { value: ProcessRunResult } | null) {
  return (_: unknown, e: { argv: readonly string[] }) => {
    calls.push([...e.argv])
    const own = answer?.(e.argv)
    if (own) return own
    const [, command, sub] = e.argv
    if (command === 'ps') return run(0, PS_OUT)
    if (command === 'images') return run(0, IMAGES_OUT)
    if (command === 'network' && sub === 'ls') return run(0, NETWORKS_OUT)
    if (command === 'volume' && sub === 'ls') return run(0, VOLUMES_OUT)

    return run(0)
  }
}

test('the containers tab groups compose projects and lists a project on expand', async ($, on) => {
  const calls: string[][] = []
  on('process.run', dockerHost(calls))

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ key: 'tab:containers' })).toMatchObject({ props: { label: 'Контейнеры 3' } })
  expect(await ui.find({ key: 'group:shop' })).toMatchObject({ props: { label: '▸ shop' } })
  expect(await ui.find({ key: 'group:_single' })).toMatchObject({ props: { label: '▸ Отдельные контейнеры' } })
  expect(await ui.find({ type: 'Text', text: '1/2' })).toBeDefined()
  // Collapsed: the services are not drawn.
  expect(await ui.find({ key: 'sel:aaa111' })).toBeUndefined()

  await ui.press({ key: 'group:shop' })
  // The open project's arrow turns down.
  expect(await ui.find({ key: 'group:shop' })).toMatchObject({ props: { label: '▾ shop' } })
  expect(await ui.find({ key: 'sel:aaa111' })).toMatchObject({ props: { label: 'db' } })
  expect(await ui.find({ key: 'sel:bbb222' })).toMatchObject({ props: { label: 'api' } })
  // The published port opens in a browser.
  expect(await ui.find({ type: 'Link' })).toMatchObject({ props: { href: 'http://localhost:5432', label: ':5432' } })
  await ui.unmount()
})

test('a selected running container stops; the project starts its stopped ones', async ($, on) => {
  const calls: string[][] = []
  on('process.run', dockerHost(calls))

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'group:shop' })
  await ui.press({ key: 'sel:aaa111' })

  expect(await ui.find({ key: 'start:aaa111' })).toBeUndefined()
  await ui.press({ key: 'stop:aaa111' })
  expect(calls).toContainEqual(['docker', 'stop', 'aaa111'])
  expect(await ui.find({ type: 'Text', text: '✓ shop-db-1: остановлен' })).toBeDefined()

  await ui.press({ key: 'gstart:shop' })
  expect(calls).toContainEqual(['docker', 'start', 'bbb222'])
  await ui.unmount()
})

test('removing a container asks first and is forced', async ($, on) => {
  const calls: string[][] = []
  on('process.run', dockerHost(calls))

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'group:_single' })
  await ui.press({ key: 'sel:ccc333' })
  await ui.press({ key: 'rm:ccc333' })

  expect(calls.some(argv => argv[1] === 'rm')).toBe(false)
  expect(await ui.find({ type: 'Text', text: 'Удалить redis-dev?' })).toBeDefined()
  await ui.press({ key: 'no:rm:ccc333' })
  expect(await ui.find({ key: 'rm:ccc333' })).toBeDefined()

  await ui.press({ key: 'rm:ccc333' })
  await ui.press({ key: 'yes:rm:ccc333' })
  expect(calls).toContainEqual(['docker', 'rm', '-f', 'ccc333'])
  await ui.unmount()
})

test('compose down asks first and names the project', async ($, on) => {
  const calls: string[][] = []
  on('process.run', dockerHost(calls))

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'down:shop' })
  await ui.press({ key: 'yes:down:shop' })

  expect(calls).toContainEqual(['docker', 'compose', '-p', 'shop', 'down'])
  expect(await ui.find({ type: 'Text', text: '✓ shop: down' })).toBeDefined()
  await ui.unmount()
})

test('the logs card shows stdout and stderr together and closes', async ($, on) => {
  const calls: string[][] = []
  on(
    'process.run',
    dockerHost(calls, argv =>
      argv[1] === 'logs' ? run(0, '2026-10-16T05:58:30Z ready\n', '2026-10-16T05:58:29Z warming up\n') : null,
    ),
  )

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'group:shop' })
  await ui.press({ key: 'sel:aaa111' })
  await ui.press({ key: 'logs:aaa111' })

  expect(calls).toContainEqual(['docker', 'logs', '--timestamps', '--tail', '300', 'aaa111'])
  expect(await ui.find({ type: 'Text', text: 'Логи: shop-db-1' })).toBeDefined()
  const code = await ui.find({ type: 'Code' })
  const source = String(code?.props.source)
  expect(source.indexOf('warming up')).toBeLessThan(source.indexOf('ready'))

  await ui.press({ key: 'logs-close' })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.unmount()
})

test('Docker not running reads as such on the containers tab', async ($, on) => {
  on('process.run', () => run(1, '', DAEMON_DOWN))

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'refresh' })

  expect(await ui.find({ type: 'Text', text: 'Docker не запущен: запустите Docker Desktop' })).toBeDefined()
  await ui.unmount()
})

test('a failed action shows Docker’s reason', async ($, on) => {
  const calls: string[][] = []
  on(
    'process.run',
    dockerHost(calls, argv =>
      argv[1] === 'image' && argv[2] === 'rm'
        ? run(1, '', 'Error response from daemon: conflict: image is being used by running container aaa111\n')
        : null,
    ),
  )

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'tab:images' })
  expect(await ui.find({ key: 'tab:images' })).toMatchObject({ props: { label: 'Образы 2', variant: 'primary' } })

  await ui.press({ key: 'rmi:f74600a1a463:postgres:16' })
  await ui.press({ key: 'yes:rmi:f74600a1a463:postgres:16' })
  expect(calls).toContainEqual(['docker', 'image', 'rm', 'postgres:16'])
  expect(
    await ui.find({ type: 'Text', text: '✕ conflict: image is being used by running container aaa111' }),
  ).toBeDefined()
  await ui.unmount()
})

test('networks: the built-in ones cannot be removed; volumes prune asks first', async ($, on) => {
  const calls: string[][] = []
  on('process.run', dockerHost(calls))

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'tab:networks' })
  expect(await ui.find({ key: 'rmn:66de0734e849' })).toBeUndefined()
  await ui.press({ key: 'rmn:f323d9436ffe' })
  await ui.press({ key: 'yes:rmn:f323d9436ffe' })
  expect(calls).toContainEqual(['docker', 'network', 'rm', 'f323d9436ffe'])

  await ui.press({ key: 'tab:volumes' })
  expect(await ui.find({ type: 'Text', text: '0a19c68ab22e…' })).toBeDefined()
  await ui.press({ key: 'prune:volumes' })
  await ui.press({ key: 'yes:prune:volumes' })
  expect(calls).toContainEqual(['docker', 'volume', 'prune', '-f'])
  await ui.unmount()
})

test('the pane draws in the terminal too', async ($, on) => {
  const calls: string[][] = []
  on('process.run', dockerHost(calls))

  const ui = await $.ui.mount(TERMINAL)
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ key: 'group:shop' })).toBeDefined()
  await ui.unmount()
})

test('a result line goes after five seconds, an error after fifteen', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[][] = []
  on(
    'process.run',
    dockerHost(calls, argv => (argv[1] === 'restart' ? run(1, '', 'Error response from daemon: boom\n') : null)),
  )

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'gstop:shop' })
  expect(await ui.find({ type: 'Text', text: '✓ shop: остановлен' })).toBeDefined()
  await clock.advance(4000)
  expect(await ui.find({ type: 'Text', text: '✓ shop: остановлен' })).toBeDefined()
  await clock.advance(1000)
  expect(await ui.find({ key: 'notice' })).toBeUndefined()

  await ui.press({ key: 'grestart:shop' })
  expect(await ui.find({ type: 'Text', text: '✕ boom' })).toBeDefined()
  await clock.advance(5000)
  expect(await ui.find({ type: 'Text', text: '✕ boom' })).toBeDefined()
  await clock.advance(10_000)
  expect(await ui.find({ key: 'notice' })).toBeUndefined()
  await ui.unmount()
})

test('a newer result line is not cleared by the older timer', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[][] = []
  on('process.run', dockerHost(calls))

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'gstop:shop' })
  await clock.advance(3000)
  await ui.press({ key: 'gstart:shop' })
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: '✓ shop: запущен' })).toBeDefined()
  await clock.advance(3000)
  expect(await ui.find({ key: 'notice' })).toBeUndefined()
  await ui.unmount()
})

test('a project’s buttons are coloured icons whose hint shows on hover', async ($, on) => {
  const calls: string[][] = []
  on('process.run', dockerHost(calls))

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'refresh' })

  // shop runs one of two: start, stop, restart and down are all offered.
  // Go is green, stop red: the glyph is a coloured Text inside the button. No label of words: a
  // desktop draws a label in the glyph's place, so the words are the hover hint's alone.
  for (const [key, icon, color, tip] of [
    ['gstart:shop', '▶', 'success', 'Запустить shop'],
    ['gstop:shop', '■', 'error', 'Остановить shop'],
    ['grestart:shop', '↻', 'suggestion', 'Перезапустить shop'],
    ['down:shop', '⏏', 'warning', 'Compose down shop: удалить контейнеры проекта'],
  ]) {
    const button = { props: { key }, children: [{ props: { color }, children: [icon] }] }
    expect(await ui.find({ key })).toMatchObject(button)
    // The engine names the button by its glyph, never by the hint's words.
    expect(await ui.find({ key })).toMatchObject({ props: { label: icon } })
    expect((await ui.find({ key }))?.props).not.toHaveProperty('dimColor')
    // The hint is drawn hidden beside the button and revealed by hover; no frame round it.
    expect((await ui.find({ key: `tip:${key}` }))?.props).not.toHaveProperty('borderStyle')
    expect(await ui.find({ key: `tip:${key}` })).toMatchObject({
      children: [
        button,
        { props: { display: 'none' }, hover: { display: 'flex' }, children: [{ children: [tip] }] },
      ],
    })
  }

  // The project's row lights as one under the pointer, and its buttons never wrap off it.
  // `find` leaves `hover` off the node it lands on, so the row is read from its group.
  const row = (await ui.find({ key: 'g:shop' }))?.children?.[0]
  expect(row).toMatchObject({ props: { key: 'row:shop' }, hover: { backgroundColor: 'subtle' } })
  expect(row).toMatchObject({ children: [{ props: { flexShrink: 1 } }, { props: { flexShrink: 0 } }] })
  expect(JSON.stringify(row)).not.toContain('"flexWrap"')

  // The icon still asks before compose down.
  await ui.press({ key: 'down:shop' })
  expect(calls.some(argv => argv[1] === 'compose')).toBe(false)
  expect(await ui.find({ type: 'Text', text: 'compose down shop?' })).toBeDefined()
  await ui.unmount()
})

test('the terminal colours the glyph and draws no frame round the button too', async ($, on) => {
  const calls: string[][] = []
  on('process.run', dockerHost(calls))

  const ui = await $.ui.mount(TERMINAL)
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ key: 'gstop:shop' })).toMatchObject({ children: [{ props: { color: 'error' } }] })
  expect((await ui.find({ key: 'tip:gstop:shop' }))?.props).not.toHaveProperty('borderStyle')
  await ui.unmount()
})

test('an image row: the name, and beneath it the size, age and how many containers use it', async ($, on) => {
  const calls: string[][] = []
  on('process.run', dockerHost(calls))

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'tab:images' })

  // postgres:16 is held by one container; the dangling image by none.
  const rows = ((await ui.find({ key: 'images-list' }))?.children ?? []).slice(1)
  expect(rows[0]).toMatchObject({
    children: [
      {
        children: [
          {
            props: { flexDirection: 'column' },
            children: [
              { props: { bold: true }, children: ['postgres', { children: [':', '16'] }] },
              {
                children: [
                  { children: ['420MB'] },
                  { children: ['7 days ago'] },
                  { props: { color: 'success' }, children: ['1 контейнер исп.'] },
                ],
              },
            ],
          },
        ],
      },
      {},
    ],
  })
  expect(JSON.stringify(rows[1])).not.toContain('исп.')
  expect(JSON.stringify(rows)).not.toContain('контейнеров:')
  await ui.unmount()
})

test('networks and volumes: the name on its own line, the details beneath', async ($, on) => {
  const calls: string[][] = []
  on('process.run', dockerHost(calls))

  const ui = await $.ui.mount(DESKTOP)
  // A row's first child holds what it is; the box within it, the name over the details.
  type Node = { children?: Node[] }
  const info = async (list: string, index: number) => {
    const rows = ((await ui.find({ key: list }))?.children ?? []).slice(1) as Node[]

    return rows[index]?.children?.[0]?.children?.[0]
  }

  await ui.press({ key: 'tab:networks' })
  expect(await info('networks-list', 1)).toMatchObject({
    props: { flexDirection: 'column' },
    children: [
      { props: { bold: true }, children: ['shop_default'] },
      { children: [{ children: ['bridge'] }, { children: ['local'] }, { props: { color: 'suggestion' }, children: ['shop'] }] },
    ],
  })

  await ui.press({ key: 'tab:volumes' })
  expect(await info('volumes-list', 0)).toMatchObject({
    props: { flexDirection: 'column' },
    children: [
      { props: { bold: true }, children: ['shop_pgdata'] },
      { children: [{ children: ['local'] }, { props: { color: 'suggestion' }, children: ['shop'] }] },
    ],
  })
  await ui.unmount()
})

test('images, networks and volumes: a row lights whole, its delete is an icon naming it', async ($, on) => {
  const calls: string[][] = []
  on('process.run', dockerHost(calls))

  const ui = await $.ui.mount(DESKTOP)
  for (const [tab, list, key, tip] of [
    ['images', 'images-list', 'rmi:f74600a1a463:postgres:16', 'Удалить образ postgres:16'],
    ['networks', 'networks-list', 'rmn:f323d9436ffe', 'Удалить сеть'],
    ['volumes', 'volumes-list', 'rmv:', 'Удалить том'],
  ]) {
    await ui.press({ key: `tab:${tab}` })
    // `find` leaves `hover` off the node it lands on, so the rows are read from their list.
    const rows = ((await ui.find({ key: list }))?.children ?? []).slice(1)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row).toMatchObject({ hover: { backgroundColor: 'subtle' } })

    const text = JSON.stringify(rows)
    expect(text).toContain(`{"type":"Text","props":{"color":"error"},"children":["✕"]}`)
    expect(text).toContain(tip)
    // The words stay in the hint: no Button carries them as its label.
    expect(text).not.toContain(`"label":"${tip}`)
    expect(text).toContain(key)
    expect(text).not.toContain(`"label":"Удалить"`)
  }

  // The icon still asks first.
  await ui.press({ key: 'tab:images' })
  await ui.press({ key: 'rmi:f74600a1a463:postgres:16' })
  expect(calls.some(argv => argv[1] === 'image' && argv[2] === 'rm')).toBe(false)
  expect(await ui.find({ type: 'Text', text: 'Удалить postgres:16?' })).toBeDefined()
  await ui.unmount()
})

test('a group draws a bar: green while it runs, empty and wordless when nothing does', async ($, on) => {
  const calls: string[][] = []
  const allStopped = PS_OUT.replaceAll('	running	', '	exited	')
  let stopped = false
  on('process.run', dockerHost(calls, argv => (argv[1] === 'ps' && stopped ? run(0, allStopped) : null)))
  const bar = async (key: string) => (await ui.find({ key: `bar:${key}` }))?.text

  const ui = await $.ui.mount(DESKTOP)
  await ui.press({ key: 'refresh' })

  // A cell a container: shop runs one of two, the hand-run redis runs alone.
  expect(await bar('g:shop')).toBe('█░частично')
  // A fully running group: the green bar alone, no «запущен».
  expect(await bar('g:_single')).toBe('█')
  // The filled cells are green, the rest dim, the word coloured by state.
  expect(await ui.find({ key: 'bar:g:shop' })).toMatchObject({
    children: [
      { children: [{ props: { color: 'success' } }, { props: { color: 'inactive' } }] },
      { props: { color: 'warning' } },
    ],
  })

  // An open project's containers draw no bar and no word: the dot tells their state.
  await ui.press({ key: 'group:shop' })
  expect(await ui.find({ key: 'sel:aaa111' })).toBeDefined()
  expect(await ui.find({ key: 'bar:c:aaa111' })).toBeUndefined()
  expect(await ui.find({ key: 'bar:c:bbb222' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'запущен' })).toBeUndefined()

  // Everything stopped: no green cell is left and no word: the empty bar and 0/2 say it.
  stopped = true
  await ui.press({ key: 'refresh' })
  expect(await bar('g:shop')).toBe('░░')
  expect(await bar('g:_single')).toBe('░')
  expect(await ui.find({ type: 'Text', text: 'остановлен' })).toBeUndefined()
  expect(await ui.find({ key: 'bar:g:shop' })).toMatchObject({
    children: [{ children: [{ children: [''] }, { props: { color: 'inactive' } }] }],
  })
  await ui.unmount()
})
