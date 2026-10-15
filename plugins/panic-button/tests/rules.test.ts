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
  expect(findDanger('Read', { file_path: '/app/env.ts' })).toBeUndefined()
  expect(findDanger('Glob', { pattern: '**/.env' })).toBeUndefined()
})
