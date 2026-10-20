import type { Elements, RenderChildren, RenderSurface } from 'claude-code'

import type { Container, Image, ListState, Logs, Network, Notice, PaneTab, Volume } from '../types'
import { BUILT_IN_NETWORKS, groupContainers, isRunning, shortName, type ContainerAction, type Group } from './docker'

// The elements every surface carries: the pane draws in the terminal and the desktop alike.
type El = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Link' | 'Code'>

export type View = {
  tab: PaneTab
  containers: ListState<Container>
  images: ListState<Image>
  networks: ListState<Network>
  volumes: ListState<Volume>
  expanded: string[]
  selected: string | null
  logs: Logs | null
  confirm: string | null
  busy: string | null
  notice: Notice | null
}

export type Actions = {
  refresh: () => void
  selectTab: (tab: PaneTab) => void
  toggleGroup: (key: string) => void
  select: (id: string | null) => void
  // `label` names what the action is run on, for the progress line and the result.
  run: (action: ContainerAction, ids: string[], label: string) => void
  ask: (key: string) => void
  cancel: () => void
  remove: (ids: string[], label: string) => void
  down: (project: string) => void
  showLogs: (container: Container) => void
  refreshLogs: () => void
  closeLogs: () => void
  copyId: (container: Container, surface: RenderSurface) => void
  removeImage: (image: Image) => void
  pruneImages: () => void
  removeNetwork: (network: Network) => void
  pruneNetworks: () => void
  removeVolume: (volume: Volume) => void
  pruneVolumes: () => void
}

// The colour of a container's dot, as VS Code tints its icon.
function stateColor(state: string): string {
  switch (state) {
    case 'running':
      return 'success'
    case 'paused':
    case 'restarting':
      return 'warning'
    case 'dead':
      return 'error'
    default:
      return 'inactive'
  }
}

const groupKey = (key: string): string => (key === '' ? '_single' : key)

// The widest a bar grows: up to this many containers it draws a cell for each.
const BAR_MAX = 20

// A bar's cells: one a container, the running ones filled; a group past BAR_MAX keeps
// BAR_MAX cells and fills its running share of them.
export function barCells(running: number, total: number, max = BAR_MAX): { filled: number; width: number } {
  if (total <= 0) return { filled: 0, width: 0 }
  if (total <= max) return { filled: Math.min(Math.max(running, 0), total), width: total }

  return { filled: shareCells(running, total, max), width: max }
}

// How much of a bar the running containers fill: none when nothing runs, the whole bar when all do.
function shareCells(running: number, total: number, width: number): number {
  if (running <= 0) return 0
  if (running >= total) return width

  // Partly running never reads as empty or full.
  return Math.min(width - 1, Math.max(1, Math.round((running / total) * width)))
}

// The word beside the bar: only a part-running group needs one; a full green bar or an empty
// one, with its count, says it alone.
export function runLabel(running: number, total: number): string {
  if (running <= 0 || running >= total) return ''

  return 'частично'
}

// Each action's glyph and colour: go green, stop red, the rest by how far they reach.
export const ICONS = {
  start: { glyph: '▶', color: 'success' },
  stop: { glyph: '■', color: 'error' },
  restart: { glyph: '↻', color: 'suggestion' },
  down: { glyph: '⏏', color: 'warning' },
  remove: { glyph: '✕', color: 'error' },
} as const

export type Icon = (typeof ICONS)[keyof typeof ICONS]

// What holds an image: Docker refuses to remove one while any container, running or stopped,
// was made from it.
export function usedBy(containers: number): string {
  const last = containers % 10
  const teen = containers % 100 >= 11 && containers % 100 <= 14
  const word = teen || last === 0 || last >= 5 ? 'контейнеров' : last === 1 ? 'контейнер' : 'контейнера'

  return `${containers} ${word} исп.`
}

