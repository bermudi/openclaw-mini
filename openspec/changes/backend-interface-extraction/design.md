## Context

The exec-runtime-overhaul design introduces isolation backends (Landlock, Firejail, Docker, Podman) but does not define a typed contract. Each backend implementation currently handles launch, mount mapping, capability detection, and cleanup differently. This makes it impossible to:
- Test backend selection logic without spawning actual processes
- Reason about capability coverage across backends
- Add new backends without duplicating boilerplate
- Provide consistent error messages when backends are unavailable

The backend interface extraction creates a typed `IsolationBackend<T>` contract that all implementations satisfy, enabling dependency injection for testing and a uniform runtime pipeline.

## Goals / Non-Goals

**Goals:**
- Typed interface contract that all backends implement
- Capability reporting so the runtime can surface which backends are available and what they support
- Uniform launch/cleanup lifecycle across all backends
- Mount validation protocol that respects backend constraints
- Security profile mapping (`sandbox` vs `isolated`) per backend
- Graceful error handling with actionable messages

**Non-Goals:**
- Implementing any backend (they exist in the codebase; this is an interface extraction)
- Runtime process supervision (handled by exec-process-control spec)
- Persistent session state across restarts
- Windows backend parity

## Decisions

### Decision 1: `IsolationBackend<T>` interface with mandatory and optional operations

Every backend MUST implement:
- `readonly id: BackendId` - unique identifier (`landlock`, `firejail`, `docker`, `podman`, `none`)
- `launch(cfg: LaunchConfig): Promise<LaunchResult>` - launch a command
- `cleanup(sessionId: string): Promise<void>` - release resources
- `detectCapabilities(): BackendCapabilities` - synchronous capability probe

Backends MAY implement:
- `validateMounts(mounts: Mount[]): ValidationResult` - pre-launch mount validation
- `getSecurityConstraints(profile: SecurityProfile): SecurityConstraints` - return constraints for a profile

```typescript
type BackendId = 'landlock' | 'firejail' | 'docker' | 'podman' | 'none';

interface BackendCapabilities {
  backendId: BackendId;
  isAvailable: boolean;
  supportedFilesystemRestrictions: FsRestriction[];
  supportedNetworkingRestrictions: NetRestriction[];
  supportsReadOnlyMounts: boolean;
  supportsReadWriteMounts: boolean;
  supportsTmpfs: boolean;
  maxMounts?: number;
  resourceLimits: ResourceLimits;
}

interface LaunchConfig {
  command: string;
  args: string[];
  mounts: Mount[];
  profile: SecurityProfile;
  env: Record<string, string>;
  cwd?: string;
  sessionId: string;
}

interface LaunchResult {
  sessionId: string;
  pid?: number;
  containerId?: string;
  pty?: PtyConfig;
}

interface Mount {
  alias: string;
  hostPath: string;
  permissions: 'read-only' | 'read-write';
  createIfMissing?: boolean;
}

type SecurityProfile = 'sandbox' | 'isolated';

interface SecurityConstraints {
  readonly noNewPrivileges: boolean;
  readonly readOnlyRootfs: boolean;
  readonly maskedPaths: string[];
  readonly readonlyPaths: string[];
  readonly memoryLimit?: number;
  readonly cpuShares?: number;
  readonly networkMode: NetworkMode;
}

type NetworkMode = 'none' | 'bridge' | 'host';
```

**Rationale**: Mandatory operations ensure a minimum viable contract. Optional operations allow backends to expose backend-specific validation without forcing implementations for backends that cannot perform certain validations (e.g., `none` backend cannot validate mounts).

**Alternative considered**: Single interface with all methods required. Rejected because `none` backend (used for `direct` tier) cannot implement mount validation or security constraints—requiring these would force no-op implementations that obscure intent.

### Decision 2: Synchronous capability detection

`detectCapabilities()` is synchronous. It probes the system state without spawning processes or making external calls. Each backend implementation:
- Landlock: checks `/sys/kernel/security/landlock` and kernel version >= 5.13
- Firejail: checks for `firejail` binary on PATH
- Docker: checks `docker` binary on PATH and `docker info` socket accessibility
- Podman: checks `podman` binary on PATH and socket accessibility
- None: returns `isAvailable: true` with minimal restrictions

