import { describe, expect, test } from 'claude-code/testing'

import { afterFill } from '../hooks/fill'

describe('afterFill', () => {
  test('a box that took the text leaves nothing to do', () => {
    expect(afterFill({ isFilled: true })).toBe('filled')
  })

  test('a surface with a prompt box of its own gets the message sent', () => {
    expect(afterFill({ isFilled: false, refusal: 'no_composer' })).toBe('send')
  })

  test('a dialog over the box holds the pick', () => {
    expect(afterFill({ isFilled: false, refusal: 'dialog' })).toBe('dialog')
  })

  test("a hook's refusal, its cause unknown, copies the text", () => {
    expect(afterFill({ isFilled: false })).toBe('copy')
  })
})
