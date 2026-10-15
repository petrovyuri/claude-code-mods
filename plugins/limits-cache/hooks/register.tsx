import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, Meter, Ttl, Warmup } from '../types'
import { drawBand } from './band'
import {
  WARM_PROMPT,
  cacheStatus,
  describeWarmup,
  isAutoExpired,
  isWarmDue,
  warmupOf,
} from './cache'
import { mergeLimits, toMeter } from './limits'
import { lastCacheUse, transcriptPath } from './transcript'
import { USAGE_MIN_GAP_MS, USAGE_POLL_MS, USAGE_URL, parseUsage } from './usage'

const TICK_MS = 1000
// The TTL read from a transcript or named by a model switch, kept for the next session.
const TTL_STORE_KEY = 'ttl'

const meter = atom({ plugin: 'limits-cache', key: 'meter' } as const, { limits: [] } as Meter)
const summary = atom({ plugin: 'limits-cache', key: 'summary' } as const, [] as Limit[])
const lastRequestAt = atom({ plugin: 'limits-cache', key: 'lastRequestAt' } as const, null as number | null)
const isWorking = atom({ plugin: 'limits-cache', key: 'isWorking' } as const, false)
// Claude Code writes the main conversation's cache for an hour on a subscription; its
// subagents and SDK sessions write it for five minutes.
const ttl = atom({ plugin: 'limits-cache', key: 'ttl' } as const, '1h' as Ttl)
// Auto is on from the session's start; turning it off, or an idle hour, holds for the session.
const isAuto = atom({ plugin: 'limits-cache', key: 'isAuto' } as const, true)
const activeAt = atom({ plugin: 'limits-cache', key: 'activeAt' } as const, null as number | null)
const isWarming = atom({ plugin: 'limits-cache', key: 'isWarming' } as const, false)
const now = atom({ plugin: 'limits-cache', key: 'now' } as const, 0)
const isHidden = atom({ plugin: 'limits-cache', key: 'isHidden' } as const, false)

// The mod's own command that brings the closed band back. The desktop app answers /usage
// itself (its settings window) and never hands it to the engine; the terminal does, so
// /usage brings the band back there too.
const SHOW_COMMAND = 'limits'
const USAGE_COMMAND = 'usage'
const HIDDEN_TOAST = 'Полоса лимитов скрыта. Чтобы вернуть её, введите /limits'

const isTtl = (value: unknown): value is Ttl => value === '5m' || value === '1h'

// Writing an unchanged value would redraw the band for nothing. Each atom is read and written
// where it is named: the engine's scan does not follow one passed as a parameter.
const changed = (before: unknown, after: unknown): boolean => JSON.stringify(before) !== JSON.stringify(after)

async function readMeter($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage()
    const next = toMeter(usage.rateLimits)
    if (changed(await read($, meter), next)) {
      await update($, meter, () => next)
    }
  } catch {
    // No figures yet: the band says so, and the next measurement fills them in.
  }
}

// When the usage summary was last asked for; a reload asks again at once.
let summaryAskedAt = Number.NEGATIVE_INFINITY

// The account's usage summary, every window it keeps. Only a subscription has one: with an
// API key, a gateway or a cloud provider the band shows what the responses reported.
async function readSummary($: EngineInterface, isDue: boolean): Promise<void> {
  const at = await $.clock.now()
  if (!isDue && at - summaryAskedAt < USAGE_MIN_GAP_MS) {
    return
  }
  summaryAskedAt = at
  try {
    const authorization = await $.session.authorize()
    if (authorization === null || authorization.kind !== 'bearer') {
      return
    }
    const response = await $.http.fetch(USAGE_URL, {
      auth: authorization.handle,
      headers: { 'anthropic-beta': 'oauth-2025-04-20' },
    })
    if (!response.ok) {
      return
    }
    const next = parseUsage(response.text)
    if (changed(await read($, summary), next)) {
      await update($, summary, () => next)
    }
  } catch {
    // The summary stays as it was; the next ask may fare better.
  }
}

// The prompt cache the band counted down belongs to a conversation that is gone.
async function forgetCache($: EngineInterface): Promise<void> {
  await update($, lastRequestAt, () => null)
}

// The session's TTL is known once a transcript or a model switch named it: a transcript read
// later does not override that.
let isTtlKnown = false

async function setTtl($: EngineInterface, next: Ttl): Promise<void> {
  isTtlKnown = true
  await update($, ttl, () => next)
  await $.store.set(TTL_STORE_KEY, next)
}

