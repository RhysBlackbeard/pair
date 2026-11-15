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
    }
  }
}
