// Which tool calls set the alarm off: plain functions over the call's input, no `$`.

export type Danger = {
  // What Claude is about to run or touch, in full.
  what: string
  // The dangerous piece of it: the one step of a chained command that set the alarm off.
  part: string
  // Why it is dangerous, in a few words.
  why: string
}

type Rule = { test: (command: string) => boolean; why: string }

const has = (pattern: RegExp) => (command: string) => pattern.test(command)

// `DELETE FROM table` in a statement that has no WHERE wipes every row.
const deletesEverything = (command: string) =>
  command
    .split(';')
    .some(statement => /\bDELETE\s+FROM\b/i.test(statement) && !/\bWHERE\b/i.test(statement))

// `.env`, `.env.local`, `.env.production`, but not the templates kept in git.
const ENV_NAME = /^\.env(\.(?!example$|sample$|template$|dist$)[\w-]+)?$/i
const ENV_IN_COMMAND =
  /(^|[\s"'`/\\=<>(])\.env(\.(?!example\b|sample\b|template\b|dist\b)[\w-]+)?(?=$|[\s"'`;|&)<>])/i

const COMMAND_RULES: readonly Rule[] = [
  // Files.
  { test: has(/\brm\s+(-\w*[rR]\w*|--recursive)\b/), why: 'рекурсивное удаление файлов' },
  { test: has(/\bRemove-Item\b[^\n;|]*\s-Recurse\b/i), why: 'рекурсивное удаление файлов' },
  { test: has(/\b(rd|rmdir)\b[^\n;|&]*\s\/s\b/i), why: 'рекурсивное удаление папки' },
  { test: has(/\bdel\b[^\n;|&]*\s\/s\b/i), why: 'удаление файлов во всех подпапках' },
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
    const rule = COMMAND_RULES.find(one => one.test(command))

    if (rule === undefined) return undefined

    const what = command.trim()

    return { what, part: steps(what).find(rule.test) ?? what, why: rule.why }
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
