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

// Claude's own scratchpad at the start of an absolute path: `C:\…\Temp\claude\<project>\<session>\scratchpad`,
// `/c/…/Temp/claude/…/scratchpad` in Git Bash, or `/tmp/claude-501/…/scratchpad`.
const SCRATCHPAD = /^(?:[a-z]:)?[\\/](?:[^\\/]+[\\/])*?te?mp[\\/]claude[^\\/]*[\\/](?:[^\\/]+[\\/])*?scratchpad(?:[\\/]|$)/i

// Letters, digits and plain punctuation only: nothing the shell expands into other paths
// (braces, commas, backticks, `~`, `$`, brackets), no second path glued on, and no whitespace,
// where bash splits an unquoted `$d` into several targets.
const PLAIN_PATH = /^[\p{L}\p{N}_.:\\/*?@+-]+$/u

const inScratchpad = (path: string) =>
  PLAIN_PATH.test(path) &&
  path.indexOf(':', 2) === -1 &&
  SCRATCHPAD.test(path) &&
  // No way up and no glob that could match `..`.
  !path.split(/[\\/]/).some(segment => segment.startsWith('..') || /^\.[^\\/]*[*?]/.test(segment))

// The one quoted or bare value a variable gets before the delete, or undefined when it gets none, several, or a computed one.
// Case-sensitive on purpose: in bash `$d` is not `$D`, and a miss only keeps the alarm.
const valueOf = (name: string, before: string, command: string) => {
  // A changed IFS splits even a path without spaces.
  if (/\bIFS\b/.test(command)) return undefined

  // The value is read in a lookahead, so a second assignment later on the line is still counted.
  const assignments = [...before.matchAll(new RegExp(`(^|[\\s;&|({])(\\$?)${name}\\s*(\\+?)=(?!=)\\s*(?=([^\\n]*))`, 'g'))]
  const [only] = assignments
  if (assignments.length !== 1 || only === undefined || only[3] === '+') return undefined

  // Besides `$d` and `${d}`, the bare name may appear only in the bash assignment `d=` itself.
  // Any other mention is another way to set it: `for d in`, `read d`, `printf -v d`, `Set-Variable d`.
  const bare = [...command.matchAll(new RegExp(`(?<!\\$\\{?)\\b${name}\\b`, 'g'))].length
  if (bare !== (only[2] === '$' ? 0 : 1)) return undefined

  // Every `$d` but the PowerShell assignment only reads the variable: no `foreach ($d in`,
  // `$d, $e = …`, `$d++`, `$d[0] =` or `[ref]$d`.
  const assignedAt = only.index + (only[1]?.length ?? 0)
  const writes = [...command.matchAll(new RegExp(`\\$(?:\\{${name}\\}|${name}\\b)`, 'g'))].some(use => {
    if (only[2] === '$' && use.index === assignedAt) return false

    const left = command.slice(0, use.index).trimEnd()
    const right = command.slice(use.index + use[0].length).trimStart()

    return /[,\]]$/.test(left) || /^(,|[-+*/%.]?=(?!=)|\+\+|--|in\b|\[|\.)/i.test(right)
  })
  if (writes) return undefined

  const literal = /^(?:'([^']*)'|"([^"]*)"|([^\s'"`;&|(){}]+))(?=\s*(?:$|[;&|)}]))/.exec(only[4] ?? '')

  return literal?.[1] ?? literal?.[2] ?? literal?.[3]
}

// Flags and redirections between the delete command and what it deletes. A flag with a value glued on
// (`-Path:C:\x`) is a target, and `/s`-style flags exist only for cmd's `rd` and `del`: in Git Bash `/c` is drive C.
const isFlag = (token: string, verb: string) =>
  /^--?([a-z][\w-]*)?$/i.test(token) ||
  (/^(rd|rmdir|del)$/i.test(verb) && /^\/[a-z]$/i.test(token)) ||
  /^[\d*&]?>/.test(token)

// A recursive delete whose every target lies in the scratchpad: Claude cleaning up after itself.
const cleansScratchpad = (step: string, command: string) => {
  const found = /(^|[\s{(])(rm|Remove-Item|rmdir|rd|del)\s+(.*)$/is.exec(step)
  if (found === null) return false

  const [, , verb = '', args = ''] = found
  // A lone `}` closes the PowerShell block the delete sits in, as in `if (…) { Remove-Item … $d }`.
  const inBlock = step.slice(0, found.index + 1).includes('{')
  const tokens = (args.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(token => token.replace(/^(["'])(.*)\1$/, '$2'))

  const targets = tokens.filter(
    (token, at) =>
      !isFlag(token, verb) && !/^-(ErrorAction|ea)$/i.test(tokens[at - 1] ?? '') && !(inBlock && token === '}'),
  )

  const before = command.slice(0, Math.max(command.indexOf(step), 0))

  return (
    targets.length > 0 &&
    targets.every(target => {
      const variable = /^\$(?:\{(\w+)\}|(\w+))(.*)$/.exec(target)
      if (variable === null) return inScratchpad(target)

      const [, braced, bare, rest = ''] = variable
      const value = valueOf(braced ?? bare ?? '', before, command)

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
