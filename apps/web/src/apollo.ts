import { ApolloClient, HttpLink, InMemoryCache, split } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';

/**
 * One Apollo client, two services (decision D9).
 * The nginx gateway exposes both GraphQL APIs on the same origin under different paths, so an
 * operation picks its backend through `context: { service: 'users' }`; everything else goes to chat.
 * Subscriptions are routed to the graphql-ws link; queries/mutations to HTTP.
 */
export const USERS_PATH = '/users/graphql';
export const CHAT_PATH = '/chat/graphql';

const httpLink = new HttpLink({
  uri: (operation) => (operation.getContext().service === 'users' ? USERS_PATH : CHAT_PATH),
});

const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${CHAT_PATH}`;

type Listener = () => void;
const reconnectListeners = new Set<Listener>();
/** Register a callback that fires after the WebSocket re-establishes (used for seq-based catch-up). */
export function onReconnect(listener: Listener): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

export const wsClient = createClient({
  url: wsUrl,
  retryAttempts: Infinity,
  shouldRetry: () => true,
  keepAlive: 10_000,
  on: {
    connected: (_socket, _payload, wasRetry) => {
      if (wasRetry) reconnectListeners.forEach((l) => l());
    },
  },
});

const link = split(
  ({ query }) => {
    const def = getMainDefinition(query);
    return def.kind === 'OperationDefinition' && def.operation === 'subscription';
  },
  new GraphQLWsLink(wsClient),
  httpLink,
);

export const apollo = new ApolloClient({ link, cache: new InMemoryCache() });
