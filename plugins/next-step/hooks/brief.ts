import type { SessionMessage, ToolUseSummary } from 'claude-code'

import type { Brief } from '../types'

// What the model reads of the session: the cheap model needs the gist, not every byte.
export const MAX_DIGEST = 30_000
// One message, and one message with its tool calls, as the digest keeps them.
export const MAX_TEXT = 1_500
export const MAX_ENTRY = 4_000
const MAX_ARGUMENT = 160
const MAX_ERROR = 200
// Kept for the note of how many messages the digest left out.
const NOTE_ROOM = 40

// What the pane shows of the reply: a few lines and buttons, not an essay.
export const MAX_OPTIONS = 4
export const MAX_OPTION = 300
export const MAX_SUMMARY = 600

// The rules the completion runs under. Written so the reply is one JSON object: nothing to
// cut away but a fence or a sentence around it, which parseBrief skips as well.
const RULES = [
  'Ты помогаешь человеку вернуться к работе в сессии Claude Code.',
  'Тебе дана выжимка разговора человека с Claude: реплики (длинные обрезаны), вызовы инструментов (строки со стрелкой →) и план задач, если он был.',
  'Ответь одним JSON-объектом без markdown и без текста вокруг: {"status": "...", "next": "...", "options": ["...", "..."]}.',
  'status — одно-два коротких предложения: на чём остановились, что сделано последним и что осталось незавершённым.',
  'next — одно-два коротких предложения: что логично сделать дальше.',
  'options — от 2 до 4 готовых сообщений, которые человек может отправить Claude следующим шагом.',
  'Каждое — законченная просьба от лица человека, обращённая к Claude, конкретная (файлы, команды, задачи из разговора), до 200 символов.',
  'Если последняя реплика Claude — вопрос к человеку, первый вариант — ответ на этот вопрос.',
  'Пиши на языке разговора.',
].join(' ')

