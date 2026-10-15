export type Tone = 'success' | 'warning' | 'error'

// Green while half or more is left, yellow down to a fifth, red below it.
export function toneOfRemaining(fraction: number): Tone {
  if (fraction >= 0.5) {
    return 'success'
  }

  return fraction >= 0.2 ? 'warning' : 'error'
}

const clamp = (fraction: number): number => Math.min(1, Math.max(0, fraction))

// The terminal's bar: a cell per tenth, the filled ones drawn in the tone, the rest a track.
export function barCells(fraction: number, cells = 10): { filled: string; track: string } {
  const filled = Math.round(clamp(fraction) * cells)

  return { filled: '█'.repeat(filled), track: '░'.repeat(cells - filled) }
}

export const BAR_WIDTH = 40
export const BAR_HEIGHT = 6

// Colors that read on the desktop's light and dark themes alike.
const COLORS: Record<Tone, string> = { success: '#3fb950', warning: '#d29922', error: '#f85149' }
const TRACK = '#8b949e'

// The desktop's bar: a rounded track and the fill clipped to it, so a short fill keeps
// the track's round end instead of turning into a dot.
export function barSvg(fraction: number, tone: Tone, width = BAR_WIDTH): string {
  const fill = Math.round(clamp(fraction) * width)
  const size = `width="${width}" height="${BAR_HEIGHT}"`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${width} ${BAR_HEIGHT}">` +
    `<clipPath id="track"><rect ${size} rx="${BAR_HEIGHT / 2}"/></clipPath>` +
    `<g clip-path="url(#track)">` +
    `<rect ${size} fill="${TRACK}" fill-opacity="0.3"/>` +
    `<rect width="${fill}" height="${BAR_HEIGHT}" fill="${COLORS[tone]}"/>` +
    `</g></svg>`
  )
}

export const SPINNER_SIZE = 12

// The desktop's spinner: a quarter arc turning once a second over a faint ring.
export function spinnerSvg(): string {
  const center = SPINNER_SIZE / 2
  const radius = center - 1.5

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SPINNER_SIZE}" height="${SPINNER_SIZE}" ` +
    `viewBox="0 0 ${SPINNER_SIZE} ${SPINNER_SIZE}" fill="none" stroke-width="1.5">` +
    `<circle cx="${center}" cy="${center}" r="${radius}" stroke="${TRACK}" stroke-opacity="0.3"/>` +
    `<path d="M${center} ${center - radius}A${radius} ${radius} 0 0 1 ${center + radius} ${center}" ` +
    `stroke="${COLORS.success}" stroke-linecap="round">` +
    `<animateTransform attributeName="transform" type="rotate" ` +
    `from="0 ${center} ${center}" to="360 ${center} ${center}" dur="1s" repeatCount="indefinite"/>` +
    `</path></svg>`
  )
}

// The terminal's spinner: a quarter-filled circle, turned a quarter each second the band redraws.
const FRAMES = ['◐', '◓', '◑', '◒']

export function spinnerFrame(now: number): string {
  return FRAMES[Math.floor(now / 1000) % FRAMES.length] ?? '◐'
}
