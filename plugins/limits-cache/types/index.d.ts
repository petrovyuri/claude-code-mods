// How long the API keeps a prompt in its cache after the last request that used it.
export type Ttl = '5m' | '1h'

// One rate-limit window of the account: `five_hour`, `seven_day`, a gateway's `spend_limit`;
// `label` when the server names the window itself (`7д Fable`).
export type Limit = { kind: string; percentUsed: number; resetsAt?: string; label?: string }

// The account's windows, as the status line has them.
export type Meter = { limits: Limit[] }

// What a warmup did: the prompt cache read (or written anew), or why it was not. Its toast
// says it; the band shows only the countdown it restarts.
export type Warmup =
  | { kind: 'ok'; at: number; read: number; write: number }
  | { kind: 'failed'; at: number; message: string }

declare module 'claude-code' {
  interface PluginState {
    'limits-cache': {
      meter: Meter
      // The usage summary's windows (/usage's): the per-model weekly ones the responses omit.
      summary: Limit[]
      // When a request last used the cache: a main-thread turn's end, or a warmup.
      lastRequestAt: number | null
      // A main-thread turn is running: each of its requests refreshes the cache itself.
      isWorking: boolean
      ttl: Ttl
      isAuto: boolean
      // When the person last did something in the session; Auto stops an hour after it.
      activeAt: number | null
      isWarming: boolean
      // The clock the band's countdowns are drawn from.
      now: number
      // The person closed the band with ✕; /limits (and /usage in the terminal) shows it again.
      isHidden: boolean
    }
  }
}
