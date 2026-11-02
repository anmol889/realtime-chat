import { useApolloClient } from '@apollo/client';
import { FormEvent, useState } from 'react';
import { CREATE_USER, USER_BY_USERNAME, type User } from '../graphql/operations';

/** Find-or-create by username. No passwords: the challenge is about messaging, not auth. */
export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const client = useApolloClient();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const found = await client.query<{ userByUsername: User | null }>({
        query: USER_BY_USERNAME,
        variables: { username },
        context: { service: 'users' },
        fetchPolicy: 'network-only',
      });
      if (found.data.userByUsername) return onLogin(found.data.userByUsername);
      const created = await client.mutate<{ createUser: User }>({
        mutation: CREATE_USER,
        variables: { input: { username, displayName: displayName || undefined } },
        context: { service: 'users' },
      });
      onLogin(created.data!.createUser);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit} className="card">
        <h1>Realtime Chat</h1>
        <p className="muted">Enter a username. New names are created on the fly.</p>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="alice"
            minLength={3}
            maxLength={32}
            pattern="[a-zA-Z0-9_.\-]+"
            required
            autoFocus
            data-testid="username"
          />
        </label>
        <label>
          Display name <span className="muted">(optional)</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={64} data-testid="displayName" />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={busy} data-testid="login">
          {busy ? 'Signing in…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
