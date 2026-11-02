import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '../graphql/operations';
import { useChatMessages } from '../hooks/useChatMessages';
import { useUsers } from '../hooks/useUsers';

export function ChatRoom({ chatId, user }: { chatId: string; user: User }) {
  const { messages, pending, hasOlder, loadingHistory, loadOlder, send, retry } = useChatMessages(chatId);
  const senderIds = useMemo(() => messages.map((m) => m.senderId), [messages]);
  const users = useUsers(senderIds);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSeq = messages.length ? messages[messages.length - 1].seq : 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [lastSeq, pending.length]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft('');
    void send(user.id, content);
  }

  const nameOf = (id: string) => (id === user.id ? 'You' : (users.get(id)?.displayName ?? id.slice(0, 8)));

  return (
    <div className="room">
      <div className="messages" data-testid="messages">
        {hasOlder && (
          <button className="ghost" onClick={() => void loadOlder()}>
            Load older
          </button>
        )}
        {loadingHistory && messages.length === 0 && <div className="muted">Loading history…</div>}
        {!loadingHistory && messages.length === 0 && <div className="muted">No messages yet. Say hi!</div>}
        {messages.map((m) => (
          <div key={m.seq} className={`msg ${m.senderId === user.id ? 'mine' : ''}`} data-testid="message" data-seq={m.seq}>
            <div className="meta">
              <span className="who">{nameOf(m.senderId)}</span>
              <span className="muted">
                #{m.seq} · {new Date(m.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <div className="body">{m.content}</div>
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.clientMessageId} className={`msg mine pending ${p.failed ? 'failed' : ''}`}>
            <div className="meta">
              <span className="who">You</span>
              <span className="muted">{p.failed ? 'failed' : 'sending…'}</span>
              {p.failed && (
                <button className="ghost" onClick={() => retry(p.clientMessageId)}>
                  retry
                </button>
              )}
            </div>
            <div className="body">{p.content}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="composer" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          maxLength={4000}
          autoFocus
          data-testid="composer"
        />
        <button type="submit" disabled={!draft.trim()} data-testid="send">
          Send
        </button>
      </form>
    </div>
  );
}
