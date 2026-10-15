import type { ModelCompleteResult, On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { ALLOW, ASK_HEADER, DENY, DENY_NOTE, SUMMARY_MODEL, askText, previewText, stopText, withDetails } from '../hooks/register'

type Question = {
  question: string
  header?: string
  options: { label: string; description?: string; preview?: string }[]
}

type World = {
  ran: string[]
  // Panes the mod opened: the alarm lives in the chat dialog alone, so none.
  opens: string[]
  asked: Question[]
  // What the person picks in the dialog; undefined dismisses it.
  answer: string | undefined
  // What the cheap model says about the command; undefined: it does not answer.
  summary: string | undefined
  // The models the mod asked for a summary.
  models: string[]
}

// The engine beneath the mod: tools that only write down what ran, a dialog that answers
// what the test set, and a cheap model that says what the test set.
const engine = (on: On): World => {
  const world: World = { ran: [], opens: [], asked: [], answer: ALLOW, summary: undefined, models: [] }

  on('tool.call', async (_, e) => {
    if (e.tool === 'AskUserQuestion') {
      const questions = e.questions as unknown as Question[]
      world.asked.push(...questions)
      if (world.answer === undefined) return { deny: 'dismissed' }

      const question = questions[0]?.question ?? ''

      return { result: { questions: e.questions, answers: { [question]: world.answer } } }
    }
    world.ran.push('command' in e ? String(e.command) : e.tool)

    return { result: null, text: 'ok' }
  })
  on('ui.open', (_, e) => {
    world.opens.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('model.complete', (_, e) => {
    world.models.push(e.model)
    const reply =
      world.summary === undefined
        ? { isAnswered: false, reason: 'empty-reply' }
        : { isAnswered: true, text: world.summary, usage: { input_tokens: 1, output_tokens: 1 } }

    return { value: reply as unknown as ModelCompleteResult }
  })
  on('ui.notify', () => ({ value: { isSent: false, reason: 'disabled' } }))

  return world
}

test('a harmless command runs without the alarm', async ($, on) => {
  const world = engine(on)

  await $.tool.call({ tool: 'Bash', command: 'ls -la' })

  expect(world.ran).toEqual(['ls -la'])
  expect(world.asked).toHaveLength(0)
  expect(world.models).toHaveLength(0)
})

test('«Разрешить» lets the dangerous command run', async ($, on) => {
  const world = engine(on)

  const result = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })

  expect(result.deny).toBeUndefined()
  expect(world.ran).toEqual(['rm -rf build'])
  expect(world.asked).toHaveLength(1)
  expect(world.asked[0]).toMatchObject({
    question: '❗ Опасное действие: рекурсивное удаление файлов.\nКоманда: `rm -rf build`\nРазрешить?',
    header: ASK_HEADER,
  })
  expect(world.asked[0]?.options.map(option => option.label)).toEqual([ALLOW, DENY])
})

test('the alarm is the chat dialog alone: no pane opens', async ($, on) => {
  const world = engine(on)
  world.answer = DENY

  await $.tool.call({ tool: 'Bash', command: 'DROP TABLE users' })

  expect(world.asked).toHaveLength(1)
  expect(world.opens).toEqual([])
})

test('«Запретить» refuses the command and tells Claude not to retry', async ($, on) => {
  const world = engine(on)
  world.answer = DENY

  const result = await $.tool.call({ tool: 'Bash', command: 'git push --force' })

  expect(world.ran).toEqual([])
  expect(result.deny).toContain('пользователь остановил «git push --force»')
  expect(result.deny).toContain('Не повторяй эту команду')
})

test('a dismissed dialog or a typed answer stops the command', async ($, on) => {
  const world = engine(on)

  world.answer = undefined
  expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf src' })).deny).toBeDefined()

  world.answer = 'ну давай'
  expect((await $.tool.call({ tool: 'Read', file_path: '/app/.env' })).deny).toBeDefined()

  expect(world.ran).toEqual([])
})

test('the dialog names the command Claude wants to run, and the cheap model says what it does', async ($, on) => {
  const world = engine(on)
  world.answer = DENY
  world.summary = 'Удалит папку video/test со всеми клипами и файл x.mp4'
  const command = 'mkdir -p video/test && rm -rf video/test x.mp4'

  await $.tool.call({ tool: 'Bash', command })

  expect(world.models).toEqual([SUMMARY_MODEL])
  expect(world.asked[0]?.question).toBe(
    '❗ Опасное действие: рекурсивное удаление файлов.\n' +
      'Удалит папку video/test со всеми клипами и файл x.mp4.\n' +
      `Команда: \`${command}\`\n` +
      'Разрешить?',
  )
  expect(world.ran).toEqual([])
})

test('the dialog gets the details under its two options, other dialogs stay as they are', () => {
  const danger = { what: 'cd src && rm -rf build', part: 'rm -rf build', why: 'рекурсивное удаление файлов' }
  const ours = { question: askText(danger), header: ASK_HEADER, options: [{ label: ALLOW }, { label: DENY }] }
  const theirs = { question: 'Какой цвет?', header: 'Цвет', options: [{ label: 'Красный' }, { label: 'Синий' }] }

  const [drawn, untouched] = withDetails([ours, theirs], q => (q === ours.question ? danger : undefined)) as Question[]

  expect(drawn?.options.map(option => option.label)).toEqual([ALLOW, DENY])
  expect(drawn?.options.every(option => option.preview === previewText(danger))).toBe(true)
  expect(drawn?.options[0]).toEqual({ label: ALLOW, preview: previewText(danger) })
  expect(drawn?.options[1]?.description).toBe(DENY_NOTE)
  expect(untouched).toBe(theirs)
})

test('the texts name the command and the reason', () => {
  const danger = { what: 'cd src && rm -rf build', part: 'rm -rf build', why: 'рекурсивное удаление файлов' }

  expect(askText(danger)).toBe('❗ Опасное действие: рекурсивное удаление файлов.\nКоманда: `cd src && rm -rf build`\nРазрешить?')
  expect(askText(danger, 'Сотрёт папку build!')).toBe(
    '❗ Опасное действие: рекурсивное удаление файлов.\nСотрёт папку build!\nКоманда: `cd src && rm -rf build`\nРазрешить?',
  )
  expect(askText({ ...danger, what: 'x'.repeat(1000) }).length).toBeLessThan(400)
  expect(previewText(danger)).toContain('cd src && rm -rf build')
  expect(stopText(danger)).toContain('Не повторяй эту команду')
})