async function configDir($: EngineInterface): Promise<string | null> {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir !== undefined && dir !== '') {
    return dir
  }
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))

  return home === undefined ? null : `${home}/.claude`
}

// The session's transcript: in its working directory's project folder, or, the directory
// changed since the session began, in whichever project folder holds a file by its id.
async function findTranscript($: EngineInterface): Promise<string | null> {
  try {
    const dir = await configDir($)
    if (dir === null) {
      return null
    }
    const id = await $.session.id()
    const path = transcriptPath(dir, await $.session.cwd(), id)
    if (await $.fs.exists(path)) {
      return path
    }
    for (const entry of await $.fs.list(`${dir}/projects`)) {
      const candidate = `${dir}/projects/${entry.name}/${id}.jsonl`
      if (entry.kind === 'dir' && (await $.fs.exists(candidate))) {
        return candidate
      }
    }
  } catch {
    // No transcript to read: the countdown starts with the next answer.
  }

  return null
}

// What the mod could not see for itself: when a response used the cache before the mod
// loaded, and the TTL it was written with. A transcript past what one read takes (4 MiB)
// is left unread.
async function readTranscript($: EngineInterface, path: string | null): Promise<void> {
  if (path === null) {
    return
  }
  let text: string
  try {
    text = await $.fs.read(path)
  } catch {
    return
  }
  const { at, ttl: written } = lastCacheUse(text)
  if (at !== null) {
    const last = await read($, lastRequestAt)
    if (last === null || at > last) {
      await update($, lastRequestAt, () => at)
    }
  }
  if (written !== null && !isTtlKnown) {
    await setTtl($, written)
  }
}

// A warmup in flight: a turn.complete it may raise is not the person's activity.
let isForking = false

async function warm($: EngineInterface, trigger: 'manual' | 'auto'): Promise<void> {
  if (await read($, isWarming)) {
    return
  }
  if (await read($, isWorking)) {
    if (trigger === 'manual') {
      $.ui.toast('Claude отвечает — каждый его запрос и так обновляет кеш')
    }

    return
  }
  await update($, isWarming, () => true)
  isForking = true
  let outcome: Warmup
  try {
    const result = await $.model.fork({ prompt: WARM_PROMPT })
    outcome = warmupOf(result, await $.clock.now())
  } catch (error) {
    outcome = { kind: 'failed', at: await $.clock.now(), message: String(error) }
  } finally {
    isForking = false
  }
  if (outcome.kind === 'ok') {
    await update($, lastRequestAt, () => outcome.at)
  }
  await update($, isWarming, () => false)
  if (trigger === 'manual') {
    $.ui.toast(describeWarmup(outcome))
  } else if (outcome.kind === 'failed') {
    // Retrying every second would spend the limits on the same refusal.
    await update($, isAuto, () => false)
    $.ui.toast(`Авто-подогрев выключен. ${describeWarmup(outcome)}`)
  }
}

async function toggleAuto($: EngineInterface): Promise<void> {
  if (await read($, isAuto)) {
    await update($, isAuto, () => false)

    return
  }
  const at = await $.clock.now()
  await update($, activeAt, () => at)
  await update($, isAuto, () => true)
  const status = cacheStatus(await read($, lastRequestAt), at, await read($, ttl), await read($, isWorking))
  if (status.kind === 'empty' || status.kind === 'cold') {
    $.ui.toast('Авто включён: начнёт греть кеш после следующего ответа Claude')
  }
}

// ✕ takes the band away whole, and says how to bring it back.
async function close($: EngineInterface): Promise<void> {
  await update($, isHidden, () => true)
  $.ui.toast(HIDDEN_TOAST)
}

