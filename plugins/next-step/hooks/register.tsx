import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Phase } from '../types'
import { briefOf, briefPrompt, describeNoReply, endsAnswer, lastAnswerOf } from './brief'
import { afterFill } from './fill'
import { PANE, drawPane, drawUnderReply } from './view'

// The cheap model that reads the session unless the person picked another in /config.
export const DEFAULT_MODEL = 'haiku'
// Room for the JSON a model wraps two short summaries and four messages in.
const MAX_TOKENS = 1_200
const TIMEOUT_MS = 90_000

const IDLE: Phase = { kind: 'idle' }

const phase = atom({ plugin: 'next-step', key: 'phase' } as const, IDLE)
const lastAnswer = atom({ plugin: 'next-step', key: 'lastAnswer' } as const, null as string | null)
const cardsFailed = atom({ plugin: 'next-step', key: 'cardsFailed' } as const, false)

const firstLine = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0]?.trim() ?? ''

// The model the person picked in /config; set at each load.
let model = DEFAULT_MODEL
// The call in flight: Cancel, a new prompt or a /clear stops it, and its late reply with it.
let running: AbortController | null = null

function stop(): void {
  running?.abort()
  running = null
}

async function dismiss($: EngineInterface): Promise<void> {
  stop()
  await update($, phase, () => IDLE)
}

// The pane has done its part, or what it shows is stale. Not open, it is left alone.
async function closePane($: EngineInterface): Promise<void> {
  try {
    await $.ui.close({ id: PANE })
  } catch {
    // A hook kept it open: the person closes it.
  }
}

// The model reads a digest of the session and answers where it stopped, what comes next
// and the messages to pick.
async function ask($: EngineInterface): Promise<void> {
  // A press on a button drawn before the running call hid it.
  if (running !== null) {
    return
  }
  const controller = new AbortController()
  running = controller
  let next: Phase
  try {
    const request = briefPrompt(await $.session.messages())
    if (request === null) {
      running = null
      $.ui.toast('В сессии пока нечего пересказывать')

      return
    }
    await update($, phase, () => ({ kind: 'loading' }))
    const reply = await $.model.complete(
      { model, ...request, maxTokens: MAX_TOKENS, effort: 'low', timeoutMs: TIMEOUT_MS },
      { signal: controller.signal },
    )
    if (reply.isAnswered) {
      const brief = briefOf(reply.text)
      next = brief === null ? { kind: 'failed', message: 'Модель вернула пустой ответ' } : { kind: 'ready', brief }
    } else {
      next = { kind: 'failed', message: describeNoReply(reply) }
    }
  } catch (error) {
    next = { kind: 'failed', message: firstLine(error) || 'Не удалось получить сводку' }
  }
  // Cancelled, or the conversation moved on while the model read it: the reply is stale.
  if (running !== controller) {
    return
  }
  running = null
  await update($, phase, () => next)
}

// From the button under the prompt and from /next-step: the pane opens on the brief, made
// afresh unless one is being made or stands ready (its Обновить makes another).
async function openBrief($: EngineInterface): Promise<void> {
  if (running === null && (await read($, phase)).kind !== 'ready') {
    void ask($)
  }
  const opened = await $.ui.open({ id: PANE, title: 'Что дальше?', focus: true, closeOnEscape: true })
  if (!opened.isPlaced) {
    $.ui.toast('Панель «Что дальше?» не помещается: расширьте окно')
  }
}

