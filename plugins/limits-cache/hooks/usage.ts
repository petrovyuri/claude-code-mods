import type { Limit } from '../types'

// The account's usage summary, the one /usage reads: every window the server keeps, the
// per-model weekly ones too, where a response's headers carry only the windows it touched.
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

// The summary is asked for after a turn at most this often, and every so often while idle.
export const USAGE_MIN_GAP_MS = 2 * 60_000
export const USAGE_POLL_MS = 10 * 60_000

type Window = { utilization?: unknown; resets_at?: unknown }

type Named = { display_name?: unknown } | null | undefined

// One of the summary's `limits` rows: a window the server names itself, `Fable` for a model.
type Row = {
  group?: unknown
  percent?: unknown
  resets_at?: unknown
  scope?: { model?: Named; surface?: Named } | null
}

// Top-level keys of the summary that are no window: the month's extra usage, and the rows.
const NOT_WINDOWS = new Set(['extra_usage', 'limits'])

const isPercent = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '_')

// A row of a model or a product: weekly ones keyed as the top-level weekly windows are, so a
// window the summary lists both ways shows once. The account's own rows (the five hours, the
// week across all models) have no scope; their windows are the top-level ones.
function rowLimit(row: unknown): Limit | null {
  if (typeof row !== 'object' || row === null) {
    return null
  }
  const { group, percent, resets_at: resetsAt, scope } = row as Row
  const name = scope?.model?.display_name ?? scope?.surface?.display_name
  if (typeof name !== 'string' || name === '' || !isPercent(percent)) {
    return null
  }
  const isWeekly = group === 'weekly'
  const limit: Limit = {
    kind: `${isWeekly ? 'seven_day' : slug(String(group))}_${slug(name)}`,
    label: isWeekly ? `7д ${name}` : name,
    percentUsed: percent,
  }

  return typeof resetsAt === 'string' ? { ...limit, resetsAt } : limit
}

// `{ five_hour: { utilization: 12, resets_at: "…" }, seven_day_opus: null, …, limits: [ … ] }`:
// a window the account has none of is null, and is left out.
export function parseUsage(text: string): Limit[] {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return []
  }
  const limits: Limit[] = []
  for (const [kind, window] of Object.entries(body)) {
    if (NOT_WINDOWS.has(kind) || typeof window !== 'object' || window === null) {
      continue
    }
    const { utilization, resets_at: resetsAt } = window as Window
    if (!isPercent(utilization)) {
      continue
    }
    limits.push(typeof resetsAt === 'string' ? { kind, percentUsed: utilization, resetsAt } : { kind, percentUsed: utilization })
  }
  const rows = (body as { limits?: unknown }).limits
  for (const row of Array.isArray(rows) ? rows : []) {
    const limit = rowLimit(row)
    if (limit !== null && !limits.some(known => known.kind === limit.kind)) {
      limits.push(limit)
    }
  }

  return limits
}
