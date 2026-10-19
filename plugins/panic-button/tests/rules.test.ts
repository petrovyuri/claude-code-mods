import { expect, test } from 'claude-code/testing'

import { findDanger } from '../hooks/rules'

const bash = (command: string) => findDanger('Bash', { command })

test('dangerous shell commands raise the alarm', () => {
  const dangerous = [
    'rm -rf src/',
    'rm -fr build',
    'rm -r node_modules',
    'rm --recursive dist',
    'cd app && rm -Rf .',
    'Remove-Item -Path src -Recurse -Force',
    'rmdir /s /q build',
    'del /s *.log',
    'git push --force',
    'git push origin main -f',
    'git push --force-with-lease origin feature',
    'git push origin +main',
    'git reset --hard HEAD~3',
    'git clean -fd',
    'git branch -D feature/old',
    'psql -c "DROP TABLE users;"',
    'echo "drop database prod" | mysql',
    'TRUNCATE TABLE orders',
    'sqlite3 app.db "DELETE FROM users;"',
    'cat .env',
    'type .env.local',
    'Get-Content C:\\app\\.env.production',
    'source ./.env',
  ]

  for (const command of dangerous) expect(bash(command)).toBeDefined()
})

test('ordinary commands pass quietly', () => {
  const harmless = [
    'ls -la',
    'rm file.txt',
    'rm -f old.log',
    'git push',
    'git push origin feature',
    'git reset HEAD~1',
    'git branch -d merged',
    'git status',
    'sqlite3 app.db "DELETE FROM users WHERE id = 3;"',
    'npm run lint -- --fix',
    'cp .env.example .env.example.bak',
    'cat .env.example',
    'sops -d .env.enc > /dev/null',
    "echo '- [Секреты через sops](secrets.md) — все проекты: .env.enc + модуль SopsEnv' >> MEMORY.md",
    'echo $ENVIRONMENT',
    'Remove-Item old.log',
  ]

  for (const command of harmless) expect(bash(command)).toBeUndefined()
})

test('the danger names the command and why it is dangerous', () => {
  expect(bash('  rm -rf src/  ')).toEqual({ what: 'rm -rf src/', part: 'rm -rf src/', why: 'рекурсивное удаление файлов' })
  expect(findDanger('PowerShell', { command: 'git push -f' })?.why).toBe(
    'перезапись истории на сервере (push --force)',
  )
})

test('the danger points at the dangerous step of a chained command', () => {
  expect(bash('npm ci && rm -rf dist; npm run build')?.part).toBe('rm -rf dist')
  expect(bash('cd app || exit 1\ngit push --force')?.part).toBe('git push --force')
  expect(bash('echo "drop table users" | psql')?.part).toBe('echo "drop table users"')
})

const SCRATCH =
  'C:\\Users\\dev\\AppData\\Local\\Temp\\claude\\C--Users-dev-projects-app\\1363ff91-18f6-455b-bb75-60849ca10d28\\scratchpad'
const BASH_SCRATCH = '/c/Users/dev/AppData/Local/Temp/claude/C--Users-dev-projects-app/1363ff91/scratchpad'

test('cleaning up Claude scratchpad passes quietly', () => {
  const cleanups = [
    `$env:Path += ";$HOME\\scoop\\shims;$env:LOCALAPPDATA\\Microsoft\\WinGet\\Links"\n$d = '${SCRATCH}\\cmp'; if (Test-Path $d) { Remove-Item -Recurse -Force $d }\nNew-Item -ItemType Directory $d | Out-Null`,
    `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue '${SCRATCH}\\cmp'`,
    `Remove-Item -Path "${SCRATCH}\\out\\*" -Recurse`,
    `rm -rf ${BASH_SCRATCH}/cmp`,
    `d="${BASH_SCRATCH}/cmp"; rm -rf "$d" && mkdir -p "$d"`,
    `D=${BASH_SCRATCH}; rm -rf "\${D}/build" 2>/dev/null`,
    'rm -rf /tmp/claude-501/proj/session/scratchpad/x',
    `rmdir /s /q "${SCRATCH}\\cmp"`,
  ]

  for (const command of cleanups) expect(bash(command)).toBeUndefined()
})

test('recursive deletion outside scratchpad still raises the alarm', () => {
  const dangerous = [
    `rm -rf ${BASH_SCRATCH}/../../..`,
    `rm -rf ${BASH_SCRATCH}/cmp src`,
    `rm -rf ${BASH_SCRATCH}/cmp /`,
    'rm -rf $(echo /)',
    `rm -rf ${BASH_SCRATCH}/cmp && rm -rf src`,
    `rm -rf ${BASH_SCRATCH}/cmp; git push --force`,
    'rm -rf "$d"',
    `d=${BASH_SCRATCH}; d=/c/Users/dev; rm -rf "$d"`,
    '$d = Join-Path $HOME work; Remove-Item -Recurse $d',
    `$d = '${SCRATCH}\\$name'; Remove-Item -Recurse $d`,
    'rm -rf /tmp/build',
    'rm -rf C:\\Users\\dev\\scratchpad',
    'Remove-Item -Recurse -Force .',
    // Shell expansions that turn one scratchpad path into others.
    `rm -rf ${BASH_SCRATCH}/cmp{,/../../..}`,
    `rm -rf ${BASH_SCRATCH}/cmp{~,}`,
    `d=${BASH_SCRATCH}; rm -rf "$d"{,/..}`,
    `rm -rf ${BASH_SCRATCH}/.*`,
    `rm -rf ${BASH_SCRATCH}/\`echo ..\``,
    // Extra targets hidden in one token or behind a flag.
    `$d = '${SCRATCH}\\cmp'; Remove-Item -Recurse $d,C:\\Users\\dev`,
    `Remove-Item -Recurse ${SCRATCH}\\cmp,C:\\Users\\dev`,
    `Remove-Item -Recurse -Path:C:\\Users\\dev '${SCRATCH}\\cmp'`,
    `rm -rf ${BASH_SCRATCH}/cmp /c`,
    `rm -rf ${BASH_SCRATCH}/cmp }`,
    // The variable gets its scratchpad value only after the delete.
    `rm -rf "$d"; d=${BASH_SCRATCH}/cmp`,
    // A scratchpad-looking folder that does not start the path.
    `rm -rf ./x/Temp/claude/p/s/scratchpad/cmp`,
  ]

  for (const command of dangerous) expect(bash(command)).toBeDefined()
  expect(bash(`rm -rf ${BASH_SCRATCH}/cmp; git push --force`)?.why).toBe('перезапись истории на сервере (push --force)')
  expect(bash(`rm -rf ${BASH_SCRATCH}/cmp && rm -rf src`)?.part).toBe('rm -rf src')
})

test('file tools touching .env raise the alarm, templates do not', () => {
  expect(findDanger('Read', { file_path: 'C:\\app\\.env' })).toEqual({
    what: 'Read C:\\app\\.env',
    part: 'Read C:\\app\\.env',
    why: 'чтение секретов в .env',
  })
  expect(findDanger('Edit', { file_path: '/app/.env.local', old_string: 'a', new_string: 'b' })?.why).toBe(
    'правка секретов в .env',
  )
  expect(findDanger('Write', { file_path: '.env', content: 'X=1' })).toBeDefined()
  expect(findDanger('Read', { file_path: '/app/.env.example' })).toBeUndefined()
  expect(findDanger('Read', { file_path: '/app/.env.enc' })).toBeUndefined()
  expect(findDanger('Read', { file_path: '/app/env.ts' })).toBeUndefined()
  expect(findDanger('Glob', { pattern: '**/.env' })).toBeUndefined()
})