export type PlanItem = { content: string; status: 'pending' | 'in_progress' | 'completed' }

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max)}…`)

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

// What the engine wraps around a message: reminders and caveats are dropped whole, a slash
// command's tags give way to the text they hold.
const DROPPED = /<(system-reminder|local-command-caveat)>[\s\S]*?<\/\1>/g
const UNWRAPPED = /<\/?(command-name|command-message|command-args|local-command-stdout|local-command-stderr)>/g

export function cleanText(text: string): string {
  return text
    .replace(DROPPED, '')
    .replace(UNWRAPPED, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// The task list: Claude Code's TodoWrite, or the desktop app's update_plan.
const isPlanTool = (tool: string): boolean => tool === 'TodoWrite' || tool.endsWith('update_plan')

const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

function isPlanItem(value: unknown): value is PlanItem {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const item = value as Record<string, unknown>

  return typeof item.content === 'string' && typeof item.status === 'string' && STATUSES.includes(item.status)
}

const numbers = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((n): n is number => typeof n === 'number') : []

// One call of a plan tool over the plan so far: a whole list replaces it; update_plan's
// `advance`, `done` and `start` move it on by its 1-based step numbers.
export function applyPlanCall(plan: readonly PlanItem[], input: Record<string, unknown>): PlanItem[] {
  const list = Array.isArray(input.todos) ? input.todos : Array.isArray(input.items) ? input.items : undefined
  if (list !== undefined) {
    return list.filter(isPlanItem).map(({ content, status }) => ({ content, status }))
  }
  const next = plan.map(item => ({ ...item }))
  const set = (step: number, status: PlanItem['status']) => {
    const item = next[step - 1]
    if (item !== undefined) {
      item.status = status
    }
  }
  if (input.advance === true) {
    const current = next.findIndex(item => item.status === 'in_progress')
    if (current !== -1) {
      set(current + 1, 'completed')
    }
    const following = next.findIndex((item, index) => index > current && item.status === 'pending')
    if (following !== -1) {
      set(following + 1, 'in_progress')
    }
  }
  for (const step of numbers(input.done)) {
    set(step, 'completed')
  }
  if (typeof input.start === 'number') {
    set(input.start, 'in_progress')
  }

  return next
}

// The task list as the session last left it.
export function planOf(messages: readonly SessionMessage[]): PlanItem[] {
  let plan: PlanItem[] = []
  for (const message of messages) {
    for (const use of message.toolUses) {
      if (isPlanTool(use.tool) && use.isError !== true) {
        plan = applyPlanCall(plan, use.input)
      }
    }
  }

  return plan
}

const MARKS: Record<PlanItem['status'], string> = { completed: '[x]', in_progress: '[>]', pending: '[ ]' }

export function describePlan(plan: readonly PlanItem[]): string {
  return plan.map(item => `${MARKS[item.status]} ${oneLine(item.content)}`).join('\n')
}

// The argument that says what a call did: the command, the file, the pattern, the agent's task.
const ARGUMENTS = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'skill', 'description', 'prompt']

export function describeToolUse(use: ToolUseSummary): string {
  const key = ARGUMENTS.find(name => typeof use.input[name] === 'string' && use.input[name] !== '')
  const argument = key === undefined ? '' : ` ${cut(oneLine(String(use.input[key])), MAX_ARGUMENT)}`
  const line = `→ ${use.tool}${argument}`

  return use.isError === true ? `${line} — ошибка: ${cut(oneLine(use.text ?? ''), MAX_ERROR)}` : line
}

// One message as the digest has it: who said what, then the calls an answer made. A plan
// tool's call is left out, the plan being given whole; a user message that only carries tool
// results is nothing, its calls' errors standing beside them.
export function describeMessage(message: SessionMessage): string {
  const lines: string[] = []
  const text = cleanText(message.text)
  if (text !== '') {
    lines.push(`${message.role === 'user' ? 'Человек' : 'Claude'}: ${cut(text, MAX_TEXT)}`)
  }
  if (message.role === 'assistant') {
    for (const use of message.toolUses) {
      if (!isPlanTool(use.tool)) {
        lines.push(describeToolUse(use))
      }
    }
  }

  return cut(lines.join('\n'), MAX_ENTRY)
}

// The session in at most `max` characters: its first message, the task it began with, then
// as many of the latest as fit, with a note of how many were left out between.
export function digest(messages: readonly SessionMessage[], max = MAX_DIGEST): string {
  const entries = messages.map(describeMessage).filter(entry => entry !== '')
  const [first, ...rest] = entries
  if (first === undefined) {
    return ''
  }
  const tail: string[] = []
  let size = first.length + NOTE_ROOM
  for (let index = rest.length - 1; index >= 0; index -= 1) {
    const entry = rest[index] ?? ''
    if (size + entry.length + 2 > max) {
      break
    }
    tail.unshift(entry)
    size += entry.length + 2
  }
  const skipped = rest.length - tail.length

  return [first, ...(skipped > 0 ? [`… (пропущено сообщений: ${skipped})`] : []), ...tail].join('\n\n')
}

// The request for the model, or null when the session holds nothing to read yet.
export function briefPrompt(messages: readonly SessionMessage[]): { system: string; prompt: string } | null {
  const text = digest(messages)
  if (text === '') {
    return null
  }
  const plan = planOf(messages)
  const parts = plan.length > 0 ? [`План задач, каким его оставила сессия:\n${describePlan(plan)}`] : []
  parts.push(`Выжимка сессии, от начала к концу:\n\n${text}`)

  return { system: RULES, prompt: parts.join('\n\n') }
}

const textOf = (value: unknown, max: number): string => (typeof value === 'string' ? cut(oneLine(value), max) : '')

// The reply as the pane takes it: the JSON object in it, whatever fence or words surround
// it; null when there is none, or it says nothing.
export function parseBrief(text: string): Brief | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const reply = value as Record<string, unknown>
  const options: string[] = []
  for (const option of Array.isArray(reply.options) ? reply.options : []) {
    const line = textOf(option, MAX_OPTION)
    if (line !== '' && !options.includes(line) && options.length < MAX_OPTIONS) {
      options.push(line)
    }
  }
  const brief = { status: textOf(reply.status, MAX_SUMMARY), next: textOf(reply.next, MAX_SUMMARY), options }

  return brief.status === '' && brief.next === '' && options.length === 0 ? null : brief
}

// A reply that is no JSON is still read: its words stand as the status, with nothing to pick.
export function briefOf(text: string): Brief | null {
  const brief = parseBrief(text)
  if (brief !== null) {
    return brief
  }
  const words = cut(oneLine(text.replace(/```[^\n]*/g, '')), MAX_SUMMARY)

  return words === '' ? null : { status: words, next: '', options: [] }
}

// Why a completion came back without text: the three arms of its result that carry none.
export type NoReply = {
  reason: 'api-error' | 'empty-reply' | 'aborted'
  status?: number | null
  error?: string
}

export function describeNoReply(reply: NoReply): string {
  if (reply.reason === 'aborted') {
    return 'Модель не ответила вовремя'
  }
  if (reply.reason === 'empty-reply') {
    return 'Модель вернула пустой ответ'
  }

  return `Модель не ответила (${reply.status ?? reply.error ?? 'без ответа'})`
}

// The block of a reply the button sits under: the one the turn's final text ends with. A
// reply of several blocks (text, tool calls, text) ends with its last.
export function endsAnswer(answer: string, block: string): boolean {
  const tail = block.trim()

  return tail !== '' && answer.trim().endsWith(tail)
}

// The final text of the conversation as it stands, when its last message is Claude's: what a
// mod loaded into a resumed session has not seen a turn end with.
export function lastAnswerOf(messages: readonly SessionMessage[]): string | null {
  const last = messages.at(-1)
  if (last === undefined || last.role !== 'assistant' || last.text.trim() === '') {
    return null
  }

  return last.text
}
