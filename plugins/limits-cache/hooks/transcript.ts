import type { Ttl } from '../types'

// What the transcript says of the prompt cache: when a response last used it, and the TTL
// the session writes it with. Each is null where the transcript does not say.
export type TranscriptCache = { at: number | null; ttl: Ttl | null }

type Usage = {
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number } | null
}

type Entry = {
  type?: string
  timestamp?: string
  isSidechain?: boolean
  message?: { model?: string; usage?: Usage }
}

// Claude Code names a project's folder after its working directory, every character but
// letters and digits made a dash: `C:\Users\dev\app` is `C--Users-dev-app`.
export function projectFolder(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function transcriptPath(configDir: string, cwd: string, sessionId: string): string {
  return `${configDir}/projects/${projectFolder(cwd)}/${sessionId}.jsonl`
}

function ttlOf(usage: Usage): Ttl | null {
  const creation = usage.cache_creation
  if ((creation?.ephemeral_1h_input_tokens ?? 0) > 0) {
    return '1h'
  }

  return (creation?.ephemeral_5m_input_tokens ?? 0) > 0 ? '5m' : null
}

// Reads the transcript from its end: the last response of the main conversation, and the
// last one that wrote to the cache, whose split between the two TTLs names the session's.
export function lastCacheUse(text: string): TranscriptCache {
  const found: TranscriptCache = { at: null, ttl: null }
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0 && (found.at === null || found.ttl === null); index -= 1) {
    const line = lines[index] ?? ''
    if (!line.includes('"assistant"') || !line.includes('"usage"')) {
      continue
    }
    let entry: Entry
    try {
      entry = JSON.parse(line) as Entry
    } catch {
      continue
    }
    const usage = entry.message?.usage
    // An error the engine wrote itself (`<synthetic>`) made no request.
    if (entry.type !== 'assistant' || entry.isSidechain === true || usage === undefined || entry.message?.model === '<synthetic>') {
      continue
    }
    if (found.at === null) {
      const at = Date.parse(entry.timestamp ?? '')
      found.at = Number.isNaN(at) ? null : at
    }
    found.ttl ??= ttlOf(usage)
  }

  return found
}
