import { describe, expect, test } from 'claude-code/testing'

import {
  MAX_ENTRY,
  MAX_OPTION,
  MAX_OPTIONS,
  MAX_TEXT,
  type PlanItem,
  applyPlanCall,
  briefOf,
  briefPrompt,
  cleanText,
  describeMessage,
  describeNoReply,
  describePlan,
  endsAnswer,
  describeToolUse,
  digest,
  lastAnswerOf,
  parseBrief,
  planOf,
} from '../hooks/brief'
import { REPLY, SESSION, claude, use, user } from './fixtures'

describe('cleanText', () => {
  test('a reminder the engine added is dropped whole', () => {
    expect(cleanText('Почини тест<system-reminder>\nправила\n</system-reminder>')).toBe('Почини тест')
  })

  test("a slash command's tags give way to the text they hold", () => {
    expect(cleanText('<command-name>/review</command-name>\n<command-args>main</command-args>')).toBe(
      '/review\n main',
    )
  })

  test('the caveat of a local command is dropped', () => {
    expect(cleanText('<local-command-caveat>Caveat: …</local-command-caveat>ok')).toBe('ok')
  })
})

describe('describeToolUse', () => {
  test('the argument that says what the call did', () => {
    expect(describeToolUse(use('Bash', { command: 'git status', description: 'Show status' }))).toBe(
      '→ Bash git status',
    )
    expect(describeToolUse(use('Edit', { file_path: 'src/app.ts', old_string: 'a' }))).toBe('→ Edit src/app.ts')
    expect(describeToolUse(use('Agent', { description: 'Find the config', prompt: 'long' }))).toBe(
      '→ Agent Find the config',
    )
  })

  test('a call with none of them is its tool alone', () => {
    expect(describeToolUse(use('ExitPlanMode', {}))).toBe('→ ExitPlanMode')
  })

  test('a failed call carries its error', () => {
    expect(describeToolUse(use('Bash', { command: 'npm test' }, { text: '3 failed\nmore', isError: true }))).toBe(
      '→ Bash npm test — ошибка: 3 failed more',
    )
  })

  test('a long argument is cut to one line', () => {
    const line = describeToolUse(use('Bash', { command: `echo ${'x'.repeat(400)}\nls` }))

    expect(line.length).toBeLessThan(200)
    expect(line.endsWith('…')).toBe(true)
    expect(line).not.toContain('\n')
  })
})

describe('the plan', () => {
  const ITEMS: PlanItem[] = [
    { content: 'A', status: 'completed' },
    { content: 'B', status: 'in_progress' },
    { content: 'C', status: 'pending' },
  ]
  const PLAN = { items: ITEMS }

  test('a whole list replaces the plan', () => {
    expect(applyPlanCall([], PLAN)).toEqual(PLAN.items)
    expect(applyPlanCall(applyPlanCall([], PLAN), { todos: [{ content: 'D', status: 'pending', activeForm: 'D' }] })).toEqual(
      [{ content: 'D', status: 'pending' }],
    )
  })

  test('advance completes the step under way and starts the next', () => {
    expect(applyPlanCall(ITEMS, { advance: true }).map(item => item.status)).toEqual([
      'completed',
      'completed',
      'in_progress',
    ])
  })

  test('advance with nothing under way starts the first pending step', () => {
    const plan = applyPlanCall([], { items: [{ content: 'A', status: 'pending' }, { content: 'B', status: 'pending' }] })

    expect(applyPlanCall(plan, { advance: true }).map(item => item.status)).toEqual(['in_progress', 'pending'])
  })

  test('done and start name steps by their 1-based numbers', () => {
    expect(applyPlanCall(ITEMS, { done: [2, 3] }).map(item => item.status)).toEqual([
      'completed',
      'completed',
      'completed',
    ])
    expect(applyPlanCall(ITEMS, { done: [2], start: 3 }).map(item => item.status)).toEqual([
      'completed',
      'completed',
      'in_progress',
    ])
  })

  test('the session leaves the plan as its calls moved it; a refused call moves nothing', () => {
    const messages = [
      ...SESSION,
      claude('', [use('mcp__ccd_turn__update_plan', { advance: true }, { text: 'denied', isError: true })]),
    ]

    expect(planOf(messages)).toEqual([
      { content: 'Сверстать экран настроек', status: 'completed' },
      { content: 'Переключатель темы', status: 'in_progress' },
      { content: 'Тесты', status: 'pending' },
    ])
  })

  test('a session without a plan has none', () => {
    expect(planOf([user('привет'), claude('привет')])).toEqual([])
  })

  test('drawn one step to a line', () => {
    expect(describePlan(planOf(SESSION))).toBe('[x] Сверстать экран настроек\n[>] Переключатель темы\n[ ] Тесты')
  })
})

