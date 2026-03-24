-- Hybrid memory recall schema

CREATE TABLE IF NOT EXISTS "memory_chunks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "memory_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "memory_key" TEXT NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "normalized_content" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "token_estimate" INTEGER NOT NULL,
  "char_count" INTEGER NOT NULL,
  "embedding_cache_id" TEXT,
  "embedding_provider" TEXT,
  "embedding_model" TEXT,
  "embedding_version" TEXT,
  "embedding_dimensions" INTEGER,
  "embedding_json" TEXT,
  "indexed_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_chunks_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "memory_chunks_embedding_cache_id_fkey" FOREIGN KEY ("embedding_cache_id") REFERENCES "embedding_cache" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "memory_chunks_memory_id_chunk_index_key" ON "memory_chunks"("memory_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "memory_chunks_agent_id_memory_key_idx" ON "memory_chunks"("agent_id", "memory_key");
CREATE INDEX IF NOT EXISTS "memory_chunks_embedding_cache_id_idx" ON "memory_chunks"("embedding_cache_id");

CREATE TABLE IF NOT EXISTS "memory_index_states" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "memory_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "last_content_hash" TEXT,
  "last_indexed_at" DATETIME,
  "last_error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "embedding_provider" TEXT,
  "embedding_model" TEXT,
  "embedding_version" TEXT,
  "embedding_dimensions" INTEGER,
  "vector_mode" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_index_states_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "memory_index_states_memory_id_key" ON "memory_index_states"("memory_id");
CREATE INDEX IF NOT EXISTS "memory_index_states_agent_id_status_idx" ON "memory_index_states"("agent_id", "status");

CREATE TABLE IF NOT EXISTS "embedding_cache" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "content_hash" TEXT NOT NULL,
  "normalized_content" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "embedding" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "embedding_cache_content_hash_provider_model_version_dimensions_key" ON "embedding_cache"("content_hash", "provider", "model", "version", "dimensions");

CREATE TABLE IF NOT EXISTS "memory_index_metadata" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "index_name" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL DEFAULT 'global',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "details" TEXT NOT NULL DEFAULT '{}',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "memory_index_metadata_index_name_scope_key_key" ON "memory_index_metadata"("index_name", "scope_key");

CREATE TABLE IF NOT EXISTS "memory_recall_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "agent_id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "query" TEXT,
  "retrieval_mode" TEXT NOT NULL,
  "candidate_counts" TEXT NOT NULL DEFAULT '{}',
  "selected_keys" TEXT NOT NULL DEFAULT '[]',
  "omitted_keys" TEXT NOT NULL DEFAULT '[]',
  "selected_count" INTEGER NOT NULL DEFAULT 0,
  "omitted_count" INTEGER NOT NULL DEFAULT 0,
  "estimated_tokens" INTEGER NOT NULL DEFAULT 0,
  "details" TEXT NOT NULL DEFAULT '{}',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_recall_logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "memory_recall_logs_agent_id_created_at_idx" ON "memory_recall_logs"("agent_id", "created_at");
