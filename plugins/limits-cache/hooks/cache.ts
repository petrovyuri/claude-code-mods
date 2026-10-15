import type { ModelForkResult } from 'claude-code'

import type { Ttl, Warmup } from '../types'

export const TTL_MS: Record<Ttl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

// Auto warms this long before the cache would lapse. The countdown starts when a turn ends,
// while the entry's TTL ran from its last request's start: the lead covers that reply too.
export const LEAD_MS: Record<Ttl, number> = { '5m': 60_000, '1h': 3 * 60_000 }

// Every warmup reads the whole context and counts against the limits: Auto gives up after
// an hour in which nobody used the session.
export const AUTO_IDLE_MS = 60 * 60_000

// The one message the warmup's fork answers. It never reaches the transcript.
export const WARM_PROMPT = 'Prompt cache keep-alive. Reply with the single word: ok'

export type CacheStatus =
  | { kind: 'empty' }
  | { kind: 'working' }
  | { kind: 'warm'; leftMs: number }
  | { kind: 'cold'; agoMs: number }

export function cacheStatus(lastRequestAt: number | null, now: number, ttl: Ttl, isWorking: boolean): CacheStatus {
  if (isWorking) {
    return { kind: 'working' }
  }
  if (lastRequestAt === null) {
    return { kind: 'empty' }
  }
  const leftMs = lastRequestAt + TTL_MS[ttl] - now

  return leftMs > 0 ? { kind: 'warm', leftMs } : { kind: 'cold', agoMs: -leftMs }
}

// How much of the cache's life is left, 0 to 1: full while a turn refreshes it.
export function lifeLeft(status: CacheStatus, ttl: Ttl): number {
  switch (status.kind) {
    case 'working':
      return 1
    case 'warm':
      return Math.min(1, status.leftMs / TTL_MS[ttl])
    case 'empty':
    case 'cold':
      return 0
  }
}

export type AutoState = {
  isAuto: boolean
  isWarming: boolean
  isWorking: boolean
  lastRequestAt: number | null
  now: number
  ttl: Ttl
}

// Auto keeps a warm cache warm: a cache already gone costs a full write either way, and the
// next prompt pays it as well as a warmup would.
export function isWarmDue(state: AutoState): boolean {
  const status = cacheStatus(state.lastRequestAt, state.now, state.ttl, state.isWorking)

  return state.isAuto && !state.isWarming && status.kind === 'warm' && status.leftMs <= LEAD_MS[state.ttl]
}

export function isAutoExpired(activeAt: number | null, now: number): boolean {
  return activeAt !== null && now - activeAt >= AUTO_IDLE_MS
}

// A fork that reached the API used the cache whether or not its reply had words in it.
export function warmupOf(result: ModelForkResult, at: number): Warmup {
  if (result.isAnswered || result.reason === 'empty-reply') {
    return {
      kind: 'ok',
      at,
      read: result.usage.cache_read_input_tokens,
      write: result.usage.cache_creation_input_tokens,
    }
  }
  switch (result.reason) {
    case 'nothing-to-fork':
      return { kind: 'failed', at, message: 'в сессии ещё не было ответа Claude' }
    case 'aborted':
      return { kind: 'failed', at, message: 'запрос прерван' }
    case 'api-error':
      return {
        kind: 'failed',
        at,
        message: result.status === null ? `ошибка API: ${result.error}` : `ошибка API ${result.status}: ${result.error}`,
      }
  }
}

export function describeWarmup(warmup: Warmup): string {
  if (warmup.kind === 'failed') {
    return `Подогрев не удался: ${warmup.message}`
  }
  // Nothing read and something written: the entry had lapsed, and the fork cached it anew.
  if (warmup.read === 0 && warmup.write > 0) {
    return `Кеш уже остыл — записан заново: ${formatTokens(warmup.write)} токенов`
  }

  return `Кеш подогрет: ${formatTokens(warmup.read)} токенов из кеша`
}

export function formatTokens(count: number): string {
  if (count < 1000) {
    return String(count)
  }
  if (count < 1_000_000) {
    return `${Math.round(count / 1000)}k`
  }

  return `${(count / 1_000_000).toFixed(1)}M`
}

// What is left of the cache's life, to the minute begun: `59м`, `1ч`, `1ч 05м`. A cache
// still alive never reads `0м`: its last minute reads `1м`.
export function formatLeft(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) {
    return `${minutes}м`
  }
  const hours = Math.floor(minutes / 60)

  return minutes % 60 === 0 ? `${hours}ч` : `${hours}ч ${String(minutes % 60).padStart(2, '0')}м`
}

// A span in the past or the future, to the minute: `12м`, `2ч 15м`, `3д 4ч`.
export function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 60) {
    return `${minutes}м`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return minutes % 60 === 0 ? `${hours}ч` : `${hours}ч ${minutes % 60}м`
  }
  const days = Math.floor(hours / 24)

  return hours % 24 === 0 ? `${days}д` : `${days}д ${hours % 24}ч`
}
