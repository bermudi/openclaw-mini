CREATE TABLE IF NOT EXISTS "outbound_deliveries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channelKey" TEXT NOT NULL,
    "targetJson" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "lastError" TEXT,
    "sentAt" DATETIME,
    "externalMessageId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "outbound_deliveries_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "outbound_deliveries_status_nextAttemptAt_createdAt_idx" ON "outbound_deliveries"("status", "nextAttemptAt", "createdAt");
CREATE INDEX IF NOT EXISTS "outbound_deliveries_taskId_idx" ON "outbound_deliveries"("taskId");
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_deliveries_dedupeKey_key" ON "outbound_deliveries"("dedupeKey");
