// One response line of a Claude Code transcript: when it came and what it wrote to the cache.
export const assistantLine = (timestamp: string, cache: { h1?: number; m5?: number }, extra: object = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp,
    isSidechain: false,
    message: {
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: 290_000,
        cache_creation_input_tokens: (cache.h1 ?? 0) + (cache.m5 ?? 0),
        cache_creation: { ephemeral_1h_input_tokens: cache.h1 ?? 0, ephemeral_5m_input_tokens: cache.m5 ?? 0 },
      },
    },
    ...extra,
  })

export const userLine = (timestamp: string) => JSON.stringify({ type: 'user', timestamp, message: { role: 'user' } })

// The engine hands `$.fs` hooks an absolute path in the platform's own spelling.
export const slashes = (path: string): string => path.replace(/\\/g, '/')