async function tick($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  // The countdowns move only while there is something to count.
  const hasClock =
    (await read($, lastRequestAt)) !== null ||
    (await read($, meter)).limits.some(limit => limit.resetsAt !== undefined) ||
    (await read($, summary)).some(limit => limit.resetsAt !== undefined)
  if (hasClock) {
    await update($, now, () => at)
  }
  if (!(await read($, isAuto))) {
    return
  }
  const working = await read($, isWorking)
  if (!working && isAutoExpired(await read($, activeAt), at)) {
    await update($, isAuto, () => false)
    $.ui.toast('Авто-подогрев выключен: час без активности в сессии')

    return
  }
  const isDue = isWarmDue({
    isAuto: true,
    isWarming: await read($, isWarming),
    isWorking: working,
    lastRequestAt: await read($, lastRequestAt),
    now: at,
    ttl: await read($, ttl),
  })
  if (isDue) {
    await warm($, 'auto')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: SHOW_COMMAND,
      description: 'Показать полосу лимитов и кеша над полем ввода',
      immediate: true,
    })
    // State outlives a reload of the mod; a warmup or turn it cut short never ends.
    await update($, isWarming, () => false)
    await update($, isWorking, () => false)
    const stored = await $.store.get(TTL_STORE_KEY)
    if (isTtl(stored)) {
      await update($, ttl, () => stored)
    }
    // Loaded mid-session, the mod has seen no answer yet: the transcript has.
    await readTranscript($, await findTranscript($))
    await readMeter($)
    // Auto on by default counts its idle hour from the start, as a press would.
    if ((await read($, isAuto)) && (await read($, activeAt)) === null) {
      const at = await $.clock.now()
      await update($, activeAt, () => at)
    }
    await tick($)
    $.clock.every(TICK_MS, () => void tick($))
    // The summary is a network call: asked for off the start, which it must not hold up.
    $.clock.after(0, () => void readSummary($, true))
    $.clock.every(USAGE_POLL_MS, () => void readSummary($, true))

    return next(e)
  })

  // The status line's figures, pushed after each turn and as a rate-limit window moves.
  on('session.measure', async ($, e, next) => {
    const nextMeter = toMeter(e.rateLimits)
    if (changed(await read($, meter), nextMeter)) {
      await update($, meter, () => nextMeter)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, isWorking, () => true)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's loop has a prompt of its own; the band counts the main conversation's.
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      await update($, isWorking, () => false)
      if (!isForking) {
        await update($, activeAt, () => at)
      }
      // A turn that made no request (an interrupt before the first reply) used no cache.
      if (e.usage !== undefined) {
        await update($, lastRequestAt, () => at)
      }
      // A turn spent some of the limits: the summary is asked again, no more than its gap.
      $.clock.after(0, () => void readSummary($, false))
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await forgetCache($)
    }

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'compact' || e.source === 'clear') {
      // The next request caches a conversation the old entry does not open.
      await forgetCache($)
    } else if (e.seconds_since_last_response !== undefined) {
      // A resumed conversation: its cache was last used when its last answer came.
      const at = (await $.clock.now()) - e.seconds_since_last_response * 1000
      await update($, lastRequestAt, () => at)
      await readTranscript($, e.transcript_path)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // A new session's first answer is the first that shows which TTL its cache is written with.
  on('classic.Stop', async ($, e, next) => {
    if (!isTtlKnown) {
      await readTranscript($, e.transcript_path)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // A switch names the session's TTL, and leaves the new model with nothing cached.
  on('classic.PostModelSwitch', async ($, e, next) => {
    await setTtl($, e.cache_ttl)
    await forgetCache($)

    return next(e)
  }).catch(($, e, next) => next(e))

  // /limits shows the band the person closed. The app's own limits button shows them
  // without the engine: nothing reaches a hook.
  on('command.run', { command: SHOW_COMMAND }, async $ => {
    if (!(await read($, isHidden))) {
      return { text: 'Полоса лимитов уже на месте' }
    }
    await update($, isHidden, () => false)

    return { text: 'Полоса лимитов снова над полем ввода' }
  })

  // Where /usage reaches the engine (the terminal), it shows the band too and runs as it
  // always does.
  on('command.run', { command: USAGE_COMMAND }, async ($, e, next) => {
    if (await read($, isHidden)) {
      await update($, isHidden, () => false)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The surveys draw in the same band and take it while they ask. The band is raised on the
    // terminal and the desktop only. Closed with ✕, it leaves the band to the engine.
    if (
      e.props.hasSurvey ||
      (e.surface !== 'terminal' && e.surface !== 'desktop') ||
      (await read($, isHidden))
    ) {
      return next(e)
    }
    const view = {
      meter: { limits: mergeLimits((await read($, meter)).limits, await read($, summary)) },
      lastRequestAt: await read($, lastRequestAt),
      isWorking: e.props.isWorking,
      ttl: await read($, ttl),
      isAuto: await read($, isAuto),
      isWarming: await read($, isWarming),
      now: await read($, now),
    }

    return drawBand($.ui.resolve(e), e.surface, view, {
      close: () => void close($),
      warm: () => void warm($, 'manual'),
      toggleAuto: () => void toggleAuto($),
    })
  })
}
