import type { PromptFilled } from 'claude-code'

// What a pick does once the prompt box answered: nothing more where it took the text; sent as
// the person's message where the surface draws a box of its own (the engine's `no_composer`);
// held while a dialog has the keys; copied where a hook kept the text out, its cause unknown.
export type AfterFill = 'filled' | 'send' | 'dialog' | 'copy'

export function afterFill(filled: Pick<PromptFilled, 'isFilled' | 'refusal'>): AfterFill {
  if (filled.isFilled) {
    return 'filled'
  }
  if (filled.refusal === 'no_composer') {
    return 'send'
  }

  return filled.refusal === 'dialog' ? 'dialog' : 'copy'
}
