## REMOVED Requirements

### Requirement: Deprecated fallback environment variable compatibility
**Reason**: Fallback configuration now lives only in `openclaw.json` via `agent.fallbackProvider` and `agent.fallbackModel`.
**Migration**: Move any `AI_FALLBACK_MODEL` usage to `openclaw.json`.
