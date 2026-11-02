import { useMutation, useQuery } from '@apollo/client';
import { FormEvent, useEffect, useState } from 'react';
import { CHATS, CREATE_CHAT, JOIN_CHAT, type Chat, type User } from '../graphql/operations';

export function ChatList({
  user,
  selectedChatId,
  onSelect,
}: {
  user: User;
  selectedChatId: string | null;
  onSelect: (id: string) => void;
}) {
  // A plain interval (not Apollo's pollInterval, which pauses in tabs it considers hidden) keeps the
  // list fresh across users/instances without a second subscription; cheap at this scale.
  const { data, loading, error, refetch } = useQuery<{ chats: Chat[] }>(CHATS);
  useEffect(() => {
    const tick = () => void refetch().catch(() => undefined);
    const timer = setInterval(tick, 3000);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, [refetch]);
  const [createChat, { loading: creating }] = useMutation<{ createChat: Chat }>(CREATE_CHAT);
  const [joinChat, { loading: joining }] = useMutation<{ joinChat: Chat }>(JOIN_CHAT);
  const [name, setName] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    const res = await createChat({ variables: { input: { name, creatorId: user.id } } });
    setName('');
    await refetch();
    if (res.data) onSelect(res.data.createChat.id);
  }

  async function join(chat: Chat) {
    await joinChat({ variables: { chatId: chat.id, userId: user.id } });
    await refetch();
    onSelect(chat.id);
  }

  return (
    <div className="chat-list">
      <form onSubmit={create} className="row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New chat name"
          maxLength={64}
          required
          data-testid="new-chat-name"
        />
        <button type="submit" disabled={creating} data-testid="create-chat">
          Create
        </button>
      </form>
      {loading && !data && <div className="muted">Loading chats…</div>}
      {error && <div className="error">{error.message}</div>}
      <ul>
        {data?.chats.map((chat) => {
          const member = chat.memberIds.includes(user.id);
          return (
            <li key={chat.id} className={chat.id === selectedChatId ? 'selected' : ''}>
              <button className="chat-item" onClick={() => (member ? onSelect(chat.id) : join(chat))} disabled={joining} data-testid={`chat-${chat.name}`}>
                <span className="name">#{chat.name}</span>
                <span className="muted">
                  {chat.memberIds.length} member{chat.memberIds.length === 1 ? '' : 's'} · {chat.lastSeq} msg
                  {member ? '' : ' · join'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
