import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Container, Image, ListState, Logs, Network, Notice, PaneTab, Volume } from '../types'
import {
  CONTAINERS_ARGV,
  IMAGES_ARGV,
  IMAGE_PRUNE_ARGV,
  NETWORKS_ARGV,
  NETWORK_PRUNE_ARGV,
  VOLUMES_ARGV,
  VOLUME_PRUNE_ARGV,
  composeDownArgv,
  containerArgv,
  describeError,
  imageRef,
  logsArgv,
  mergeLogs,
  parseContainers,
  parseImages,
  parseNetworks,
  parseVolumes,
  reclaimed,
  removeContainersArgv,
  removeImageArgv,
  removeNetworkArgv,
  removeVolumeArgv,
  shortName,
  type ContainerAction,
} from './docker'
import { drawPane } from './pane'

const PANE = 'docker'
const POLL_MS = 5000
// Stopping waits up to ten seconds a container before it kills it.
const ACTION_TIMEOUT_MS = 180_000

const tab = atom({ plugin: 'docker-manager', key: 'tab' } as const, 'containers' as PaneTab)
const containers = atom({ plugin: 'docker-manager', key: 'containers' } as const, {
  kind: 'loading',
} as ListState<Container>)
const images = atom({ plugin: 'docker-manager', key: 'images' } as const, { kind: 'loading' } as ListState<Image>)
const networks = atom({ plugin: 'docker-manager', key: 'networks' } as const, { kind: 'loading' } as ListState<Network>)
const volumes = atom({ plugin: 'docker-manager', key: 'volumes' } as const, { kind: 'loading' } as ListState<Volume>)
const expanded = atom({ plugin: 'docker-manager', key: 'expanded' } as const, [] as string[])
const selected = atom({ plugin: 'docker-manager', key: 'selected' } as const, null as string | null)
const logs = atom({ plugin: 'docker-manager', key: 'logs' } as const, null as Logs | null)
const confirm = atom({ plugin: 'docker-manager', key: 'confirm' } as const, null as string | null)
const busy = atom({ plugin: 'docker-manager', key: 'busy' } as const, null as string | null)
const notice = atom({ plugin: 'docker-manager', key: 'notice' } as const, null as Notice | null)

type Run = { exitCode: number; stdout: string; stderr: string }

async function docker($: EngineInterface, argv: readonly string[], timeoutMs?: number): Promise<Run> {
  try {
    return await $.process.run(argv, timeoutMs === undefined ? {} : { timeoutMs })
  } catch (error) {
    return { exitCode: -1, stdout: '', stderr: String(error) }
  }
}

async function readList<T>($: EngineInterface, argv: readonly string[], parse: (text: string) => T[]): Promise<ListState<T>> {
  const run = await docker($, argv)
  if (run.exitCode === 0) {
    return { kind: 'list', items: parse(run.stdout) }
  }

  return { kind: 'error', message: describeError(run.stderr || run.stdout) }
}

// Writing an unchanged value would redraw the pane on every poll. Each atom is read and
// written where it is named: the engine's scan does not follow one passed as a parameter.
const changed = (before: unknown, after: unknown): boolean => JSON.stringify(before) !== JSON.stringify(after)

async function loadContainers($: EngineInterface): Promise<void> {
  const next = await readList($, CONTAINERS_ARGV, parseContainers)
  if (changed(await read($, containers), next)) {
    await update($, containers, () => next)
  }
  // A container removed outside the pane takes its open actions with it.
  const id = await read($, selected)
  if (id !== null && next.kind === 'list' && !next.items.some(c => c.id === id)) {
    await update($, selected, () => null)
  }
}

async function loadImages($: EngineInterface): Promise<void> {
  const next = await readList($, IMAGES_ARGV, parseImages)
  if (changed(await read($, images), next)) {
    await update($, images, () => next)
  }
}

async function loadNetworks($: EngineInterface): Promise<void> {
  const next = await readList($, NETWORKS_ARGV, parseNetworks)
  if (changed(await read($, networks), next)) {
    await update($, networks, () => next)
  }
}

async function loadVolumes($: EngineInterface): Promise<void> {
  const next = await readList($, VOLUMES_ARGV, parseVolumes)
  if (changed(await read($, volumes), next)) {
    await update($, volumes, () => next)
  }
}

