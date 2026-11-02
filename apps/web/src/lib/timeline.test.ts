import { describe, expect, it } from 'vitest';
import type { Message } from '../graphql/operations';
import {
  addPending,
  emptyTimeline,
  markPendingFailed,
  mergeMessages,
  missingRanges,
  orderedMessages,
} from './timeline';

const msg = (seq: number, extra: Partial<Message> = {}): Message => ({
  id: `id-${seq}`,
  chatId: 'c',
  senderId: 'u',
  seq,
  content: `m${seq}`,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...extra,
});

describe('timeline', () => {
  it('orders by seq regardless of arrival order and dedupes', () => {
    const t = mergeMessages(emptyTimeline, [msg(3), msg(1), msg(2), msg(3, { content: 'dup' })]);
    expect(orderedMessages(t).map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(t.bySeq.get(3)?.content).toBe('dup');
    expect(t.minSeq).toBe(1);
    expect(t.maxSeq).toBe(3);
  });

  it('detects holes between min and max but not unloaded older history', () => {
    const t = mergeMessages(emptyTimeline, [msg(5), msg(6), msg(9), msg(12)]);
    expect(missingRanges(t)).toEqual([
      { afterSeq: 6, beforeSeq: 9 },
      { afterSeq: 9, beforeSeq: 12 },
    ]);
    expect(missingRanges(mergeMessages(emptyTimeline, [msg(5), msg(6)]))).toEqual([]);
    expect(missingRanges(emptyTimeline)).toEqual([]);
  });

  it('reconciles optimistic pending messages when the confirmed message arrives', () => {
    let t = addPending(emptyTimeline, { clientMessageId: 'abc', senderId: 'u', content: 'hi', createdAt: 'x' });
    t = addPending(t, { clientMessageId: 'def', senderId: 'u', content: 'yo', createdAt: 'x' });
    t = mergeMessages(t, [msg(1, { clientMessageId: 'abc' })]);
    expect(t.pending.map((p) => p.clientMessageId)).toEqual(['def']);
    t = markPendingFailed(t, 'def');
    expect(t.pending[0].failed).toBe(true);
  });

  it('returns the same state object when nothing changes', () => {
    const t = mergeMessages(emptyTimeline, [msg(1)]);
    expect(mergeMessages(t, [])).toBe(t);
  });
});
