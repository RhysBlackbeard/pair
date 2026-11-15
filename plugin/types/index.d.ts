/**
 * One row of the pane. `kind` is an inbox event's kind (message, file, pair_request, paired, connection, unpaired,
 * file_failed, outbox_failed, ...), or one the pane adds itself: `sent` (typed in the pane), `claude` (your Claude's
 * send_to_peer), `sent-file` (a file you or your Claude sent).
 */
export type PairEvent = {
  id: string
  kind: string
  /** Who it's from: the peer's name, or '' for your side. */
  peer: string
  text: string
  /** When the pane first saw it, ms. */
  at: number
  trust?: string
  via?: string
  /** Files: name, size in bytes, and where it was saved (received) or read from (sent). */
  name?: string
  size?: number
  path?: string
  /** A file or message you or your Claude sent that the peer's pair confirmed. */
  delivered?: boolean
  /** When you handed it to Claude, ms. */
  handedAt?: number
  /**
   * The pairing this row belongs to: the server's local peer id (p1, p2, ...), from the inbox line's `peer_id`, or the
   * peer a sent row went to. Absent on rows from a server before multi-peer support. (Added 14-Nov-26, multi-peer.)
   */
  peerId?: string
  /** Sent rows: the short name of the peer it went to, shown when more than one is paired. */
  to?: string
  /**
   * AI Shipmates pane (added 15-Nov-26). `summary`: the sender's one-line summary (agent messages). `typed`: a person
   * typed it in a pane (shown in full). `fyi`: a line a person should know. `needs`: a decision a person must make,
   * on a plain pairing (crew needs come on the board). `agent`: the sender's model family, for its logo. `from`: the
   * sender's shipmate handle (a relay names the real sender). `colour`: its palette slot (0 hub, 1-7 members).
   * `human`: a decision row, picked by a person in a pane. `autoDelivered`: Claude already got it as it arrived.
   */
  summary?: string
  typed?: boolean
  fyi?: string
  needs?: PairNeed
  agent?: string
  from?: string
  colour?: number
  human?: boolean
  autoDelivered?: boolean
}

/** A decision only a person can make (AI Shipmates pane, 15-Nov-26). */
export type PairNeed = {
  id: string
  question: string
  options: string[]
  recommended: number
  context?: string
  /** The member handle that asked ('hub' for the hub's agent). */
  from?: string
  answered_by?: string
  answer?: string
}

/** One crew member as the hub lists it (AI Shipmates pane, 15-Nov-26). */
export type PairMember = { handle: string; agent: string; colour: number }

/** The crew: the hub, its members, and which one this session is ('hub' on the hub). */
export type PairCrew = {
  hub: { name: string; agent: string; colour: number }
  members: PairMember[]
  you: string
}

/** The crew board the hub keeps: session summary, needs, fyi. */
export type PairBoard = {
  summary: string
  needs: PairNeed[]
  fyi: { id: string; from: string; text: string }[]
  /** The pairing (our hub) that sent it; absent on the hub's own board. */
  peerId?: string
}

/** One open pairing, as the pane follows it from inbox events. (Added 14-Nov-26, multi-peer.) */
export type PairPeer = {
  /** The server's local peer id (p1, p2, ...); '' for a server before multi-peer support. */
  id: string
  phase: 'request' | 'paired' | 'reconnecting'
  /** The peer's identity as the server gives it: user@host · git name · git email. */
  peer?: string
  trust?: string
  via?: string
}

/** Every open pairing, oldest first (up to 3). Multi-peer changed this from one peer's fields (shape status-3). */
export type PairStatus = {
  peers: PairPeer[]
}

declare module 'claude-code' {
  interface PluginState {
    pair: {
      events: Shaped<PairEvent[]>
      status: Shaped<PairStatus>
      /** Complete inbox lines already read. */
      seen: number
      /** This session's pair folder (inbox.jsonl, outbox.jsonl), or '' when pair isn't running here. */
      dir: string
      /** Rows that arrived after this (ms) are new. */
      seenAt: number
      tab: 'chat' | 'files'
      /** The pane is placed on a surface (the band above the prompt shows while it isn't). */
      paneOpen: boolean
      /** The peer id the pane's chat box and file box send to, when more than one is paired; '' = the first. */
      selected: string
      /** AI Shipmates pane (added 15-Nov-26): the crew list and board from the hub (null outside a crew). */
      crew: Shaped<PairCrew | null>
      board: Shaped<PairBoard | null>
      /** Need ids this pane answered, with the option picked (until the board says who answered first). */
      answered: Record<string, string>
      /** Row ids whose full text is open. */
      expanded: string[]
      /** What the pane shows: the chat, or the "You should know" list. */
      view: 'chat' | 'know'
    }
  }
}
