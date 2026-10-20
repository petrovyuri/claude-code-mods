import { describe, expect, test } from 'claude-code/testing'

import { barCells, runLabel } from '../hooks/pane'

describe('barCells', () => {
  test('nothing running leaves the bar empty, all running fills it', () => {
    expect(barCells(0, 3)).toBe(0)
    expect(barCells(3, 3)).toBe(10)
    expect(barCells(0, 0)).toBe(0)
  })

  test('a partly running group is never drawn empty or full', () => {
    expect(barCells(1, 2)).toBe(5)
    expect(barCells(1, 100)).toBe(1)
    expect(barCells(99, 100)).toBe(9)
  })
})

describe('runLabel', () => {
  test('names the state beside the bar', () => {
    expect(runLabel(0, 2)).toBe('остановлен')
    expect(runLabel(1, 2)).toBe('частично')
    expect(runLabel(2, 2)).toBe('запущен')
  })
})