// The containers always (the tab counts read them), the open tab's list besides.
async function refreshShown($: EngineInterface): Promise<void> {
  const shown = await read($, tab)
  await Promise.all([
    loadContainers($),
    shown === 'images' ? loadImages($) : null,
    shown === 'networks' ? loadNetworks($) : null,
    shown === 'volumes' ? loadVolumes($) : null,
  ])
}

async function refreshAll($: EngineInterface): Promise<void> {
  await Promise.all([loadContainers($), loadImages($), loadNetworks($), loadVolumes($)])
}

// A result line goes after a while: an error stays longer, so it can be read.
const NOTICE_MS = 5000
const ERROR_NOTICE_MS = 15_000
// Which notice is shown; a later one is not cleared by an earlier one's timer.
let noticeSeq = 0

async function say($: EngineInterface, value: Notice | null): Promise<void> {
  noticeSeq += 1
  const seq = noticeSeq
  await update($, notice, () => value)
  if (value !== null) {
    void fadeNotice($, seq, value.isError ? ERROR_NOTICE_MS : NOTICE_MS)
  }
}

async function fadeNotice($: EngineInterface, seq: number, ms: number): Promise<void> {
  try {
    await $.clock.sleep(ms)
  } catch {
    // The mod unloaded meanwhile, or no clock answers: the line stays until the next one.
    return
  }
  if (seq === noticeSeq) {
    await update($, notice, () => null)
  }
}

type Reload = 'containers' | 'images' | 'networks' | 'volumes' | 'all'

// The list an action changed, read again after it.
async function reload($: EngineInterface, what: Reload): Promise<void> {
  switch (what) {
    case 'containers':
      return loadContainers($)
    case 'images':
      return loadImages($)
    case 'networks':
      return loadNetworks($)
    case 'volumes':
      return loadVolumes($)
    case 'all':
      return refreshAll($)
  }
}

// One action at a time: a press on a button drawn before the running action is ignored.
async function act(
  $: EngineInterface,
  progress: string,
  argv: readonly string[],
  // What the result line says, from what docker printed.
  done: string | ((stdout: string) => string),
  after: Reload,
): Promise<boolean> {
  if ((await read($, busy)) !== null) {
    return false
  }
  await update($, confirm, () => null)
  await update($, busy, () => progress)
  let isOk = false
  try {
    const run = await docker($, argv, ACTION_TIMEOUT_MS)
    isOk = run.exitCode === 0
    const text = typeof done === 'string' ? done : done(run.stdout)
    await say($, isOk ? { text, isError: false } : { text: describeError(run.stderr || run.stdout), isError: true })
  } finally {
    // After the result is written, so the progress line gives way to it at once.
    await update($, busy, () => null)
  }
  await reload($, after)

  return isOk
}

const PROGRESS: Record<ContainerAction, string> = { start: 'Запускаю', stop: 'Останавливаю', restart: 'Перезапускаю' }
const DONE: Record<ContainerAction, string> = { start: 'запущен', stop: 'остановлен', restart: 'перезапущен' }

async function runContainers($: EngineInterface, action: ContainerAction, ids: string[], label: string): Promise<void> {
  if (ids.length === 0) return
  await act($, `${PROGRESS[action]} ${label}…`, containerArgv(action, ids), `${label}: ${DONE[action]}`, 'containers')
}

async function removeContainers($: EngineInterface, ids: string[], label: string): Promise<void> {
  const isOk = await act($, `Удаляю ${label}…`, removeContainersArgv(ids), `${label} удалён`, 'containers')
  const open = await read($, logs)
  if (isOk && open !== null && ids.includes(open.id)) {
    await update($, logs, () => null)
  }
}

async function composeDown($: EngineInterface, project: string): Promise<void> {
  await act($, `compose down ${project}…`, composeDownArgv(project), `${project}: down`, 'all')
}

async function loadLogs($: EngineInterface, id: string, name: string): Promise<void> {
  const run = await docker($, logsArgv(id))
  const next: Logs =
    run.exitCode === 0
      ? { kind: 'text', id, name, text: mergeLogs(run.stdout, run.stderr) }
      : { kind: 'error', id, name, message: describeError(run.stderr || run.stdout) }
  // The person may have closed the logs or opened another container's meanwhile.
  const open = await read($, logs)
  if (open !== null && open.id === id) {
    await update($, logs, () => next)
  }
}

async function showLogs($: EngineInterface, container: Container): Promise<void> {
  await update($, logs, () => ({ kind: 'loading', id: container.id, name: container.name }))
  await loadLogs($, container.id, container.name)
}

