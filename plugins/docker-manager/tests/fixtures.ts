// What `docker ps -a` prints in the pane's format: ID, name, image, state, status, ports,
// compose project and service split by tabs.
export const PS_OUT = [
  ['aaa111', 'shop-db-1', 'postgres:16', 'running', 'Up 2 hours', '0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp', 'shop', 'db'],
  ['bbb222', 'shop-api-1', 'shop/api:latest', 'exited', 'Exited (137) 4 days ago', '', 'shop', 'api'],
  ['ccc333', 'redis-dev', 'redis:7', 'running', 'Up 5 minutes', '6379/tcp', '', ''],
]
  .map(fields => fields.join('\t'))
  .join('\n')
  .concat('\n')

export const IMAGES_OUT = [
  ['f74600a1a463', 'postgres', '16', '420MB', '7 days ago', '1'],
  ['eb36c1664dd9', '<none>', '<none>', '1.29GB', '10 days ago', '0'],
]
  .map(fields => fields.join('\t'))
  .join('\n')
  .concat('\n')

export const NETWORKS_OUT = [
  ['66de0734e849', 'bridge', 'bridge', 'local', ''],
  ['f323d9436ffe', 'shop_default', 'bridge', 'local', 'shop'],
]
  .map(fields => fields.join('\t'))
  .join('\n')
  .concat('\n')

export const VOLUMES_OUT = [
  ['shop_pgdata', 'local', 'shop'],
  ['0a19c68ab22e61742066a5828bd7435259923cd80131faa087dc67713f9f4d1c', 'local', ''],
]
  .map(fields => fields.join('\t'))
  .join('\n')
  .concat('\n')

// What Docker Desktop on Windows prints when its engine is not running.
export const DAEMON_DOWN =
  'error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.51/containers/json": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.\n'