describe('describeMessage', () => {
  test('who said what, then the calls an answer made, the plan calls left out', () => {
    expect(describeMessage(SESSION[1]!)).toBe('Claude: Составлю план и начну.\n→ Write lib/settings/settings_screen.dart')
  })

  test('a message that only carries tool results is nothing', () => {
    expect(describeMessage({ role: 'user', text: '', toolUses: [], toolResults: [] })).toBe('')
  })

  test('a long message is cut', () => {
    const entry = describeMessage(user('y'.repeat(MAX_TEXT * 3)))

    expect(entry.length).toBeLessThanOrEqual(MAX_TEXT + 'Человек: …'.length)
  })

  test('an answer of many calls is held to the entry cap', () => {
    const calls = Array.from({ length: 200 }, (_, index) => use('Read', { file_path: `src/file-${index}.ts` }))

    expect(describeMessage(claude('читаю', calls)).length).toBeLessThanOrEqual(MAX_ENTRY + 1)
  })
})

describe('digest', () => {
  test('an empty session is nothing', () => {
    expect(digest([])).toBe('')
    expect(digest([{ role: 'user', text: '', toolUses: [] }])).toBe('')
  })

  test('the whole session while it fits', () => {
    const text = digest(SESSION)

    expect(text).toStartWith('Человек: Добавь в приложение экран настроек с тёмной темой')
    expect(text).toContain('→ Bash flutter test — ошибка: 2 tests failed')
    expect(text).toEndWith('Claude: Тесты темы падают. Хранить выбор темы в shared_preferences или в Hive?')
    expect(text).not.toContain('пропущено')
  })

  test('past the cap: the first message, a note, then the latest that fit', () => {
    const messages = [user('задача'), ...Array.from({ length: 20 }, (_, index) => claude(`шаг ${index} ${'z'.repeat(80)}`))]
    const text = digest(messages, 500)

    expect(text.length).toBeLessThanOrEqual(500)
    expect(text).toStartWith('Человек: задача\n\n… (пропущено сообщений: ')
    expect(text).toContain('шаг 19')
    expect(text).not.toContain('шаг 0 ')
  })
})

describe('briefPrompt', () => {
  test('nothing to read is no request', () => {
    expect(briefPrompt([])).toBeNull()
  })

  test('the plan and the digest, under rules that ask for JSON', () => {
    const request = briefPrompt(SESSION)

    expect(request?.prompt).toStartWith('План задач, каким его оставила сессия:\n[x] Сверстать экран настроек')
    expect(request?.prompt).toContain('Выжимка сессии, от начала к концу:')
    expect(request?.prompt).toContain('Хранить выбор темы')
    expect(request?.system).toContain('JSON')
    expect(request?.system).toContain('"options"')
    // A question Claude asked is answered by the first option.
    expect(request?.system).toContain('вопрос')
  })

  test('a session without a plan names none', () => {
    expect(briefPrompt([user('привет')])?.prompt).not.toContain('План задач')
  })
})

