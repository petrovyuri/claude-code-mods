import { expect, test } from 'claude-code/testing'

import {
  AUTO_IDLE_MS,
  LEAD_MS,
  TTL_MS,
  cacheStatus,
  describeWarmup,
  formatLeft,
  formatSpan,
  formatTokens,
  isAutoExpired,
  isWarmDue,
  warmupOf,
} from '../hooks/cache'

const USAGE = { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 84_000, cache_creation_input_tokens: 0 }

test('the cache is warm until its TTL passes, then cold', () => {
  expect(cacheStatus(null, 10_000, '5m', false)).toEqual({ kind: 'empty' })
  expect(cacheStatus(0, 60_000, '5m', false)).toEqual({ kind: 'warm', leftMs: 4 * 60_000 })
  expect(cacheStatus(0, TTL_MS['5m'] + 30_000, '5m', false)).toEqual({ kind: 'cold', agoMs: 30_000 })
  // The same moment under the hour-long TTL is still warm.
  expect(cacheStatus(0, TTL_MS['5m'] + 30_000, '1h', false).kind).toBe('warm')
  // While a turn runs each request refreshes it, whatever the clock says.
  expect(cacheStatus(0, TTL_MS['1h'] * 2, '5m', true)).toEqual({ kind: 'working' })
})

test('Auto warms only a warm cache, and only once it is close to lapsing', () => {
  const state = { isAuto: true, isWarming: false, isWorking: false, lastRequestAt: 0, ttl: '5m' as const }
  const dueAt = TTL_MS['5m'] - LEAD_MS['5m']

  expect(isWarmDue({ ...state, now: dueAt - 1000 })).toBe(false)
  expect(isWarmDue({ ...state, now: dueAt })).toBe(true)
  expect(isWarmDue({ ...state, now: TTL_MS['5m'] })).toBe(false)
  expect(isWarmDue({ ...state, now: dueAt, isAuto: false })).toBe(false)
  expect(isWarmDue({ ...state, now: dueAt, isWarming: true })).toBe(false)
  expect(isWarmDue({ ...state, now: dueAt, isWorking: true })).toBe(false)
  expect(isWarmDue({ ...state, now: dueAt, lastRequestAt: null })).toBe(false)
  expect(isWarmDue({ ...state, ttl: '1h', now: dueAt })).toBe(false)
  expect(isWarmDue({ ...state, ttl: '1h', now: TTL_MS['1h'] - LEAD_MS['1h'] })).toBe(true)
})

test('Auto expires an hour after the last activity', () => {
  expect(isAutoExpired(null, AUTO_IDLE_MS * 5)).toBe(false)
  expect(isAutoExpired(1000, 1000 + AUTO_IDLE_MS - 1)).toBe(false)
  expect(isAutoExpired(1000, 1000 + AUTO_IDLE_MS)).toBe(true)
})

test('a fork that reached the API counts as a warmup, whatever its words', () => {
  expect(warmupOf({ isAnswered: true, text: 'ok', usage: USAGE }, 5)).toEqual({ kind: 'ok', at: 5, read: 84_000, write: 0 })
  expect(warmupOf({ isAnswered: false, reason: 'empty-reply', usage: USAGE }, 5)).toEqual({
    kind: 'ok',
    at: 5,
    read: 84_000,
    write: 0,
  })
  expect(warmupOf({ isAnswered: false, reason: 'nothing-to-fork' }, 5)).toEqual({
    kind: 'failed',
    at: 5,
    message: 'в сессии ещё не было ответа Claude',
  })
  expect(
    warmupOf({ isAnswered: false, reason: 'api-error', status: 429, error: 'rate_limit', usage: USAGE }, 5),
  ).toEqual({ kind: 'failed', at: 5, message: 'ошибка API 429: rate_limit' })
  expect(
    warmupOf({ isAnswered: false, reason: 'api-error', status: null, error: 'unknown', usage: USAGE }, 5),
  ).toEqual({ kind: 'failed', at: 5, message: 'ошибка API: unknown' })
})

test('the warmup says whether it read the cache or had to write it anew', () => {
  expect(describeWarmup({ kind: 'ok', at: 0, read: 84_000, write: 120 })).toBe('Кеш подогрет: 84k токенов из кеша')
  expect(describeWarmup({ kind: 'ok', at: 0, read: 0, write: 84_000 })).toBe(
    'Кеш уже остыл — записан заново: 84k токенов',
  )
  expect(describeWarmup({ kind: 'failed', at: 0, message: 'запрос прерван' })).toBe(
    'Подогрев не удался: запрос прерван',
  )
})

test('tokens, countdowns and spans read short', () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(84_321)).toBe('84k')
  expect(formatTokens(1_250_000)).toBe('1.3M')
  expect(formatLeft(245_000)).toBe('5м')
  // 59 minutes and some seconds is the sixtieth minute begun: an hour.
  expect(formatLeft(59 * 60_000 + 10_000)).toBe('1ч')
  expect(formatLeft(58 * 60_000 + 53_000)).toBe('59м')
  expect(formatLeft(400)).toBe('1м')
  expect(formatLeft(-5)).toBe('1м')
  expect(formatLeft(TTL_MS['1h'])).toBe('1ч')
  expect(formatLeft(TTL_MS['1h'] + 5 * 60_000)).toBe('1ч 05м')
  expect(formatSpan(12 * 60_000)).toBe('12м')
  expect(formatSpan(135 * 60_000)).toBe('2ч 15м')
  expect(formatSpan(120 * 60_000)).toBe('2ч')
  expect(formatSpan((3 * 24 + 4) * 3600_000)).toBe('3д 4ч')
  expect(formatSpan(2 * 24 * 3600_000)).toBe('2д')
})
