import type { Elements } from 'claude-code'

import type { Limit, Meter, Ttl } from '../types'
import {
  BAR_HEIGHT,
  BAR_WIDTH,
  SPINNER_SIZE,
  barCells,
  barSvg,
  spinnerFrame,
  spinnerSvg,
  toneOfRemaining,
  type Tone,
} from './bar'
import { cacheStatus, formatLeft, lifeLeft, type CacheStatus } from './cache'
import { formatPercent, limitLabel, limitTone, resetIn } from './limits'

// The band is raised on the terminal and in the desktop app. The terminal's table lists an
// Svg too, which draws nothing there: the surface, not the table, says which bar to draw.
export type BandSurface = 'terminal' | 'desktop'
type Table = Elements[BandSurface]
type El = Pick<Table, 'Box' | 'Text'>

export type BandView = {
  meter: Meter
  lastRequestAt: number | null
  isWorking: boolean
  ttl: Ttl
  isAuto: boolean
  isWarming: boolean
  now: number
}

// The controls: close the band, warm the cache now, and Auto on or off. The TTL is the
// session's own, read from its transcript; nothing in the band picks it.
export type BandActions = {
  close: () => void
  warm: () => void
  toggleAuto: () => void
}

// Warm the cache now: the clockwise open-circle arrow, a restart.
export const WARM_GLYPH = '↻'

type Status = { text: string; tone: Tone | null }

export function statusOf(status: CacheStatus, ttl: Ttl): Status {
  switch (status.kind) {
    case 'empty':
      return { text: 'пусто, ответов ещё не было', tone: null }
    // Drawn as a spinner beside a full bar; the words are what a reader that cannot see it hears.
    case 'working':
      return { text: 'идёт ответ', tone: 'success' }
    case 'warm':
      return { text: formatLeft(status.leftMs), tone: toneOfRemaining(lifeLeft(status, ttl)) }
    // How long ago it lapsed says nothing a red bar does not: a resumed session's can be weeks.
    case 'cold':
      return { text: 'остыл', tone: 'error' }
  }
}

// A Text takes no key: the keyed Box around it gives the text its address. One with no tone
// is drawn dim.
function toned({ Box, Text }: El, key: string, { text, tone }: Status) {
  return <Box key={key}>{tone === null ? <Text dimColor>{text}</Text> : <Text color={tone}>{text}</Text>}</Box>
}

type Draw = { table: Table; surface: BandSurface }

// A bar's length: CSS pixels on the desktop, cells on the terminal.
type BarSize = { px: number; cells: number }

// The cache's bar is the band's main one; the limits' are shorter, so the line holds them all.
const CACHE_BAR: BarSize = { px: BAR_WIDTH, cells: 5 }
const LIMIT_BAR: BarSize = { px: 36, cells: 5 }

// A progress bar filled to `fraction` in the tone: cells on the terminal, an Svg on the desktop.
function drawBar({ table, surface }: Draw, key: string, size: BarSize, fraction: number, tone: Tone, alt: string) {
  const { Box, Text } = table
  if (surface === 'desktop' && 'Svg' in table) {
    const { Svg } = table

    return (
      <Box key={key} alignItems="center">
        <Svg source={barSvg(fraction, tone, size.px)} alt={alt} width={size.px} height={BAR_HEIGHT} />
      </Box>
    )
  }
  const { filled, track } = barCells(fraction, size.cells)

  return (
    <Box key={key}>
      {filled !== '' && <Text color={tone}>{filled}</Text>}
      {track !== '' && <Text dimColor>{track}</Text>}
    </Box>
  )
}

// While a turn runs, a spinner: turning on the desktop, a frame a second on the terminal.
function drawSpinner({ table, surface }: Draw, key: string, now: number, alt: string) {
  const { Box, Text } = table
  if (surface === 'desktop' && 'Svg' in table) {
    const { Svg } = table

    // An Svg drawn as an image does not animate: the interactive frame plays its SMIL.
    return (
      <Box key={key} alignItems="center">
        <Svg source={spinnerSvg()} alt={alt} width={SPINNER_SIZE} height={SPINNER_SIZE} isInteractive />
      </Box>
    )
  }

  return (
    <Box key={key}>
      <Text color="success">{spinnerFrame(now)}</Text>
    </Box>
  )
}

