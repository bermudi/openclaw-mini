-- AddIndex: Memory(agentId, category) for getAgentMemories confidence-ordered queries
CREATE INDEX "memories_agentId_category_idx" ON "memories"("agentId", "category");

-- AddIndex: MemoryIndexState(status) for getPendingIndexStates which filters by status alone
CREATE INDEX "memory_index_states_status_idx" ON "memory_index_states"("status");
