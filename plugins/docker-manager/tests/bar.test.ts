import { describe, expect, test } from 'claude-code/testing'

import { barCells, runLabel, usedBy } from '../hooks/pane'

describe('barCells', () => {
  test('one cell a container, the running ones filled', () => {
    expect(barCells(1, 1)).toEqual({ filled: 1, width: 1 })
    expect(barCells(2, 3)).toEqual({ filled: 2, width: 3 })
    expect(barCells(0, 6)).toEqual({ filled: 0, width: 6 })
    expect(barCells(6, 6)).toEqual({ filled: 6, width: 6 })
    expect(barCells(0, 0)).toEqual({ filled: 0, width: 0 })
  })

  test('a group past twenty keeps twenty cells, never drawn empty or full while partly running', () => {
    expect(barCells(20, 20)).toEqual({ filled: 20, width: 20 })
    expect(barCells(15, 30)).toEqual({ filled: 10, width: 20 })
    expect(barCells(1, 100)).toEqual({ filled: 1, width: 20 })
    expect(barCells(99, 100)).toEqual({ filled: 19, width: 20 })
    expect(barCells(0, 100)).toEqual({ filled: 0, width: 20 })
  })
})

describe('runLabel', () => {
  test('only a part-running group has a word beside its bar', () => {
    expect(runLabel(0, 2)).toBe('')
    expect(runLabel(1, 2)).toBe('частично')
    expect(runLabel(2, 2)).toBe('')
  })
})

describe('usedBy', () => {
  test('says how many containers hold an image, in the right case', () => {
    expect(usedBy(1)).toBe('1 контейнер исп.')
    expect(usedBy(2)).toBe('2 контейнера исп.')
    expect(usedBy(4)).toBe('4 контейнера исп.')
    expect(usedBy(5)).toBe('5 контейнеров исп.')
    expect(usedBy(11)).toBe('11 контейнеров исп.')
    expect(usedBy(12)).toBe('12 контейнеров исп.')
    expect(usedBy(21)).toBe('21 контейнер исп.')
    expect(usedBy(22)).toBe('22 контейнера исп.')
  })
})
