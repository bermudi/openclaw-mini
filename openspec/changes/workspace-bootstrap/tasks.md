## 1. Workspace Service

- [ ] 1.1 Create `src/lib/services/workspace-service.ts` with `BootstrapConfig` type, `BOOTSTRAP_FILES` ordered list, and `loadBootstrapContext()` function that reads files from `data/workspace/`, applies per-file (20K) and total (150K) character caps, and returns a formatted prompt string
- [ ] 1.2 Add `loadHeartbeatContext()` function that reads `HEARTBEAT.md` separately (not part of the standard bootstrap sequence)
- [ ] 1.3 Add `initializeWorkspace()` function that creates `data/workspace/` with default files (IDENTITY.md, SOUL.md, USER.md, AGENTS.md, TOOLS.md) only if the directory is empty or missing

## 2. System Prompt Integration

- [ ] 2.1 Update `AgentExecutor.getSystemPrompt()` to call `loadBootstrapContext()` and inject workspace content, replacing the hardcoded persona string
- [ ] 2.2 Update `AgentExecutor.getSystemPrompt()` to inject `loadHeartbeatContext()` only when `task.type === 'heartbeat'`
- [ ] 2.3 Update `AgentExecutor.buildPrompt()` to no longer duplicate memory context that would now come from `MEMORY.md` in the workspace

## 3. Default Workspace Files

- [ ] 3.1 Create `data/workspace/` directory with default `IDENTITY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`, and `TOOLS.md` files committed to the repo
- [ ] 3.2 Add a startup call to `initializeWorkspace()` (in the app initialization path or a layout/route bootstrap)

## 4. Workspace API

- [ ] 4.1 Create `src/app/api/workspace/route.ts` with GET handler that lists all `.md` files in `data/workspace/` with names and sizes, and supports `?file=<name>` query param to read a specific file's content
- [ ] 4.2 Add PUT handler to the workspace route that writes content to a specified file, with path traversal prevention (reject filenames containing `/`, `..`, or non-.md extensions)

## 5. Tests & Verification

- [ ] 5.1 Write tests for `loadBootstrapContext()`: all files present, some missing, empty files skipped, per-file truncation, total cap enforcement, correct ordering
- [ ] 5.2 Write tests for `initializeWorkspace()`: creates defaults on empty dir, skips when files exist, creates directory if missing
- [ ] 5.3 Write tests for workspace API: list files, read file, update file, path traversal rejection
- [ ] 5.4 Manual verification: edit `SOUL.md` to change persona, send a message, confirm agent reflects the new persona
