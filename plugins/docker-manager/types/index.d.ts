// A port the container publishes on the host, or one it only exposes.
export type Port = {
  // `5432`, null when the port is not published.
  host: string | null
  // `5432/tcp`
  container: string
  // Where a published TCP port opens in a browser.
  url: string | null
}

export type Container = {
  id: string
  name: string
  image: string
  // Docker's state: running, exited, paused, restarting, created, dead, removing.
  state: string
  // Docker's own line: `Up 2 hours`, `Exited (137) 4 days ago`.
  status: string
  ports: Port[]
  // The compose project and service the container belongs to, null for one run by hand.
  project: string | null
  service: string | null
}

export type Image = {
  id: string
  repository: string
  tag: string
  size: string
  // `7 days ago`
  created: string
  // How many containers use it.
  containers: number
}

export type Network = {
  id: string
  name: string
  driver: string
  scope: string
  project: string | null
}

export type Volume = {
  name: string
  driver: string
  project: string | null
}

export type ListState<T> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'list'; items: T[] }

export type PaneTab = 'containers' | 'images' | 'networks' | 'volumes'

export type Notice = { text: string; isError: boolean }

export type Logs =
  | { kind: 'loading'; id: string; name: string }
  | { kind: 'error'; id: string; name: string; message: string }
  | { kind: 'text'; id: string; name: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'docker-manager': {
      tab: PaneTab
      containers: ListState<Container>
      images: ListState<Image>
      networks: ListState<Network>
      volumes: ListState<Volume>
      // The groups shown open: a compose project's name, '' for the containers run by hand.
      expanded: string[]
      // The container whose actions are shown under its row.
      selected: string | null
      logs: Logs | null
      // What waits for a second press: `rm:<id>`, `down:<project>`, `rmi:<id>`, ...
      confirm: string | null
      // The action running now, as the progress line reads it.
      busy: string | null
      notice: Notice | null
    }
  }
}
