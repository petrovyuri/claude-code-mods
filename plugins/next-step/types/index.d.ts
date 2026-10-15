// What the cheap model made of the session: where it stopped, what comes next, and the
// messages the person may send Claude as the next step.
export type Brief = { status: string; next: string; options: string[] }

// The pane's state: nothing asked yet, the model reading, its brief, or why there is none.
export type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; brief: Brief }
  | { kind: 'failed'; message: string }

declare module 'claude-code' {
  interface PluginState {
    'next-step': {
      phase: Phase
      // The final text of the main conversation's last answer: the button sits under the
      // reply block it ends with. Null while a turn runs, and before any answer.
      lastAnswer: string | null
      // The desktop could not run the card module: the cards are drawn as frames with a
      // Выбрать button for the rest of the session.
      cardsFailed: boolean
    }
  }
}
