import { expect, test } from 'claude-code/testing'

import { formatPercent, limitLabel, limitTone, mergeLimits, resetIn, sortLimits, toMeter } from '../hooks/limits'

test('the summary adds the windows the responses omit; a reported one stays as reported', () => {
  const reported = [{ kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-15T12:15:00Z' }]
  const summary = [
    { kind: 'seven_day_fable', percentUsed: 63 },
    { kind: 'five_hour', percentUsed: 80 },
    { kind: 'seven_day', percentUsed: 41 },
    { kind: 'seven_day_omelette', percentUsed: 5 },
  ]

  expect(mergeLimits(reported, summary)).toEqual([
    { kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-15T12:15:00Z' },
    { kind: 'seven_day', percentUsed: 41 },
    { kind: 'seven_day_fable', percentUsed: 63 },
    { kind: 'seven_day_omelette', percentUsed: 5 },
  ])
})

test('the per-model weekly windows are labelled by model', () => {
  expect(limitLabel('seven_day_fable')).toBe('7д Fable')
  expect(limitLabel('seven_day_opus')).toBe('7д Opus')
  expect(limitLabel('seven_day_sonnet')).toBe('7д Sonnet')
})

test('the five-hour window leads, then the weekly ones', () => {
  const limits = sortLimits([
    { kind: 'seven_day_opus', percentUsed: 3 },
    { kind: 'seven_day', percentUsed: 41, resetsAt: '2026-10-18T10:00:00Z' },
    { kind: 'five_hour', percentUsed: 23.5 },
  ])

  expect(limits.map(limit => limit.kind)).toEqual(['five_hour', 'seven_day', 'seven_day_opus'])
  // A window with no reset time carries none, rather than an undefined field.
  expect(limits[0]).toStrictEqual({ kind: 'five_hour', percentUsed: 23.5 })
})

test('the meter keeps the windows, the five-hour one first', () => {
  expect(toMeter([{ kind: 'seven_day', percentUsed: 41 }, { kind: 'five_hour', percentUsed: 7 }])).toEqual({
    limits: [
      { kind: 'five_hour', percentUsed: 7 },
      { kind: 'seven_day', percentUsed: 41 },
    ],
  })
  expect(toMeter([])).toEqual({ limits: [] })
})

test('windows read as short labels', () => {
  expect(limitLabel('five_hour')).toBe('5ч')
  expect(limitLabel('seven_day')).toBe('7д')
  expect(limitLabel('spend_limit')).toBe('Расходы')
  expect(limitLabel('some_new_window')).toBe('some new window')
})

test('a window is green while half of it is left, then yellow, then red', () => {
  expect(limitTone(10)).toBe('success')
  expect(limitTone(50)).toBe('success')
  expect(limitTone(51)).toBe('warning')
  expect(limitTone(80)).toBe('warning')
  expect(limitTone(81)).toBe('error')
  expect(limitTone(120)).toBe('error')
  expect(formatPercent(23.5)).toBe('24%')
})

test('the reset reads as the time left until it', () => {
  const now = Date.parse('2026-10-15T10:00:00Z')

  expect(resetIn('2026-10-15T12:15:00Z', now)).toBe('2ч 15м')
  expect(resetIn('2026-10-18T14:00:00Z', now)).toBe('3д 4ч')
  expect(resetIn('2026-10-15T09:00:00Z', now)).toBeNull()
  expect(resetIn('not a date', now)).toBeNull()
  expect(resetIn(undefined, now)).toBeNull()
})
