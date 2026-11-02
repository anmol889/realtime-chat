CREATE TABLE "chats" (
    "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
    "name"       VARCHAR(64)    NOT NULL,
    "last_seq"   INTEGER        NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_members" (
    "chat_id"   UUID           NOT NULL,
    "user_id"   UUID           NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_members_pkey" PRIMARY KEY ("chat_id", "user_id"),
    CONSTRAINT "chat_members_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "chat_members_user_id_idx" ON "chat_members"("user_id");

CREATE TABLE "messages" (
    "id"                UUID           NOT NULL DEFAULT gen_random_uuid(),
    "chat_id"           UUID           NOT NULL,
    "sender_id"         UUID           NOT NULL,
    "seq"               INTEGER        NOT NULL,
    "content"           VARCHAR(4000)  NOT NULL,
    "client_message_id" VARCHAR(64),
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Ordering + pagination index and the guarantee that two instances can never persist the same seq.
CREATE UNIQUE INDEX "messages_chat_id_seq_key" ON "messages"("chat_id", "seq");
-- Idempotent retries: same client id from the same sender in the same chat is a no-op.
CREATE UNIQUE INDEX "messages_chat_id_sender_id_client_message_id_key" ON "messages"("chat_id", "sender_id", "client_message_id");
