import type { Container, Image, Network, Port, Volume } from '../types'

// Fields split by tabs: a label's value may hold commas, which `{{json .}}` joins labels with.
const PROJECT = '{{.Label "com.docker.compose.project"}}'

export const CONTAINERS_ARGV = [
  'docker',
  'ps',
  '-a',
  '--format',
  `{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Ports}}\t${PROJECT}\t{{.Label "com.docker.compose.service"}}`,
] as const

export const IMAGES_ARGV = [
  'docker',
  'images',
  '--format',
  '{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}\t{{.Containers}}',
] as const

export const NETWORKS_ARGV = [
  'docker',
  'network',
  'ls',
  '--format',
  `{{.ID}}\t{{.Name}}\t{{.Driver}}\t{{.Scope}}\t${PROJECT}`,
] as const

export const VOLUMES_ARGV = ['docker', 'volume', 'ls', '--format', `{{.Name}}\t{{.Driver}}\t${PROJECT}`] as const

// Only what nothing uses and nothing names: dangling images, unused networks, anonymous volumes.
export const IMAGE_PRUNE_ARGV = ['docker', 'image', 'prune', '-f'] as const
export const NETWORK_PRUNE_ARGV = ['docker', 'network', 'prune', '-f'] as const
export const VOLUME_PRUNE_ARGV = ['docker', 'volume', 'prune', '-f'] as const

// The networks Docker makes itself and refuses to remove.
export const BUILT_IN_NETWORKS = new Set(['bridge', 'host', 'none'])

// How many lines of a container's log the pane shows.
export const LOG_LINES = 300
// What one Code element draws at most.
const LOG_CHARS = 100_000

export type ContainerAction = 'start' | 'stop' | 'restart'

export const containerArgv = (action: ContainerAction, ids: readonly string[]): string[] => [
  'docker',
  action,
  ...ids,
]

// Forced: a running container is stopped first, as VS Code's "Remove" does after its question.
export const removeContainersArgv = (ids: readonly string[]): string[] => ['docker', 'rm', '-f', ...ids]

// Compose finds the project's containers, networks and volumes by its label: no file needed.
export const composeDownArgv = (project: string): string[] => ['docker', 'compose', '-p', project, 'down']

export const logsArgv = (id: string): string[] => ['docker', 'logs', '--timestamps', '--tail', String(LOG_LINES), id]

// By name where it has one: removing by ID refuses an image tagged in several repositories.
export const imageRef = (image: Image): string =>
  image.repository === '<none>' || image.tag === '<none>' ? image.id : `${image.repository}:${image.tag}`

export const removeImageArgv = (image: Image): string[] => ['docker', 'image', 'rm', imageRef(image)]

export const removeNetworkArgv = (network: Network): string[] => ['docker', 'network', 'rm', network.id]

export const removeVolumeArgv = (volume: Volume): string[] => ['docker', 'volume', 'rm', volume.name]

const lines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line !== '')

const orNull = (text: string | undefined): string | null => (text === undefined || text === '' ? null : text)

// `0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp, 6379/tcp`: IPv4 and IPv6 publish the same port twice.
export function parsePorts(text: string): Port[] {
  const ports: Port[] = []
  for (const part of text.split(',')) {
    const entry = part.trim()
    if (entry === '') continue
    const arrow = entry.indexOf('->')
    if (arrow === -1) {
      ports.push({ host: null, container: entry, url: null })
      continue
    }
    const hostSide = entry.slice(0, arrow)
    const container = entry.slice(arrow + 2)
    const host = hostSide.slice(hostSide.lastIndexOf(':') + 1)
    if (ports.some(port => port.host === host && port.container === container)) continue
    const url = container.endsWith('/tcp') ? `http://localhost:${host}` : null
    ports.push({ host, container, url })
  }
  // Published first: those are the ones a link opens.
  return [...ports.filter(port => port.host !== null), ...ports.filter(port => port.host === null)]
}

export function parseContainers(text: string): Container[] {
  return lines(text).map(line => {
    const [id = '', name = '', image = '', state = '', status = '', ports = '', project, service] = line.split('\t')

    return { id, name, image, state, status, ports: parsePorts(ports), project: orNull(project), service: orNull(service) }
  })
}

export function parseImages(text: string): Image[] {
  return lines(text).map(line => {
    const [id = '', repository = '', tag = '', size = '', created = '', containers = ''] = line.split('\t')
    const count = Number.parseInt(containers, 10)

    return { id, repository, tag, size, created, containers: Number.isNaN(count) ? 0 : count }
  })
}

