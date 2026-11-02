-- Users table. `username` is unique and case-insensitively normalised by the service (lowercased)
-- so the unique index alone is enough; no citext extension needed.
CREATE TABLE "users" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "username"     VARCHAR(32)  NOT NULL,
    "display_name" VARCHAR(64)  NOT NULL,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