// The picked message goes where the person types: after a draft they have, else in its
// place. A surface that draws its own prompt box takes no fill: there it is sent as theirs.
async function pick($: EngineInterface, text: string, surface: RenderSurface): Promise<void> {
  const draft = await $.prompt.read()
  const hasDraft = draft.text.trim() !== ''
  const filled = await $.prompt.fill(hasDraft ? { text: `\n${text}`, mode: 'append' } : { text, mode: 'replace' })
  switch (afterFill(filled)) {
    case 'filled':
      await update($, phase, () => IDLE)
      await closePane($)

      return
    case 'dialog':
      $.ui.toast('Сначала закройте диалог, затем выберите вариант снова')

      return
    case 'send': {
      await update($, phase, () => IDLE)
      await closePane($)
      const sent = await $.prompt.submit({ text, asUser: true })
      if (sent.drop !== undefined) {
        $.ui.toast(`Сообщение не отправлено: ${sent.drop}`)
      }

      return
    }
    case 'copy': {
      const copied = await $.ui.copy({ text, surface })
      $.ui.toast(copied.isCopied ? 'Текст скопирован: вставьте его в поле ввода' : 'Не удалось вставить текст')
    }
  }
}

export const register: Register = (on, options) => {
  model = typeof options.model === 'string' && options.model !== '' ? options.model : DEFAULT_MODEL
  running = null

  on('session.start', async ($, e, next) => {
    // State outlives a reload of the mod; a call the reload cut short never ends.
    if ((await read($, phase)).kind === 'loading') {
      await update($, phase, () => IDLE)
    }
    // Loaded into a conversation already under way, the button goes under its last answer.
    try {
      const answer = lastAnswerOf(await $.session.messages())
      await update($, lastAnswer, () => answer)
    } catch {
      // Nothing to read yet: the first answer shows the button.
    }
    await $.command.register({
      name: 'next-step',
      description: 'Коротко: на чём остановились и что делать дальше, с готовыми сообщениями на выбор',
    })

    return next(e)
  })

  on('command.run', { command: 'next-step' }, async $ => {
    await openBrief($)

    return {}
  })

  // A prompt entering the session moves the conversation on: the brief is stale, and the
  // button waits for the answer to come.
  on('prompt.submit', async ($, e, next) => {
    if (running !== null || (await read($, phase)).kind !== 'idle') {
      await dismiss($)
      await closePane($)
    }
    if ((await read($, lastAnswer)) !== null) {
      await update($, lastAnswer, () => null)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // A subagent's loop is no answer of the main conversation's.
    if (e.agentId === undefined) {
      await update($, lastAnswer, () => (e.answer.trim() === '' ? null : e.answer))
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await dismiss($)
      await closePane($)
      await update($, lastAnswer, () => null)
    }

    return next(e)
  })

  // The button sits under Claude's last reply: drawn on every surface, the desktop's
  // included, and in a site no other plugin draws in. The reply itself is the engine's.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const answer = await read($, lastAnswer)
    if (answer === null || e.props.isSummary === true || !endsAnswer(answer, e.props.text)) {
      return next(e)
    }
    const reply = await next(e)

    return drawUnderReply($.ui.resolve(e), reply, () => void openBrief($))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const surface = e.surface
    // The desktop draws the cards with the surface module, unless it could not run it.
    const asClient = surface === 'desktop' && !(await read($, cardsFailed))

    return drawPane(
      $.ui.resolve(e),
      await read($, phase),
      {
        ask: () => void ask($),
        cancel: () => void dismiss($),
        pick: text => void pick($, text, surface),
      },
      asClient,
    )
  })

  // A card clicked on the desktop: its module posts the message's number.
  on('ui.message', async ($, e, next) => {
    const data = e.data as { pick?: unknown } | null
    const current = await read($, phase)
    if (e.requestId === PANE && current.kind === 'ready' && typeof data?.pick === 'number') {
      const option = current.brief.options[data.pick - 1]
      if (option !== undefined) {
        await pick($, option, e.surface)
      }
    }

    return next(e)
  })

  // The desktop could not run the card module: the cards fall back to frames with a button.
  on('ui.fault', async ($, e, next) => {
    if (e.requestId === PANE && !(await read($, cardsFailed))) {
      $.ui.log(`next-step: карточки не нарисовались (${e.reason}), показываю кнопки`, { to: 'debug' })
      await update($, cardsFailed, () => true)
    }

    return next(e)
  })
}