export function parseNetworks(text: string): Network[] {
  return lines(text).map(line => {
    const [id = '', name = '', driver = '', scope = '', project] = line.split('\t')

    return { id, name, driver, scope, project: orNull(project) }
  })
}

export function parseVolumes(text: string): Volume[] {
  return lines(text).map(line => {
    const [name = '', driver = '', project] = line.split('\t')

    return { name, driver, project: orNull(project) }
  })
}

export type Group = {
  // The compose project, '' for the containers run by hand.
  key: string
  title: string
  containers: Container[]
}

// Compose projects by name, then the containers run by hand, as VS Code's tree lists them.
export function groupContainers(containers: readonly Container[]): Group[] {
  const projects = new Map<string, Container[]>()
  const single: Container[] = []
  for (const container of containers) {
    if (container.project === null) {
      single.push(container)
    } else {
      projects.set(container.project, [...(projects.get(container.project) ?? []), container])
    }
  }
  const byName = (a: Container, b: Container) => (a.service ?? a.name).localeCompare(b.service ?? b.name)
  const groups: Group[] = [...projects.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map(key => ({ key, title: key, containers: [...(projects.get(key) ?? [])].sort(byName) }))
  if (single.length > 0) {
    groups.push({ key: '', title: 'Отдельные контейнеры', containers: [...single].sort(byName) })
  }

  return groups
}

export const isRunning = (container: Container): boolean =>
  container.state === 'running' || container.state === 'restarting' || container.state === 'paused'

// `2026-10-16T05:58:30.12Z message`: Docker trims the fraction's trailing zeros, so the stamps
// are padded to nine digits before stdout and stderr are put back in one order.
const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2}) ?/

type Line = { sortKey: string; time: string; text: string }

function stamped(line: string, previous: string): Line {
  const match = STAMP.exec(line)
  if (match === null) {
    return { sortKey: previous, time: '', text: line }
  }
  const [whole, seconds = '', fraction = '', zone = ''] = match
  const sortKey = `${seconds}.${fraction.padEnd(9, '0').slice(0, 9)}${zone}`
  const date = new Date(`${seconds}${zone}`)
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = Number.isNaN(date.getTime())
    ? seconds.slice(11)
    : `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`

  return { sortKey, time, text: line.slice(whole.length) }
}

function stampAll(text: string): Line[] {
  let previous = ''

  return lines(text).map(line => {
    const next = stamped(line, previous)
    previous = next.sortKey

    return next
  })
}

// `docker logs` writes the container's stdout and stderr to its own two streams.
export function mergeLogs(stdout: string, stderr: string): string {
  const all = [...stampAll(stdout), ...stampAll(stderr)]
  // Stable: lines of one stream keep their order within the same instant.
  all.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
  const text = all
    .slice(-LOG_LINES)
    .map(line => (line.time === '' ? line.text : `${line.time}  ${line.text}`))
    .join('\n')

  return text.length > LOG_CHARS ? text.slice(-LOG_CHARS) : text
}

// A volume compose or `docker run` made without a name is a 64-character hash.
export const shortName = (name: string): string => (/^[0-9a-f]{64}$/.test(name) ? `${name.slice(0, 12)}…` : name)

// `Total reclaimed space: 1.2GB`, the last line a prune prints.
export function reclaimed(done: string, stdout: string): string {
  const match = /Total reclaimed space:\s*(\S+)/.exec(stdout)

  return match === null ? done : `${done}, освобождено ${match[1]}`
}

export const firstLine = (text: string): string => lines(text)[0] ?? ''

// What Docker says when its engine is not up, on Windows and elsewhere.
const DAEMON_DOWN = [
  'cannot connect to the docker daemon',
  'error during connect',
  'docker daemon is not running',
  'the system cannot find the file specified',
  'is the docker daemon running',
]

export function describeError(stderr: string): string {
  const text = stderr.toLowerCase()
  if (DAEMON_DOWN.some(sign => text.includes(sign))) {
    return 'Docker не запущен: запустите Docker Desktop'
  }
  if (text.includes('executable file not found') || text.includes('enoent') || text.includes('not found in path')) {
    return 'Команда docker не найдена'
  }
  // Docker prefixes its answer with `Error response from daemon: `.
  return firstLine(stderr).replace(/^Error response from daemon:\s*/i, '') || 'docker завершился с ошибкой'
}
