import type { SessionMessage, ToolUseSummary } from 'claude-code'

export const user = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })

export const claude = (text: string, toolUses: ToolUseSummary[] = []): SessionMessage => ({
  role: 'assistant',
  text,
  toolUses,
})

export const use = (
  tool: string,
  input: Record<string, unknown>,
  outcome: Pick<ToolUseSummary, 'text' | 'isError'> = {},
): ToolUseSummary => ({ tool_use_id: `toolu_${tool}`, tool, input, ...outcome })

// A session that stopped mid-task: the plan is half done and Claude asked a question.
export const SESSION: SessionMessage[] = [
  user('Добавь в приложение экран настроек с тёмной темой'),
  claude('Составлю план и начну.', [
    use('mcp__ccd_turn__update_plan', {
      items: [
        { content: 'Сверстать экран настроек', status: 'in_progress' },
        { content: 'Переключатель темы', status: 'pending' },
        { content: 'Тесты', status: 'pending' },
      ],
    }),
    use('Write', { file_path: 'lib/settings/settings_screen.dart' }),
  ]),
  { role: 'user', text: '', toolUses: [], toolResults: [] },
  claude('Экран готов, перехожу к переключателю.', [
    use('mcp__ccd_turn__update_plan', { advance: true }),
    use('Bash', { command: 'flutter test' }, { text: '2 tests failed', isError: true }),
  ]),
  claude('Тесты темы падают. Хранить выбор темы в shared_preferences или в Hive?'),
]

// The reply a model gives when it follows the rules.
export const REPLY = JSON.stringify({
  status: 'Экран настроек готов, переключатель темы в работе; два теста падают.',
  next: 'Выбрать хранилище для темы и починить тесты.',
  options: ['Храни тему в shared_preferences', 'Почини падающие тесты темы', 'Покажи, что сделано по плану'],
})