export function drawPane(el: El, view: View, act: Actions) {
  const { Box, Button, Code, Link, Text } = el

  const card = (key: string, children: RenderChildren[]) => (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
      {children}
    </Box>
  )

  // A destructive press asks again in place: the button gives way to "Да / Отмена".
  // Given an icon, the button draws it and the label becomes its hover hint.
  const confirmable = (key: string, label: string, question: string, onConfirm: () => void, icon?: Icon) =>
    view.confirm === key ? (
      <Box key={`ask:${key}`} gap={1} alignItems="center">
        <Text color="warning">{question}</Text>
        <Button key={`yes:${key}`} variant="primary" label="Да" onPress={onConfirm} />
        <Button key={`no:${key}`} label="Отмена" onPress={act.cancel} />
      </Box>
    ) : icon !== undefined ? (
      iconButton(key, icon, label, () => act.ask(key))
    ) : (
      <Button key={key} label={label} dimColor onPress={() => act.ask(key)} />
    )

  const statusLine =
    view.busy !== null ? (
      <Box key="notice">
        <Text color="suggestion">⏳ {view.busy}</Text>
      </Box>
    ) : view.notice === null ? null : (
      <Box key="notice">
        <Text color={view.notice.isError ? 'error' : 'success'}>
          {view.notice.isError ? '✕ ' : '✓ '}
          {view.notice.text}
        </Text>
      </Box>
    )

  const count = <T,>(state: ListState<T>, title: string) =>
    state.kind === 'list' ? `${title} ${state.items.length}` : title

  const tabButton = (id: PaneTab, label: string) => (
    <Button
      key={`tab:${id}`}
      label={label}
      variant={view.tab === id ? 'primary' : 'secondary'}
      onPress={() => act.selectTab(id)}
    />
  )

  const header = (
    <Box key="header" gap={1} alignItems="center" justifyContent="space-between">
      <Box gap={1} flexWrap="wrap">
        {tabButton('containers', count(view.containers, 'Контейнеры'))}
        {tabButton('images', count(view.images, 'Образы'))}
        {tabButton('networks', count(view.networks, 'Сети'))}
        {tabButton('volumes', count(view.volumes, 'Тома'))}
      </Box>
      <Button key="refresh" label="Обновить" dimColor onPress={act.refresh} />
    </Box>
  )

  // Loading and failure read the same on every tab.
  const listOr = <T,>(state: ListState<T>, what: string, draw: (items: T[]) => RenderChildren[]) => {
    if (state.kind === 'loading') {
      return [<Text dimColor>Читаю {what}…</Text>]
    }
    if (state.kind === 'error') {
      return [<Text color="error">{state.message}</Text>]
    }
    if (state.items.length === 0) {
      return [<Text dimColor>Нет {what}</Text>]
    }

    return draw(state.items)
  }

  // A text bar: the running share in green, the rest dim, and the word for it.
  const runBar = (key: string, running: number, total: number) => {
    const { filled, width } = barCells(running, total)
    const label = runLabel(running, total)

    return (
      <Box key={`bar:${key}`} gap={1} alignItems="center" flexShrink={0}>
        <Text>
          <Text color="success">{'█'.repeat(filled)}</Text>
          <Text color="inactive">{'░'.repeat(width - filled)}</Text>
        </Text>
        {label !== '' && <Text color="warning">{label}</Text>}
      </Box>
    )
  }

  // An icon alone on the button; what it does shows while the pointer rests on it.
  // The terminal colours the glyph; a desktop draws its own button in its own colour.
  const iconButton = (key: string, icon: Icon, tip: string, onPress: () => void) => (
    <Box key={`tip:${key}`}>
      <Button key={key} onPress={onPress}>
        <Text color={icon.color}>{icon.glyph}</Text>
      </Button>
      <Box
        position="absolute"
        top={-2}
        right={0}
        display="none"
        hover={{ display: 'flex' }}
        backgroundColor="text"
        paddingX={1}
      >
        <Text color="inverseText" wrap="truncate">
          {tip}
        </Text>
      </Box>
    </Box>
  )

  const portLinks = (container: Container) =>
    container.ports
      .filter(port => port.url !== null)
      .map(port => (
        <Link key={`port:${container.id}:${port.host}:${port.container}`} href={port.url ?? ''} label={`:${port.host}`} />
      ))

  const containerActions = (container: Container) => {
    const name = container.name
    const running = isRunning(container)

    return (
      <Box key={`actions:${container.id}`} gap={1} paddingLeft={4} flexWrap="wrap" alignItems="center">
        {running ? (
          <Button key={`stop:${container.id}`} label="Стоп" onPress={() => act.run('stop', [container.id], name)} />
        ) : (
          <Button
            key={`start:${container.id}`}
            variant="primary"
            label="Старт"
            onPress={() => act.run('start', [container.id], name)}
          />
        )}
        {running && (
          <Button
            key={`restart:${container.id}`}
            label="Рестарт"
            onPress={() => act.run('restart', [container.id], name)}
          />
        )}
        <Button key={`logs:${container.id}`} label="Логи" onPress={() => act.showLogs(container)} />
        <Button key={`copy:${container.id}`} label="Копировать ID" dimColor onPress={press => act.copyId(container, press.surface)} />
        {confirmable(`rm:${container.id}`, 'Удалить', `Удалить ${name}?`, () => act.remove([container.id], name))}
      </Box>
    )
  }

  const containerRow = (container: Container) => {
    const isSelected = view.selected === container.id

    return (
      <Box key={`c:${container.id}`} flexDirection="column" gap={1}>
        <Box gap={1} paddingLeft={2} alignItems="center">
          <Text color={stateColor(container.state)}>●</Text>
          <Button
            key={`sel:${container.id}`}
            label={container.service ?? container.name}
            plain
            onPress={() => act.select(isSelected ? null : container.id)}
          />
          <Text dimColor wrap="truncate">
            {container.image}
          </Text>
          <Text dimColor wrap="truncate">
            {container.status}
          </Text>
          {portLinks(container)}
        </Box>
        {isSelected && containerActions(container)}
      </Box>
    )
  }

  const groupRow = (group: Group) => {
    const key = groupKey(group.key)
    const isOpen = view.expanded.includes(group.key)
    const ids = group.containers.map(c => c.id)
    const running = group.containers.filter(isRunning)
    const stopped = group.containers.filter(c => !isRunning(c))
    const isProject = group.key !== ''

    return (
      <Box key={`g:${key}`} flexDirection="column" gap={1}>
        {/* The name and count on the left, the project's actions on the right, as VS Code's row.
            The whole row lights under the pointer, so a button reads as its project's; the name
            gives way when narrow, the buttons never wrap off their row. */}
        <Box
          key={`row:${key}`}
          gap={2}
          paddingX={1}
          alignItems="center"
          justifyContent="space-between"
          hover={{ backgroundColor: 'subtle' }}
        >
          <Box gap={1} alignItems="center" flexShrink={1} minWidth={0} overflow="hidden">
            <Button
              key={`group:${key}`}
              label={`${isOpen ? '▾' : '▸'} ${group.title}`}
              plain
              onPress={() => act.toggleGroup(group.key)}
            />
            <Text color={running.length > 0 ? 'success' : 'inactive'}>
              {running.length}/{group.containers.length}
            </Text>
            {runBar(`g:${key}`, running.length, group.containers.length)}
          </Box>
          <Box gap={1} alignItems="center" flexShrink={0}>
            {isProject &&
              stopped.length > 0 &&
              iconButton(`gstart:${key}`, ICONS.start, `Запустить ${group.title}`, () =>
                act.run('start', stopped.map(c => c.id), group.title),
              )}
            {isProject &&
              running.length > 0 &&
              iconButton(`gstop:${key}`, ICONS.stop, `Остановить ${group.title}`, () =>
                act.run('stop', running.map(c => c.id), group.title),
              )}
            {isProject &&
              running.length > 0 &&
              iconButton(`grestart:${key}`, ICONS.restart, `Перезапустить ${group.title}`, () =>
                act.run('restart', ids, group.title),
              )}
            {isProject &&
              confirmable(
                `down:${group.key}`,
                `Compose down ${group.title}: удалить контейнеры проекта`,
                `compose down ${group.title}?`,
                () => act.down(group.key),
                ICONS.down,
              )}
          </Box>
        </Box>
        {isOpen && group.containers.map(containerRow)}
      </Box>
    )
  }

  const logsCard = (logs: Logs) =>
    card('logs', [
      <Box key="logs-head" gap={1} alignItems="center" justifyContent="space-between">
        <Text bold>Логи: {logs.name}</Text>
        <Box gap={1}>
          <Button key="logs-refresh" label="Обновить" dimColor onPress={act.refreshLogs} />
          <Button key="logs-close" label="Закрыть" dimColor onPress={act.closeLogs} />
        </Box>
      </Box>,
      logs.kind === 'loading' ? (
        <Text dimColor>Читаю логи…</Text>
      ) : logs.kind === 'error' ? (
        <Text color="error">{logs.message}</Text>
      ) : logs.text === '' ? (
        <Text dimColor>Лог пуст</Text>
      ) : (
        <Code key="logs-text" source={logs.text} language="log" />
      ),
    ])

  const containersTab = () => [
    ...(view.logs !== null ? [logsCard(view.logs)] : []),
    card('containers', [
      // Rows apart, so the buttons of one row do not touch the next one's.
      <Box key="groups" flexDirection="column" gap={1} paddingY={1}>
        {listOr(view.containers, 'контейнеров', items => groupContainers(items).map(groupRow))}
      </Box>,
    ]),
  ]

  // One line a row: what it is on the left, cut short when narrow; its button on the right.
  // The whole row lights under the pointer, so its button reads as its own.
  const listRow = (key: string, info: RenderChildren[], action: RenderChildren) => (
    <Box
      key={key}
      gap={2}
      paddingX={1}
      alignItems="center"
      justifyContent="space-between"
      hover={{ backgroundColor: 'subtle' }}
    >
      <Box gap={1} alignItems="center" flexShrink={1} minWidth={0} overflow="hidden">
        {info}
      </Box>
      <Box flexShrink={0}>{action}</Box>
    </Box>
  )

  // What a row is: its name on a line of its own, the details dim beneath it.
  const nameOver = (name: RenderChildren, details: RenderChildren[]) => [
    <Box flexDirection="column" minWidth={0}>
      {name}
      <Box gap={2} minWidth={0}>
        {details}
      </Box>
    </Box>,
  ]

  // The tab's bulk action above, the rows apart, so no button touches the next row's.
  const listCard = (key: string, tool: RenderChildren, rows: RenderChildren[]) =>
    card(key, [
      <Box key={`${key}-list`} flexDirection="column" gap={1} paddingY={1}>
        <Box key={`${key}-tools`} justifyContent="flex-end">
          {tool}
        </Box>
        {rows}
      </Box>,
    ])

  const imagesTab = () =>
    listCard(
      'images',
      confirmable('prune:images', 'Удалить висячие', 'Удалить образы без тега, которые никто не использует?', act.pruneImages),
      listOr(view.images, 'образов', items =>
        items.map(image =>
          listRow(
            `i:${image.id}:${image.repository}:${image.tag}`,
            // What it weighs and who uses it beneath the name.
            nameOver(
              <Text bold wrap="truncate">
                {image.repository}
                <Text dimColor>:{image.tag}</Text>
              </Text>,
              [
                <Text dimColor>{image.size}</Text>,
                <Text dimColor wrap="truncate">
                  {image.created}
                </Text>,
                image.containers > 0 && (
                  <Text color="success" wrap="truncate">
                    {usedBy(image.containers)}
                  </Text>
                ),
              ],
            ),
            confirmable(
              `rmi:${image.id}:${image.repository}:${image.tag}`,
              `Удалить образ ${image.repository}:${image.tag}`,
              `Удалить ${image.repository}:${image.tag}?`,
              () => act.removeImage(image),
              ICONS.remove,
            ),
          ),
        ),
      ),
    )

  const networksTab = () =>
    listCard(
      'networks',
      confirmable('prune:networks', 'Удалить неиспользуемые', 'Удалить сети без контейнеров?', act.pruneNetworks),
      listOr(view.networks, 'сетей', items =>
        items.map(network =>
          listRow(
            `n:${network.id}`,
            nameOver(
              <Text bold wrap="truncate">
                {network.name}
              </Text>,
              [
                <Text dimColor>{network.driver}</Text>,
                <Text dimColor>{network.scope}</Text>,
                network.project !== null && (
                  <Text color="suggestion" wrap="truncate">
                    {network.project}
                  </Text>
                ),
              ],
            ),
            BUILT_IN_NETWORKS.has(network.name)
              ? null
              : confirmable(
                  `rmn:${network.id}`,
                  `Удалить сеть ${network.name}`,
                  `Удалить сеть ${network.name}?`,
                  () => act.removeNetwork(network),
                  ICONS.remove,
                ),
          ),
        ),
      ),
    )

  const volumesTab = () =>
    listCard(
      'volumes',
      confirmable('prune:volumes', 'Удалить анонимные', 'Удалить безымянные тома без контейнеров?', act.pruneVolumes),
      listOr(view.volumes, 'томов', items =>
        items.map(volume =>
          listRow(
            `v:${volume.name}`,
            nameOver(
              <Text bold wrap="truncate">
                {shortName(volume.name)}
              </Text>,
              [
                <Text dimColor>{volume.driver}</Text>,
                volume.project !== null && (
                  <Text color="suggestion" wrap="truncate">
                    {volume.project}
                  </Text>
                ),
              ],
            ),
            confirmable(
              `rmv:${volume.name}`,
              `Удалить том ${shortName(volume.name)}`,
              `Удалить том ${shortName(volume.name)} с данными?`,
              () => act.removeVolume(volume),
              ICONS.remove,
            ),
          ),
        ),
      ),
    )

  const body =
    view.tab === 'containers'
      ? containersTab()
      : view.tab === 'images'
        ? [imagesTab()]
        : view.tab === 'networks'
          ? [networksTab()]
          : [volumesTab()]

  return (
    <Box flexDirection="column" gap={1}>
      {header}
      {statusLine}
      {body}
    </Box>
  )
}
