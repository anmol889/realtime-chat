import { gql } from '@apollo/client';

// ---- user-service (context: { service: 'users' }) ----

export interface User {
  id: string;
  username: string;
  displayName: string;
}

export const USER_BY_USERNAME = gql`
  query UserByUsername($username: String!) {
    userByUsername(username: $username) { id username displayName }
  }
`;

export const CREATE_USER = gql`
  mutation CreateUser($input: CreateUserInput!) {
    createUser(input: $input) { id username displayName }
  }
`;

export const USERS_BY_IDS = gql`
  query UsersByIds($ids: [ID!]!) {
    users(ids: $ids) { id username displayName }
  }
`;

// ---- chat-service ----

export interface Chat {
  id: string;
  name: string;
  memberIds: string[];
  lastSeq: number;
  createdAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  seq: number;
  content: string;
  clientMessageId?: string | null;
  createdAt: string;
}

const MESSAGE_FIELDS = gql`
  fragment MessageFields on Message { id chatId senderId seq content clientMessageId createdAt }
`;

export const CHATS = gql`
  query Chats { chats { id name memberIds lastSeq createdAt } }
`;

export const CREATE_CHAT = gql`
  mutation CreateChat($input: CreateChatInput!) {
    createChat(input: $input) { id name memberIds lastSeq createdAt }
  }
`;

export const JOIN_CHAT = gql`
  mutation JoinChat($chatId: ID!, $userId: ID!) {
    joinChat(chatId: $chatId, userId: $userId) { id name memberIds lastSeq createdAt }
  }
`;

export const MESSAGES = gql`
  ${MESSAGE_FIELDS}
  query Messages($chatId: ID!, $afterSeq: Int, $beforeSeq: Int, $limit: Int) {
    messages(chatId: $chatId, afterSeq: $afterSeq, beforeSeq: $beforeSeq, limit: $limit) { ...MessageFields }
  }
`;

export const SEND_MESSAGE = gql`
  ${MESSAGE_FIELDS}
  mutation SendMessage($input: SendMessageInput!) {
    sendMessage(input: $input) { ...MessageFields }
  }
`;

export const MESSAGE_ADDED = gql`
  ${MESSAGE_FIELDS}
  subscription MessageAdded($chatId: ID!) {
    messageAdded(chatId: $chatId) { ...MessageFields }
  }
`;
