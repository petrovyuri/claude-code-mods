import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { Brief, Phase } from '../types'

type Table = Elements[RenderSurface]

export type PaneActions = {
  ask: () => void
  cancel: () => void
  pick: (text: string) => void
}

// The pane the brief is read in, and the prefix of every key the mod draws.
export const PANE = 'next-step'

// The last reply as the engine draws it, the button under it: where the person reads what
// Claude did, on every surface, and in no site another plugin draws in.
export function drawUnderReply({ Box, Button }: Pick<Table, 'Box' | 'Button'>, reply: RenderElement, ask: () => void) {
  return (
    <Box key={`${PANE}:reply`} flexDirection="column">
      {reply}
      <Box key={`${PANE}:under`} flexDirection="row" justifyContent="flex-end" paddingTop={1}>
        <Button key={`${PANE}:ask`} label="💡 Что дальше?" plain dimColor onPress={ask} />
      </Box>
    </Box>
  )
}

// The pane's body: room around it, and the actions in a row at its right edge.
function frame({ Box }: Table, actions: RenderElement, ...body: RenderElement[]) {
  return (
    <Box key={PANE} flexDirection="column" rowGap={1} paddingX={1} paddingY={1}>
      {body}
      <Box key={`${PANE}:actions`} flexDirection="row" justifyContent="flex-end" columnGap={1}>
        {actions}
      </Box>
    </Box>
  )
}

function drawIdle(table: Table, actions: PaneActions) {
  const { Box, Text, Button } = table

  return frame(
    table,
    <Button key={`${PANE}:refresh`} label="Собрать сводку" variant="primary" onPress={actions.ask} />,
    <Box key={`${PANE}:status`}>
      <Text dimColor>Здесь будет сводка: на чём остановились, что делать дальше и сообщения на выбор.</Text>
    </Box>,
  )
}

function drawLoading(table: Table, actions: PaneActions) {
  const { Box, Text, Button } = table

  return frame(
    table,
    <Button key={`${PANE}:cancel`} label="Отмена" dimColor onPress={actions.cancel} />,
    <Box key={`${PANE}:status`}>
      <Text dimColor>Изучаю сессию…</Text>
    </Box>,
  )
}

function drawFailed(table: Table, message: string, actions: PaneActions) {
  const { Box, Text, Button } = table

  return frame(
    table,
    <Button key={`${PANE}:refresh`} label="Повторить" onPress={actions.ask} />,
    <Box key={`${PANE}:status`}>
      <Text color="error">{message}</Text>
    </Box>,
  )
}

// One message to pick as a card. On the desktop the whole card is a click: a surface module
// draws it (./card.tsx) and posts its number. A Button cannot be the card there: the desktop
// draws a button's text on one line, cut where the pane ends. Elsewhere, and where the desktop
// could not run the module, the card is a frame holding the wrapped text and a Выбрать button,
// whose digit picks it while the pane holds the keys.
function drawCard(table: Table, n: number, text: string, asClient: boolean, pick: () => void) {
  const { Box, Text, Button } = table
  if (asClient && 'Client' in table) {
    const { Client } = table

    return <Client key={`${PANE}:option:${n}`} module="./card.tsx" props={{ n, text }} width="100%" />
  }

  return (
    <Box
      key={`${PANE}:option:${n}:card`}
      flexDirection="row"
      columnGap={1}
      alignItems="flex-start"
      borderStyle="round"
      borderDimColor
      paddingX={1}
    >
      <Box key={`${PANE}:option:${n}:text`} flexGrow={1} flexShrink={1}>
        <Text wrap="wrap">{text}</Text>
      </Box>
      <Button key={`${PANE}:option:${n}`} label="Выбрать" hotkey={String(n)} dimColor onPress={pick} />
    </Box>
  )
}

// Where the session stopped, what comes next, and the messages to pick as cards.
function drawReady(table: Table, brief: Brief, actions: PaneActions, asClient: boolean) {
  const { Box, Text, Button } = table

  return frame(
    table,
    <Button key={`${PANE}:refresh`} label="Обновить" dimColor onPress={actions.ask} />,
    ...(brief.status === ''
      ? []
      : [
          <Box key={`${PANE}:status`} flexDirection="column">
            <Text bold>На чём остановились</Text>
            <Text>{brief.status}</Text>
          </Box>,
        ]),
    ...(brief.next === ''
      ? []
      : [
          <Box key={`${PANE}:next`} flexDirection="column">
            <Text bold>Что дальше</Text>
            <Text>{brief.next}</Text>
          </Box>,
        ]),
    ...(brief.options.length === 0
      ? []
      : [
          <Box key={`${PANE}:options`} flexDirection="column" rowGap={1}>
            <Text dimColor>Выберите — сообщение попадёт в чат:</Text>
            {brief.options.map((option, index) =>
              drawCard(table, index + 1, option, asClient, () => actions.pick(option)),
            )}
          </Box>,
        ]),
  )
}

// `asClient`: the cards are drawn by the surface module, where the surface runs one.
export function drawPane(table: Table, phase: Phase, actions: PaneActions, asClient: boolean) {
  switch (phase.kind) {
    case 'idle':
      return drawIdle(table, actions)
    case 'loading':
      return drawLoading(table, actions)
    case 'failed':
      return drawFailed(table, phase.message, actions)
    case 'ready':
      return drawReady(table, phase.brief, actions, asClient)
  }
}