async function refreshLogs($: EngineInterface): Promise<void> {
  const open = await read($, logs)
  if (open !== null) {
    await loadLogs($, open.id, open.name)
  }
}

async function copyId($: EngineInterface, container: Container, surface: RenderSurface): Promise<void> {
  const result = await $.ui.copy({ text: container.id, surface })
  await say(
    $,
    result.isCopied
      ? { text: `ID ${container.id} скопирован`, isError: false }
      : { text: `Не удалось скопировать: ${result.reason}`, isError: true },
  )
}

async function selectTab($: EngineInterface, next: PaneTab): Promise<void> {
  await update($, tab, () => next)
  await update($, confirm, () => null)
  await refreshShown($)
}

async function toggleGroup($: EngineInterface, key: string): Promise<void> {
  await update($, expanded, open => (open.includes(key) ? open.filter(k => k !== key) : [...open, key]))
}

async function select($: EngineInterface, id: string | null): Promise<void> {
  await update($, selected, () => id)
  await update($, confirm, () => null)
}

async function prune($: EngineInterface, what: 'images' | 'networks' | 'volumes'): Promise<void> {
  switch (what) {
    case 'images':
      await act($, 'Удаляю висячие образы…', IMAGE_PRUNE_ARGV, out => reclaimed('Образы очищены', out), 'images')
      return
    case 'networks':
      await act($, 'Удаляю неиспользуемые сети…', NETWORK_PRUNE_ARGV, 'Неиспользуемые сети удалены', 'networks')
      return
    case 'volumes':
      await act($, 'Удаляю анонимные тома…', VOLUME_PRUNE_ARGV, out => reclaimed('Тома очищены', out), 'volumes')
  }
}

async function openPane($: EngineInterface): Promise<boolean> {
  const opened = await $.ui.open({ id: PANE, title: 'Docker' })
  // After the open, so the pane shows while docker answers.
  await refreshAll($)

  return opened.isPlaced
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'docker', description: 'Открыть панель Docker' })
    // State outlives a reload of the mod; an action it cut short never ends.
    await update($, busy, () => null)
    await update($, confirm, () => null)
    // A result line from before the reload has no timer left to clear it.
    await update($, notice, () => null)
    // Docker is asked only while the pane is open: the containers change outside the session.
    $.clock.every(POLL_MS, async () => {
      if ((await $.ui.panes()).some(pane => pane.id === PANE) && (await read($, busy)) === null) {
        await refreshShown($)
      }
    })

    return next(e)
  })

  on('command.run', { command: 'docker' }, async $ => {
    const isPlaced = await openPane($)

    return {
      text: isPlaced ? 'Панель Docker открыта.' : 'Панель Docker ждёт места: расширьте окно.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = {
      tab: await read($, tab),
      containers: await read($, containers),
      images: await read($, images),
      networks: await read($, networks),
      volumes: await read($, volumes),
      expanded: await read($, expanded),
      selected: await read($, selected),
      logs: await read($, logs),
      confirm: await read($, confirm),
      busy: await read($, busy),
      notice: await read($, notice),
    }

    return drawPane($.ui.resolve(e), view, {
      refresh: () => void refreshAll($),
      selectTab: next => void selectTab($, next),
      toggleGroup: key => void toggleGroup($, key),
      select: id => void select($, id),
      run: (action, ids, label) => void runContainers($, action, ids, label),
      ask: key => void update($, confirm, () => key),
      cancel: () => void update($, confirm, () => null),
      remove: (ids, label) => void removeContainers($, ids, label),
      down: project => void composeDown($, project),
      showLogs: container => void showLogs($, container),
      refreshLogs: () => void refreshLogs($),
      closeLogs: () => void update($, logs, () => null),
      copyId: (container, surface) => void copyId($, container, surface),
      removeImage: image =>
        void act($, `Удаляю ${imageRef(image)}…`, removeImageArgv(image), `${imageRef(image)} удалён`, 'images'),
      pruneImages: () => void prune($, 'images'),
      removeNetwork: network =>
        void act($, `Удаляю сеть ${network.name}…`, removeNetworkArgv(network), `Сеть ${network.name} удалена`, 'networks'),
      pruneNetworks: () => void prune($, 'networks'),
      removeVolume: volume =>
        void act($, `Удаляю том ${shortName(volume.name)}…`, removeVolumeArgv(volume), `Том ${shortName(volume.name)} удалён`, 'volumes'),
      pruneVolumes: () => void prune($, 'volumes'),
    })
  })
}
