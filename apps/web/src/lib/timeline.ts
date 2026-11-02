import type { Message } from '../graphql/operations';

/**
 * Pure, framework-free timeline logic (unit-tested in timeline.test.ts).
 *
 * Messages are keyed by `seq`, which the server guarantees is gap-free and strictly increasing
 * per chat. That single property gives the client three things for free:
 *  - ordering:  sort by seq, regardless of which instance delivered a message or when;
 *  - dedupe:    the same message arriving via history AND the subscription collapses;
 *  - gap detection: if we hold seq 7 and 9 but not 8, something was missed (e.g. a WebSocket
 *    hiccup) and `missingRanges` tells the hook exactly what to fetch.
 */
export interface PendingMessage {
  clientMessageId: string;
  senderId: string;
  content: string;
  createdAt: string;
  failed?: boolean;
}

export interface Timeline {
  bySeq: ReadonlyMap<number, Message>;
  minSeq: number; // 0 when empty
  maxSeq: number; // 0 when empty
  pending: readonly PendingMessage[];
}

export const emptyTimeline: Timeline = { bySeq: new Map(), minSeq: 0, maxSeq: 0, pending: [] };

export function mergeMessages(state: Timeline, incoming: readonly Message[]): Timeline {
  if (incoming.length === 0) return state;
  const bySeq = new Map(state.bySeq);
  let { minSeq, maxSeq } = state;
  const confirmedClientIds = new Set<string>();
  for (const m of incoming) {
    bySeq.set(m.seq, m);
    if (minSeq === 0 || m.seq < minSeq) minSeq = m.seq;
    if (m.seq > maxSeq) maxSeq = m.seq;
    if (m.clientMessageId) confirmedClientIds.add(m.clientMessageId);
  }
  const pending = confirmedClientIds.size
    ? state.pending.filter((p) => !confirmedClientIds.has(p.clientMessageId))
    : state.pending;
  return { bySeq, minSeq, maxSeq, pending };
}

export function addPending(state: Timeline, p: PendingMessage): Timeline {
  return { ...state, pending: [...state.pending, p] };
}

export function markPendingFailed(state: Timeline, clientMessageId: string): Timeline {
  return {
    ...state,
    pending: state.pending.map((p) => (p.clientMessageId === clientMessageId ? { ...p, failed: true } : p)),
  };
}

export function removePending(state: Timeline, clientMessageId: string): Timeline {
  return { ...state, pending: state.pending.filter((p) => p.clientMessageId !== clientMessageId) };
}

export function orderedMessages(state: Timeline): Message[] {
  return [...state.bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export interface SeqRange {
  /** exclusive lower bound (pass as `afterSeq`) */
  afterSeq: number;
  /** exclusive upper bound (pass as `beforeSeq`) */
  beforeSeq: number;
}

/** Contiguous holes strictly inside [minSeq, maxSeq]. Older-than-minSeq is not a gap, just unloaded history. */
export function missingRanges(state: Timeline): SeqRange[] {
  const ranges: SeqRange[] = [];
  if (state.maxSeq - state.minSeq + 1 === state.bySeq.size) return ranges; // fast path: dense
  let holeStart: number | null = null;
  for (let s = state.minSeq; s <= state.maxSeq; s++) {
    const present = state.bySeq.has(s);
    if (!present && holeStart === null) holeStart = s;
    if (present && holeStart !== null) {
      ranges.push({ afterSeq: holeStart - 1, beforeSeq: s });
      holeStart = null;
    }
  }
  return ranges;
}