// A window's reset is written once: one that resets with the window before it (a model's
// weekly window with the week across all models) leaves it out.
function drawLimit(draw: Draw, limit: Limit, now: number, before: Limit | undefined) {
  const { Box, Text } = draw.table
  const label = limitLabel(limit.kind, limit.label)
  const percent = formatPercent(limit.percentUsed)
  const tone = limitTone(limit.percentUsed)
  const reset = resetIn(limit.resetsAt, now)
  const isRepeated = before !== undefined && reset !== null && resetIn(before.resetsAt, now) === reset

  return (
    <Box key={`limit:${limit.kind}`} gap={1} alignItems="center" flexShrink={0}>
      <Text dimColor>{label}</Text>
      {drawBar(draw, `bar:${limit.kind}`, LIMIT_BAR, limit.percentUsed / 100, tone, `${label}: использовано ${percent}`)}
      {toned(draw.table, `percent:${limit.kind}`, { text: percent, tone })}
      {reset !== null && !isRepeated && <Text dimColor>{`↻ ${reset}`}</Text>}
    </Box>
  )
}

// One line: ✕ that closes the band and the limits on the left; at the right end a divider,
// the cache, and its two controls beside it. A line too long for the band cuts the limits,
// never ✕, the cache or the controls.
export function drawBand(table: Table, surface: BandSurface, view: BandView, actions: BandActions) {
  const { Box, Text, Button } = table
  const draw = { table, surface }
  const status = cacheStatus(view.lastRequestAt, view.now, view.ttl, view.isWorking)
  const statusText = statusOf(status, view.ttl)
  // A warmup needs a response to fork from, and is pointless while a turn refreshes the cache.
  const canWarm = !view.isWarming && !view.isWorking && view.lastRequestAt !== null

  return (
    <Box key="band" flexDirection="row" flexWrap="nowrap" columnGap={1} alignItems="center">
      <Box key="close" flexShrink={0} alignItems="center">
        <Button key="close-button" label="✕" plain dimColor onPress={actions.close} />
      </Box>
      <Box
        key="limits"
        flexDirection="row"
        flexWrap="nowrap"
        flexGrow={1}
        flexShrink={1}
        minWidth={0}
        overflow="hidden"
        columnGap={2}
        alignItems="center"
      >
        {view.meter.limits.length === 0
          ? toned(table, 'no-limits', { text: 'Лимиты: нет данных', tone: null })
          : view.meter.limits.map((limit, index) => drawLimit(draw, limit, view.now, view.meter.limits[index - 1]))}
      </Box>
      <Box key="divider" flexShrink={0} paddingX={1}>
        <Text dimColor>│</Text>
      </Box>
      <Box key="cache" gap={1} alignItems="center" flexShrink={0}>
        <Text dimColor>Кеш</Text>
        {status.kind !== 'empty' &&
          drawBar(
            draw,
            'cache-bar',
            CACHE_BAR,
            // A lapsed cache is a full red bar, not an empty one.
            status.kind === 'cold' ? 1 : lifeLeft(status, view.ttl),
            statusText.tone ?? 'error',
            `Жизнь кеша: ${statusText.text}`,
          )}
        {status.kind === 'working'
          ? drawSpinner(draw, 'cache-spinner', view.now, `Кеш: ${statusText.text}`)
          : toned(table, 'cache-status', statusText)}
      </Box>
      <Box key="controls" gap={1} alignItems="center" flexShrink={0}>
        {/* A text glyph, not an emoji: it takes the button's own font and color. */}
        <Button key="warm" label={view.isWarming ? '⏳' : WARM_GLYPH} plain dimColor={!canWarm} onPress={actions.warm} />
        {view.isAuto ? (
          <Button key="auto" label="Авто" variant="primary" dimColor={false} onPress={actions.toggleAuto} />
        ) : (
          // Off, Auto is grey through and through: the button dim and its label the theme's
          // inactive grey, so it does not read as a control that is on.
          <Button key="auto" label="Авто" variant="secondary" dimColor onPress={actions.toggleAuto}>
            <Text color="inactive" dimColor>
              Авто
            </Text>
          </Button>
        )}
      </Box>
    </Box>
  )
}
