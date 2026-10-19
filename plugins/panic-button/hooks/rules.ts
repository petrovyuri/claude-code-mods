// Which tool calls set the alarm off: plain functions over the call's input, no `$`.

export type Danger = {
  // What Claude is about to run or touch, in full.
  what: string
  // The dangerous piece of it: the one step of a chained command that set the alarm off.
  part: string
  // Why it is dangerous, in a few words.
  why: string
}

type Rule = {
  test: (command: string) => boolean
  why: string
  // A step that matches the rule but is harmless after all; the whole command is there to look up variables.
  harmless?: (step: string, command: string) => boolean
}

const has = (pattern: RegExp) => (command: string) => pattern.test(command)

// Claude's own scratchpad: `…\Temp\claude\<project>\<session>\scratchpad`, or `/tmp/claude-501/…/scratchpad`.
const SCRATCHPAD = /[\\/]te?mp[\\/]claude[^\\/]*[\\/](?:[^\\/]+[\\/])*?scratchpad(?:[\\/]|$)/i

const inScratchpad = (path: string) => SCRATCHPAD.test(path) && !/(^|[\\/])\.\.([\\/]|$)/.test(path) && !path.includes('$')

// The one quoted or bare value a variable gets in the command, or undefined when it gets none, several, or a computed one.
// Case-sensitive on purpose: in bash `$d` is not `$D`, and a miss only keeps the alarm.
const valueOf = (name: string, command: string) => {
  // The value is read in a lookahead, so a second assignment later on the line is still counted.
  const assignments = [...command.matchAll(new RegExp(`(^|[\\s;&|({])\\$?${name}\\s*(\\+?)=(?!=)\\s*(?=([^\\n]*))`, 'g'))]
  const [only] = assignments
  if (assignments.length !== 1 || only === undefined || only[2] === '+') return undefined

  const literal = /^(?:'([^']*)'|"([^"]*)"|([^\s'"`;&|(){}]+))(?=\s*(?:$|[;&|)}]))/.exec(only[3] ?? '')

  return literal?.[1] ?? literal?.[2] ?? literal?.[3]
}

// Flags and redirections between the delete command and what it deletes.
const isFlag = (token: string) => /^-/.test(token) || /^\/[a-z]$/i.test(token) || /^[\d*&]?>/.test(token)

// A recursive delete whose every target lies in the scratchpad: Claude cleaning up after itself.
const cleansScratchpad = (step: string, command: string) => {
  // Up to the brace or parenthesis that closes a PowerShell block, but `${name}` is a variable, not a brace.
  const args = /(?:^|[\s{(])(?:rm|Remove-Item|rmdir|rd|del)\s+((?:\$\{\w+\}|[^{}()])*)/i.exec(step)?.[1] ?? ''
  const tokens = (args.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(token => token.replace(/^(["'])(.*)\1$/, '$2'))

  const targets = tokens.filter(
    (token, at) => !isFlag(token) && !/^-(ErrorAction|ea)$/i.test(tokens[at - 1] ?? ''),
  )

  return (
    targets.length > 0 &&
    targets.every(target => {
      const variable = /^\$\{?(\w+)\}?(.*)$/.exec(target)
      if (variable === null) return inScratchpad(target)

      const [, name = '', rest = ''] = variable
      const value = valueOf(name, command)

      return value !== undefined && inScratchpad(value + rest)
    })
  )
}

// `DELETE FROM table` in a statement that has no WHERE wipes every row.
const deletesEverything = (command: string) =>
  command
    .split(';')
    .some(statement => /\bDELETE\s+FROM\b/i.test(statement) && !/\bWHERE\b/i.test(statement))

// `.env`, `.env.local`, `.env.production`, but not the templates kept in git
// nor `.env.enc`, which sops keeps encrypted.
const ENV_NAME = /^\.env(\.(?!example$|sample$|template$|dist$|enc$)[\w-]+)?$/i
const ENV_IN_COMMAND =
  /(^|[\s"'`/\\=<>(])\.env(\.(?!example\b|sample\b|template\b|dist\b|enc\b)[\w-]+)?(?=$|[\s"'`;|&)<>])/i

const COMMAND_RULES: readonly Rule[] = [
  // Files, except Claude cleaning up its own scratchpad.
  {
    test: has(/\brm\s+(-\w*[rR]\w*|--recursive)\b/),
    why: 'рекурсивное удаление файлов',
    harmless: cleansScratchpad,
  },
  { test: has(/\bRemove-Item\b[^\n;|]*\s-Recurse\b/i), why: 'рекурсивное удаление файлов', harmless: cleansScratchpad },
  { test: has(/\b(rd|rmdir)\b[^\n;|&]*\s\/s\b/i), why: 'рекурсивное удаление папки', harmless: cleansScratchpad },
  { test: has(/\bdel\b[^\n;|&]*\s\/s\b/i), why: 'удаление файлов во всех подпапках', harmless: cleansScratchpad },
  // Git.
  {
    test: has(/\bgit\s+push\b[^\n;|&]*(\s--force(-with-lease)?\b|\s-\w*f\w*\b|\s\+\S)/),
    why: 'перезапись истории на сервере (push --force)',
  },
  { test: has(/\bgit\s+reset\b[^\n;|&]*\s--hard\b/), why: 'сброс всех незакоммиченных изменений' },
  { test: has(/\bgit\s+clean\b[^\n;|&]*\s-\w*f/), why: 'удаление неотслеживаемых файлов' },
  { test: has(/\bgit\s+branch\b[^\n;|&]*\s(-D|--delete\s+--force|-d\s+-f)\b/), why: 'удаление ветки без проверки слияния' },
  // Databases.
  { test: has(/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i), why: 'удаление таблицы или базы данных' },
  { test: has(/\bTRUNCATE\s+(TABLE\s+)?[\w."`[]/i), why: 'очистка всей таблицы' },
  { test: deletesEverything, why: 'DELETE без WHERE удалит все строки' },
  // Secrets.
  { test: has(ENV_IN_COMMAND), why: 'доступ к секретам в .env' },
]

// Tools that read or write a file by path, and the field that names it.
const PATH_FIELDS: Record<string, string> = {
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
  Grep: 'path',
}

// The steps of a chained command: `a && b; c | d` is four.
const steps = (command: string) =>
  command
    .split(/&&|\|\||[;|\n]/)
    .map(step => step.trim())
    .filter(step => step !== '')

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

/** The danger in one tool call, or undefined when the call is harmless. */
export const findDanger = (tool: string, input: Readonly<Record<string, unknown>>): Danger | undefined => {
  const command = input.command
  if (typeof command === 'string') {
    const what = command.trim()

    const rule = COMMAND_RULES.find(one => {
      if (!one.test(command)) return false

      const matching = steps(what).filter(one.test)

      return one.harmless === undefined || matching.length === 0 || !matching.every(step => one.harmless?.(step, what))
    })

    if (rule === undefined) return undefined

    const part = steps(what).find(step => rule.test(step) && rule.harmless?.(step, what) !== true)

    return { what, part: part ?? what, why: rule.why }
  }

  const field = PATH_FIELDS[tool]
  const path = field === undefined ? undefined : input[field]
  if (typeof path === 'string' && ENV_NAME.test(baseName(path))) {
    const verb = tool === 'Read' || tool === 'Grep' ? 'чтение' : 'правка'

    const what = `${tool} ${path}`

    return { what, part: what, why: `${verb} секретов в .env` }
  }

  return undefined
}
