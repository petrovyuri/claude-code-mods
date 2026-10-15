import { expect, test } from 'claude-code/testing'

import { parseUsage } from '../hooks/usage'

test('the summary keeps every window the account has, with its reset', () => {
  const text = JSON.stringify({
    five_hour: { utilization: 12, resets_at: '2026-10-15T12:15:00Z' },
    seven_day: { utilization: 41.5, resets_at: '2026-10-18T14:00:00Z' },
    seven_day_opus: null,
    seven_day_fable: { utilization: 63, resets_at: null },
  })

  expect(parseUsage(text)).toEqual([
    { kind: 'five_hour', percentUsed: 12, resetsAt: '2026-10-15T12:15:00Z' },
    { kind: 'seven_day', percentUsed: 41.5, resetsAt: '2026-10-18T14:00:00Z' },
    { kind: 'seven_day_fable', percentUsed: 63 },
  ])
})

test('a model the server names in its rows is a window of its own, the week across all models is not twice', () => {
  const text = JSON.stringify({
    five_hour: { utilization: 27, resets_at: '2026-10-15T10:50:00Z' },
    seven_day: { utilization: 26, resets_at: '2026-10-21T07:00:00Z' },
    seven_day_opus: null,
    extra_usage: { is_enabled: true, monthly_limit: 100, used_credits: 5, utilization: 5 },
    limits: [
      { kind: 'session', group: 'session', percent: 27, resets_at: '2026-10-15T10:50:00Z', scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 26, resets_at: '2026-10-21T07:00:00Z' },
      { kind: 'model', group: 'weekly', percent: 0, resets_at: '2026-10-21T07:00:00Z', scope: { model: { display_name: 'Fable' } } },
      { kind: 'model', group: 'weekly', percent: 12, scope: { model: { display_name: 'Opus' } } },
      { kind: 'surface', group: 'monthly', percent: 40, scope: { surface: { display_name: 'Claude Design' } } },
      { kind: 'broken', group: 'weekly', percent: 'high', scope: { model: { display_name: 'Haiku' } } },
    ],
  })

  expect(parseUsage(text)).toEqual([
    { kind: 'five_hour', percentUsed: 27, resetsAt: '2026-10-15T10:50:00Z' },
    { kind: 'seven_day', percentUsed: 26, resetsAt: '2026-10-21T07:00:00Z' },
    { kind: 'seven_day_fable', label: '7д Fable', percentUsed: 0, resetsAt: '2026-10-21T07:00:00Z' },
    { kind: 'seven_day_opus', label: '7д Opus', percentUsed: 12 },
    { kind: 'monthly_claude_design', label: 'Claude Design', percentUsed: 40 },
  ])
})

test('a model listed both at the top and in the rows shows once, as the top lists it', () => {
  const text = JSON.stringify({
    seven_day_opus: { utilization: 30, resets_at: null },
    limits: [{ kind: 'model', group: 'weekly', percent: 31, scope: { model: { display_name: 'Opus' } } }],
  })

  expect(parseUsage(text)).toEqual([{ kind: 'seven_day_opus', percentUsed: 30 }])
})

test('anything but windows with a number is left out', () => {
  expect(parseUsage('not json')).toEqual([])
  expect(parseUsage('[1, 2]')).toEqual([])
  expect(parseUsage('null')).toEqual([])
  expect(
    parseUsage(JSON.stringify({ extra_usage: { is_enabled: false }, five_hour: { utilization: 'high' }, note: 'x' })),
  ).toEqual([])
})
