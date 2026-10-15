import { expect, test } from 'claude-code/testing'

import { lastCacheUse, projectFolder, transcriptPath } from '../hooks/transcript'
import { assistantLine, userLine } from './fixtures'

test('a project folder is its working directory with every other character a dash', () => {
  expect(projectFolder('C:\\Users\\dev\\mods_claude\\.claude\\worktrees\\mod-x')).toBe(
    'C--Users-dev-mods-claude--claude-worktrees-mod-x',
  )
  expect(transcriptPath('C:\\Users\\dev/.claude', '/home/dev/app', 'abc')).toBe(
    'C:\\Users\\dev/.claude/projects/-home-dev-app/abc.jsonl',
  )
})

test('the last response says when the cache was used, the last write says its TTL', () => {
  const text = [
    assistantLine('2026-10-15T10:00:00.000Z', { h1: 3000 }),
    userLine('2026-10-15T10:01:00.000Z'),
    // A pure hit writes nothing, so it tells no TTL: the earlier write does.
    assistantLine('2026-10-15T10:02:00.000Z', {}),
    '',
  ].join('\n')

  expect(lastCacheUse(text)).toEqual({ at: Date.parse('2026-10-15T10:02:00.000Z'), ttl: '1h' })
})

test('a session written for five minutes reads as 5m', () => {
  expect(lastCacheUse(assistantLine('2026-10-15T10:00:00.000Z', { m5: 900 })).ttl).toBe('5m')
})

test('subagents, the engine’s own errors and broken lines are not the conversation’s responses', () => {
  const text = [
    assistantLine('2026-10-15T10:00:00.000Z', { h1: 3000 }),
    assistantLine('2026-10-15T10:05:00.000Z', { m5: 500 }, { isSidechain: true }),
    assistantLine('2026-10-15T10:06:00.000Z', {}, { message: { model: '<synthetic>', usage: {} } }),
    '{"type":"assistant","usage": broken',
  ].join('\n')

  expect(lastCacheUse(text)).toEqual({ at: Date.parse('2026-10-15T10:00:00.000Z'), ttl: '1h' })
})

test('a transcript with no response yet says nothing', () => {
  expect(lastCacheUse(userLine('2026-10-15T10:00:00.000Z'))).toEqual({ at: null, ttl: null })
  expect(lastCacheUse('')).toEqual({ at: null, ttl: null })
})
