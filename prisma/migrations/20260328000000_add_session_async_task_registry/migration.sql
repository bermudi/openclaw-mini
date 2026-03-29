-- Add asyncTaskRegistry JSON column to sessions table for durable async subagent tracking
ALTER TABLE "sessions" ADD COLUMN "asyncTaskRegistry" TEXT;
