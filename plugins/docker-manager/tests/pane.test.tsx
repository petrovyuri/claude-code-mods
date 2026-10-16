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
