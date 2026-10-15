import { expect, test } from 'claude-code/testing'

import { BAR_WIDTH, barCells, barSvg, spinnerFrame, spinnerSvg, toneOfRemaining } from '../hooks/bar'

test('green while half is left, yellow down to a fifth, red below', () => {
  expect(toneOfRemaining(1)).toBe('success')
  expect(toneOfRemaining(0.5)).toBe('success')
  expect(toneOfRemaining(0.49)).toBe('warning')
  expect(toneOfRemaining(0.2)).toBe('warning')
  expect(toneOfRemaining(0.19)).toBe('error')
  expect(toneOfRemaining(0)).toBe('error')
})

test('the terminal bar fills a cell per tenth', () => {
  expect(barCells(0)).toEqual({ filled: '', track: '░░░░░░░░░░' })
  expect(barCells(0.42)).toEqual({ filled: '████', track: '░░░░░░' })
  expect(barCells(1)).toEqual({ filled: '██████████', track: '' })
  expect(barCells(1.3)).toEqual({ filled: '██████████', track: '' })
  expect(barCells(-0.2)).toEqual({ filled: '', track: '░░░░░░░░░░' })
})

test('the desktop bar is a rounded track with the fill in its tone', () => {
  const half = barSvg(0.5, 'warning')

  expect(half).toContain(`<rect width="${BAR_WIDTH / 2}" height="6" fill="#d29922"/>`)
  expect(half).toContain('clip-path="url(#track)"')
  expect(barSvg(1, 'success')).toContain(`<rect width="${BAR_WIDTH}" height="6" fill="#3fb950"/>`)
  expect(barSvg(0, 'error')).toContain('<rect width="0" height="6" fill="#f85149"/>')
})

test('a shorter bar fills its own width', () => {
  const short = barSvg(0.5, 'success', 48)

  expect(short).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="6" viewBox="0 0 48 6">')
  expect(short).toContain('<rect width="24" height="6" fill="#3fb950"/>')
})

test('the desktop spinner is an arc that turns once a second', () => {
  const spinner = spinnerSvg()

  expect(spinner).toContain('width="12" height="12"')
  expect(spinner).toContain('stroke="#3fb950"')
  expect(spinner).toContain('<animateTransform attributeName="transform" type="rotate" from="0 6 6" to="360 6 6" dur="1s"')
})

test('the terminal spinner turns a quarter each second', () => {
  expect([0, 1000, 2000, 3000, 4000, 4999].map(spinnerFrame)).toEqual(['◐', '◓', '◑', '◒', '◐', '◐'])
})
