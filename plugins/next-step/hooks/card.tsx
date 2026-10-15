import type { ClientModule } from 'claude-code'

// One message to pick, as the desktop draws it: a card the whole of which is a click, its
// text wrapped over as many lines as it takes. A Button cannot be one: the desktop draws its
// text on one line, cut where the pane ends.
export type CardProps = { n: number; text: string }

// What a card posts to the hooks module when it is clicked: which message, by its number.
export type CardPick = { pick: number }

const Card: ClientModule<CardProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  // Registered on every draw: a later call replaces the listener, so it posts this draw's number.
  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') {
      surface.post({ pick: props.n })
    }
  })

  return (
    <Box key="card" flexDirection="row" columnGap={1} borderStyle="round" borderDimColor paddingX={1}>
      <Text dimColor>{String(props.n)}</Text>
      <Box key="text" flexGrow={1} flexShrink={1}>
        <Text wrap="wrap">{props.text}</Text>
      </Box>
    </Box>
  )
}

export default Card
