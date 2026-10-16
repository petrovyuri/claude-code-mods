import { describe, expect, test } from 'claude-code/testing'

import {
  composeDownArgv,
  describeError,
  groupContainers,
  imageRef,
  mergeLogs,
  parseContainers,
  parseImages,
  parseNetworks,
  parsePorts,
  parseVolumes,
  reclaimed,
  shortName,
} from '../hooks/docker'
import { DAEMON_DOWN, IMAGES_OUT, NETWORKS_OUT, PS_OUT, VOLUMES_OUT } from './fixtures'

describe('parsePorts', () => {
  test('a port published on IPv4 and IPv6 is listed once, with a link', () => {
    expect(parsePorts('0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp')).toEqual([
      { host: '5432', container: '5432/tcp', url: 'http://localhost:5432' },
    ])
  })

  test('an exposed port has no host side and no link, and goes after the published ones', () => {
    expect(parsePorts('6379/tcp, 127.0.0.1:3400->3000/tcp')).toEqual([
      { host: '3400', container: '3000/tcp', url: 'http://localhost:3400' },
      { host: null, container: '6379/tcp', url: null },
    ])
  })

  test('a UDP port gets no browser link', () => {
    expect(parsePorts('0.0.0.0:53->53/udp')).toEqual([{ host: '53', container: '53/udp', url: null }])
  })

  test('no ports', () => {
    expect(parsePorts('')).toEqual([])
  })
})

test('parseContainers reads the compose labels, empty for a container run by hand', () => {
  const [db, , redis] = parseContainers(PS_OUT)
  expect(db).toMatchObject({ id: 'aaa111', name: 'shop-db-1', state: 'running', project: 'shop', service: 'db' })
  expect(db?.ports).toHaveLength(1)
  expect(redis).toMatchObject({ name: 'redis-dev', project: null, service: null })
})

test('parseContainers tolerates Windows line ends', () => {
  expect(parseContainers(PS_OUT.replace(/\n/g, '\r\n'))).toHaveLength(3)
})

test('groupContainers puts projects first by name, the hand-run ones last', () => {
  const groups = groupContainers(parseContainers(PS_OUT))
  expect(groups.map(g => g.title)).toEqual(['shop', 'Отдельные контейнеры'])
  // Services sorted by name: api before db.
  expect(groups[0]?.containers.map(c => c.service)).toEqual(['api', 'db'])
  expect(groups[1]?.key).toBe('')
})

test('parseImages, parseNetworks and parseVolumes', () => {
  expect(parseImages(IMAGES_OUT)[0]).toEqual({
    id: 'f74600a1a463',
    repository: 'postgres',
    tag: '16',
    size: '420MB',
    created: '7 days ago',
    containers: 1,
  })
  expect(parseNetworks(NETWORKS_OUT)[1]).toMatchObject({ name: 'shop_default', project: 'shop' })
  expect(parseVolumes(VOLUMES_OUT)[0]).toEqual({ name: 'shop_pgdata', driver: 'local', project: 'shop' })
})

test('imageRef names a tagged image, the ID of a dangling one', () => {
  const [tagged, dangling] = parseImages(IMAGES_OUT)
  expect(tagged && imageRef(tagged)).toBe('postgres:16')
  expect(dangling && imageRef(dangling)).toBe('eb36c1664dd9')
})

test('mergeLogs interleaves stdout and stderr by time, though Docker trims the fraction', () => {
  const stdout = '2026-10-16T05:58:30.1234Z first\n2026-10-16T05:58:31Z third\n'
  // .12345 is later than .1234, though it sorts first as text.
  const stderr = '2026-10-16T05:58:30.12345Z second\n'
  const text = mergeLogs(stdout, stderr)
  const order = text.split('\n').map(line => line.replace(/^\d\d:\d\d:\d\d {2}/, ''))
  expect(order).toEqual(['first', 'second', 'third'])
})

test('mergeLogs keeps a line without a stamp after the one before it', () => {
  expect(mergeLogs('2026-10-16T05:58:30Z a\n  at frame\n', '').split('\n')[1]).toBe('  at frame')
})

test('mergeLogs keeps the last 300 lines', () => {
  const stdout = Array.from({ length: 350 }, (_, i) => `2026-10-16T05:58:30.${String(i).padStart(3, '0')}Z line ${i}`).join('\n')
  const lines = mergeLogs(stdout, '').split('\n')
  expect(lines).toHaveLength(300)
  expect(lines[299]?.endsWith('line 349')).toBe(true)
})

describe('describeError', () => {
  test('Docker Desktop not running', () => {
    expect(describeError(DAEMON_DOWN)).toBe('Docker не запущен: запустите Docker Desktop')
  })

  test('the daemon prefix is cut', () => {
    expect(describeError('Error response from daemon: conflict: unable to remove repository reference\n')).toBe(
      'conflict: unable to remove repository reference',
    )
  })

  test('no docker on PATH', () => {
    expect(describeError('Error: spawn docker ENOENT')).toBe('Команда docker не найдена')
  })
})

test('reclaimed adds what a prune freed', () => {
  expect(reclaimed('Образы очищены', 'Deleted Images:\nsha256:abc\n\nTotal reclaimed space: 1.2GB\n')).toBe(
    'Образы очищены, освобождено 1.2GB',
  )
  expect(reclaimed('Образы очищены', '')).toBe('Образы очищены')
})

test('shortName cuts an anonymous volume hash', () => {
  expect(shortName('0a19c68ab22e61742066a5828bd7435259923cd80131faa087dc67713f9f4d1c')).toBe('0a19c68ab22e…')
  expect(shortName('shop_pgdata')).toBe('shop_pgdata')
})

test('composeDownArgv finds the project by name', () => {
  expect(composeDownArgv('shop')).toEqual(['docker', 'compose', '-p', 'shop', 'down'])
})
