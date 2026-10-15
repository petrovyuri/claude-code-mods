import type { SessionRateLimit } from 'claude-code'

import type { Limit, Meter } from '../types'
import { type Tone, toneOfRemaining } from './bar'
import { formatSpan } from './cache'

const LABELS: Record<string, string> = {
  five_hour: '5ч',
  seven_day: '7д',
  seven_day_opus: '7д Opus',
  seven_day_sonnet: '7д Sonnet',
  seven_day_fable: '7д Fable',
  spend_limit: 'Расходы',
}

// The shorter window first: it is the one that runs out within a session. The per-model
// weekly windows follow the account's own, any other the server keeps after them.
const ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_fable']

export function toMeter(rateLimits: readonly SessionRateLimit[]): Meter {
  return { limits: sortLimits(rateLimits) }
}

// The windows the last response reported, and those only the usage summary has: a window
// in both is the response's reading, the newer of the two.
export function mergeLimits(reported: readonly Limit[], summary: readonly Limit[]): Limit[] {
  const kinds = new Set(reported.map(limit => limit.kind))

  return sortLimits([...reported, ...summary.filter(limit => !kinds.has(limit.kind))])
}

export function sortLimits(rateLimits: readonly (SessionRateLimit | Limit)[]): Limit[] {
  const rank = (kind: string) => (ORDER.includes(kind) ? ORDER.indexOf(kind) : ORDER.length)

  return rateLimits
    .map(({ kind, percentUsed, resetsAt, ...rest }) => ({
      kind,
      percentUsed,
      ...(resetsAt === undefined ? {} : { resetsAt }),
      ...('label' in rest && rest.label !== undefined ? { label: rest.label } : {}),
    }))
    .sort((a, b) => rank(a.kind) - rank(b.kind))
}

// The window's own name where the server gave one, else the short name for its kind.
export function limitLabel(kind: string, label?: string): string {
  return label ?? LABELS[kind] ?? kind.replace(/_/g, ' ')
}

// The bar fills as the window is used; its color says how much of it is left.
export function limitTone(percentUsed: number): Tone {
  return toneOfRemaining((100 - percentUsed) / 100)
}

export function formatPercent(percentUsed: number): string {
  return `${Math.round(percentUsed)}%`
}

// How long until the window resets; null when the API gave no time or it already passed.
export function resetIn(resetsAt: string | undefined, now: number): string | null {
  if (resetsAt === undefined) {
    return null
  }
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at) || at <= now) {
    return null
  }

  return formatSpan(at - now)
}
