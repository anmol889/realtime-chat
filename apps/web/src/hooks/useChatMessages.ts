import { useApolloClient, useSubscription } from '@apollo/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { onReconnect } from '../apollo';
import { MESSAGES, MESSAGE_ADDED, SEND_MESSAGE, type Message } from '../graphql/operations';
import {
  addPending,
  emptyTimeline,
  markPendingFailed,
  mergeMessages,
  missingRanges,
  orderedMessages,
  removePending,
  type Timeline,
} from '../lib/timeline';

const INITIAL_PAGE = 50;
const MAX_SEQ = 2_147_483_647; // "latest page" cursor: everything is < this

/**
 * Live, ordered timeline for one chat.
 *
 * Decision D3 on the client side: the subscription and the history query race on mount; instead of
 * sequencing them (not possible reliably: graphql-ws has no "subscribed" ack) we rely on seq:
 *  - both feed the same seq-keyed map, so overlap is harmless;
 *  - any hole inside [minSeq, maxSeq] is fetched immediately (`missingRanges`);
 *  - after a WebSocket reconnect we fetch everything after maxSeq.
 * The result is correct ordering and no lost messages even across instance restarts.
 */
export function useChatMessages(chatId: string) {
  const client = useApolloClient();
  const [timeline, setTimeline] = useState<Timeline>(emptyTimeline);
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const inFlight = useRef(new Set<string>());
  const [loadingHistory, setLoadingHistory] = useState(true);

  const fetchPage = useCallback(
    async (afterSeq: number, beforeSeq: number | null, limit: number): Promise<Message[]> => {
      const key = `${afterSeq}:${beforeSeq}:${limit}`;
      if (inFlight.current.has(key)) return [];
      inFlight.current.add(key);
      try {
        const { data } = await client.query<{ messages: Message[] }>({
          query: MESSAGES,
          variables: { chatId, afterSeq, beforeSeq, limit },
          fetchPolicy: 'network-only',
        });
        setTimeline((t) => mergeMessages(t, data.messages));
        return data.messages;
      } finally {
        inFlight.current.delete(key);
      }
    },
    [client, chatId],
  );

  // 1. live stream (attached as early as possible)
  useSubscription<{ messageAdded: Message }>(MESSAGE_ADDED, {
    variables: { chatId },
    onData: ({ data }) => {
      if (data.data?.messageAdded) setTimeline((t) => mergeMessages(t, [data.data!.messageAdded]));
    },
  });

  // 2. latest page of history
  useEffect(() => {
    setTimeline(emptyTimeline);
    setLoadingHistory(true);
    fetchPage(0, MAX_SEQ, INITIAL_PAGE).finally(() => setLoadingHistory(false));
  }, [fetchPage]);

  // 3. fill any detected gap
  useEffect(() => {
    for (const gap of missingRanges(timeline)) {
      void fetchPage(gap.afterSeq, gap.beforeSeq, 200);
    }
  }, [timeline, fetchPage]);

  // 4. catch up after reconnect
  useEffect(
    () => onReconnect(() => void fetchPage(timelineRef.current.maxSeq, null, 200)),
    [fetchPage],
  );

  const loadOlder = useCallback(async () => {
    const { minSeq } = timelineRef.current;
    if (minSeq <= 1) return;
    await fetchPage(0, minSeq, INITIAL_PAGE);
  }, [fetchPage]);

  const send = useCallback(
    async (senderId: string, content: string) => {
      const clientMessageId = crypto.randomUUID();
      setTimeline((t) =>
        addPending(t, { clientMessageId, senderId, content, createdAt: new Date().toISOString() }),
      );
      try {
        const { data } = await client.mutate<{ sendMessage: Message }>({
          mutation: SEND_MESSAGE,
          variables: { input: { chatId, senderId, content, clientMessageId } },
        });
        if (data) setTimeline((t) => mergeMessages(t, [data.sendMessage]));
      } catch {
        setTimeline((t) => markPendingFailed(t, clientMessageId));
      }
    },
    [client, chatId],
  );

  const retry = useCallback(
    (clientMessageId: string) => {
      const p = timelineRef.current.pending.find((x) => x.clientMessageId === clientMessageId);
      if (!p) return;
      setTimeline((t) => removePending(t, clientMessageId));
      void send(p.senderId, p.content);
    },
    [send],
  );

  return {
    messages: orderedMessages(timeline),
    pending: timeline.pending,
    hasOlder: timeline.minSeq > 1,
    loadingHistory,
    loadOlder,
    send,
    retry,
  };
}
