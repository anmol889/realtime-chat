import { useState } from 'react';
import type { User } from './graphql/operations';
import { loadSession, saveSession } from './session';
import { Login } from './components/Login';
import { ChatList } from './components/ChatList';
import { ChatRoom } from './components/ChatRoom';

export function App() {
  const [user, setUser] = useState<User | null>(() => loadSession());
  const [chatId, setChatId] = useState<string | null>(null);

  if (!user) {
    return (
      <Login
        onLogin={(u) => {
          saveSession(u);
          setUser(u);
        }}
      />
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="me">
          <div>
            <strong>{user.displayName}</strong>
            <div className="muted">@{user.username}</div>
          </div>
          <button
            className="ghost"
            onClick={() => {
              saveSession(null);
              setUser(null);
              setChatId(null);
            }}
          >
            Sign out
          </button>
        </header>
        <ChatList user={user} selectedChatId={chatId} onSelect={setChatId} />
      </aside>
      <main className="main">
        {chatId ? <ChatRoom key={chatId} chatId={chatId} user={user} /> : <div className="empty">Pick or create a chat</div>}
      </main>
    </div>
  );
}