**Rationale**: Synchronous detection enables backend selection at startup and at runtime without async hazards. Async detection would complicate the initialization pipeline.

**Alternative considered**: Async detection with capability caching. Rejected for v1 because all backends can be detected synchronously via filesystem checks or binary presence. Async would add complexity without benefit until we encounter a backend requiring network calls for detection.

### Decision 3: Capability-driven tier resolution

The runtime does not hardcode backend-to-tier mappings. Instead:
1. `detectCapabilities()` returns all available backends with their restrictions
2. Tier resolution accepts a `BackendPreference` (`auto` | `BackendId[]`) and returns the best available backend
3. Each backend maps `SecurityProfile` to its own constraint model via `getSecurityConstraints()`

```typescript
type BackendPreference = 
  | { mode: 'auto'; order: BackendId[] }
  | { mode: 'explicit'; backends: BackendId[] };

function resolveBackend(
  preference: BackendPreference,
  tier: SecurityProfile,
  capabilities: BackendCapabilities[]
): BackendId;
```

**Rationale**: This separates concerns: backends report what they can do; the resolver decides which backend to use given preferences and tier requirements. New backends integrate by implementing the interface without modifying tier resolution logic.

**Alternative considered**: Hardcoded tier-to-backend mapping. Rejected because `auto` mode requires dynamic resolution, and explicit mapping obscures why a particular backend was selected.

### Decision 4: Mount validation is pre-launch, not launch-time

Before launching, the runtime calls `validateMounts()` if the backend exposes it. Validation:
- Checks that required mounts are supported (e.g., Docker may reject certain host paths)
- Checks mount count against `maxMounts`
- Returns detailed errors for each invalid mount

If validation fails, launch is rejected before spawning any process.

**Rationale**: Validation at launch time (inside `launch()`) creates ambiguity: did the command fail to start due to mount issues, or due to something else? Pre-launch validation separates concerns and enables precise error reporting.

**Alternative considered**: Inline validation inside `launch()`. Rejected because errors become muddled and tests cannot validate without spawning processes.

### Decision 5: `none` backend is the `direct` tier implementation

The `none` backend implements `IsolationBackend` but returns `isAvailable: true` with minimal capabilities:
- No filesystem restrictions
- No networking restrictions
- No resource limits

It is used exclusively when `tier === 'direct'`. It does not validate mounts (direct tier can access any path) and does not enforce constraints.

**Rationale**: Using a single interface for both isolated and direct execution simplifies the runtime pipeline. The `none` backend is a legitimate implementation that happens to impose no restrictions.

### Decision 6: Error messages encode missing capabilities

When a backend is unavailable or cannot satisfy a launch request, the error message includes:
- Which backend was requested
- Why it is unavailable (missing binary, kernel support, permissions)
- What capability is missing
- Suggested remediation (e.g., "install firejail", "enable Landlock in kernel config")

```typescript
class BackendUnavailableError extends Error {
  constructor(
    public readonly backendId: BackendId,
    public readonly reason: 'binary-not-found' | 'kernel-unsupported' | 'permission-denied' | 'socket-inaccessible',
    public readonly suggestion: string
  ) {}
}
```

**Rationale**: Actionable errors reduce debugging friction. A user who requests `isolated` tier and gets "backend unavailable" without context cannot self-serve.

## Risks / Trade-offs

- **[Risk] Backend implementations may drift from interface** → Mitigation: interface tests that verify all mandatory methods exist and have correct signatures; integration tests spawn each backend and verify behavior
- **[Risk] Capability detection may miss runtime state changes** (e.g., Docker daemon restart) → Mitigation: re-detect capabilities on each launch; cache with 30-second TTL
- **[Risk] `getSecurityConstraints()` may return inconsistent constraints across backends** → Mitigation: document minimum guarantees for each `SecurityProfile`; backends must meet or exceed minimum
- **[Trade-off] Synchronous detection blocks startup** → Acceptable because detection is fast (filesystem checks only); async detection adds complexity without v1 benefit

## Open Questions

- Should backends expose a `version` field so the runtime can warn on known-bad backend versions?
- Do we need a `dryRun` method for validating configs without launching?
- Should `isolated` profile have a minimum resource guarantee across all backends (e.g., memory floor)?