describe('parseBrief', () => {
  test('a reply that follows the rules', () => {
    expect(parseBrief(REPLY)).toEqual({
      status: 'Экран настроек готов, переключатель темы в работе; два теста падают.',
      next: 'Выбрать хранилище для темы и починить тесты.',
      options: ['Храни тему в shared_preferences', 'Почини падающие тесты темы', 'Покажи, что сделано по плану'],
    })
  })

  test('a fence or words around the object are skipped', () => {
    expect(parseBrief('```json\n' + REPLY + '\n```')?.options).toHaveLength(3)
    expect(parseBrief(`Вот ответ:\n${REPLY}\nУдачи!`)?.next).toBe('Выбрать хранилище для темы и починить тесты.')
  })

  test('options are strings, one line each, without repeats, at most four', () => {
    const brief = parseBrief(
      JSON.stringify({
        status: 's',
        next: 'n',
        options: ['a\nb', 'a b', 7, '', 'c', 'd', 'e', 'f'],
      }),
    )

    expect(brief?.options).toEqual(['a b', 'c', 'd', 'e'])
    expect(brief?.options.length).toBeLessThanOrEqual(MAX_OPTIONS)
  })

  test('a long option is cut', () => {
    const brief = parseBrief(JSON.stringify({ status: 's', next: 'n', options: ['o'.repeat(MAX_OPTION * 2)] }))

    expect(brief?.options[0]?.length).toBe(MAX_OPTION + 1)
  })

  test('no object, a broken one or an empty one is no brief', () => {
    expect(parseBrief('Не знаю')).toBeNull()
    expect(parseBrief('{"status": "a",')).toBeNull()
    expect(parseBrief('{"status": "", "options": []}')).toBeNull()
    expect(parseBrief('[1, 2]')).toBeNull()
  })
})

describe('briefOf', () => {
  test('a reply that is no JSON stands as the status, with nothing to pick', () => {
    expect(briefOf('Вы остановились на тестах.\nДальше — починить их.')).toEqual({
      status: 'Вы остановились на тестах. Дальше — починить их.',
      next: '',
      options: [],
    })
  })

  test('an empty reply is no brief', () => {
    expect(briefOf('  \n```\n```')).toBeNull()
  })
})

describe('describeNoReply', () => {
  test('each reason reads as its own sentence', () => {
    expect(describeNoReply({ reason: 'aborted' })).toBe('Модель не ответила вовремя')
    expect(describeNoReply({ reason: 'empty-reply' })).toBe('Модель вернула пустой ответ')
    expect(describeNoReply({ reason: 'api-error', status: 429, error: 'rate_limit' })).toBe('Модель не ответила (429)')
    expect(describeNoReply({ reason: 'api-error', status: null, error: 'overloaded' })).toBe(
      'Модель не ответила (overloaded)',
    )
  })
})

describe('endsAnswer', () => {
  test('the block the answer ends with, spaces aside', () => {
    expect(endsAnswer('Смотрю.\n\nГотово.\n', '  Готово.')).toBe(true)
  })

  test('an earlier block, or an empty one, is not it', () => {
    expect(endsAnswer('Смотрю.\n\nГотово.', 'Смотрю.')).toBe(false)
    expect(endsAnswer('Готово.', '  ')).toBe(false)
  })
})

describe('lastAnswerOf', () => {
  test("the text of Claude's last message", () => {
    expect(lastAnswerOf(SESSION)).toBe('Тесты темы падают. Хранить выбор темы в shared_preferences или в Hive?')
  })

  test('none while the last word is the person’s, or Claude said nothing', () => {
    expect(lastAnswerOf([...SESSION, user('дальше')])).toBeNull()
    expect(lastAnswerOf([user('привет'), claude('', [use('Read', { file_path: 'a.ts' })])])).toBeNull()
    expect(lastAnswerOf([])).toBeNull()
  })
})
