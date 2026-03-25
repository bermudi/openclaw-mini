# Command Execution and Sandboxing Approaches: A Comprehensive Comparison

> Analysis of 8 AI agent framework projects in the_claws ecosystem
> Generated: 2026-03-24 | Updated: 2026-03-24 (v1.2 - Host/Sandbox Execution Added)

## Executive Summary

This document compares how different AI agent frameworks handle three critical challenges:
1. **Command execution and sandboxing** - How safely commands are isolated and executed
2. **Host vs Sandbox execution modes** - Whether commands can run directly on the host or are forced through isolation
3. **Long-running and interactive process handling** - How frameworks manage background jobs, PTY support, and process lifecycle

Each project takes a different approach, ranging from pure application-layer controls to sophisticated multi-layered isolation, from always-host to always-containerized execution, and from batch-only execution to full interactive terminal support.

### Quick Reference Matrix

| Project | Language | Sandbox Type | Host Execution | Approval System | Network Isolation | Resource Limits | PTY Support |
|---------|----------|--------------|-----------------|-----------------|-------------------|----------------|-------------|
| **IronClaw** | Rust | Docker + WASM | Optional (FullAccess policy) | None | HTTP Proxy | Yes | ❌ |
| **MicroClaw** | Rust | Docker/Podman | Yes (default: Off) | None | Optional | Yes | ❌ |
| **NanoBot** | Python | Docker Only | Yes (always) | None | SSRF Protection | Yes | ❌ |
| **NanoClaw** | TypeScript | Docker Only | No (always containerized) | None | No | No | ❌ |
| **OpenClaw** | TypeScript | Docker | Yes (configurable) | Interactive Yes | Optional | Yes | ✅ |
| **OpenFang** | Rust | Docker + WASM | Yes (default: Off) | Human Approval | Yes | Yes | ❌ |
| **PicoClaw** | Go | None | Yes (always) | External Hooks | No | Timeout Only | ❌ |
| **ZeroClaw** | Rust | Landlock/Firejail/Bubblewrap/Docker | Yes (default: native) | Supervised | Yes | Yes | ❌ |

---

## Host vs Sandbox Execution Modes

A critical security dimension is whether commands execute directly on the host system or are forced through a sandbox. This distinction determines the attack surface and potential damage from compromised agents.

### Execution Mode Summary

| Project | Default Mode | Can Run on Host? | Can Force Sandbox? | Configuration |
|---------|--------------|------------------|-------------------|--------------|
| **IronClaw** | Sandbox (WorkspaceWrite) | ✅ Yes (FullAccess policy) | ✅ Yes (policy-based) | `SANDBOX_ALLOW_FULL_ACCESS` env var |
| **MicroClaw** | Host (Off) | ✅ Yes (default) | ✅ Yes (mode: "all") | `sandbox.mode` config |
| **NanoBot** | Host | ✅ Yes (always) | ❌ No (Docker for infra only) | No option |
| **NanoClaw** | Container | ❌ No (always containerized) | N/A | Architecture-enforced |
| **OpenClaw** | Configurable | ✅ Yes | ✅ Yes | `PI_BASH_SANDBOX` config |
| **OpenFang** | Host (Off) | ✅ Yes (default) | ✅ Yes (mode: "all"/"non_main") | `docker_sandbox.mode` config |
| **PicoClaw** | Host | ✅ Yes (always) | ❌ No | No sandbox option |
| **ZeroClaw** | Host (native) | ✅ Yes (default) | ✅ Yes (runtime: "docker") | `runtime` config |

### Key Findings

**Always Containerized (Most Secure):**
- **NanoClaw**: Architecture enforces containerization - agents always run in Docker containers with no option for host execution

**Host Execution by Default:**
- **MicroClaw**: `sandbox.mode: "off"` (default) - executes on host unless explicitly configured
- **NanoBot**: No sandbox mode for commands - always executes directly via `asyncio.create_subprocess_shell()`
- **OpenFang**: `DockerSandboxMode::Off` (default) - direct execution unless sandbox enabled
- **PicoClaw**: No containerization option - always host execution
- **ZeroClaw**: `native` runtime (default) - direct process execution

**Configurable Sandbox:**
- **IronClaw**: Policy-based with `ReadOnly`, `WorkspaceWrite`, and `FullAccess` modes
- **MicroClaw**: Three modes - `Off` (host), `All` (sandbox), `Auto` (fallback)
- **OpenClaw**: Per-execution sandbox choice
- **OpenFang**: `Off`, `NonMain`, `All` modes
- **ZeroClaw**: Multiple runtime options including native, Docker, Landlock, Firejail, Bubblewrap

### Security Implications

| Risk | Host Execution | Sandbox Execution |
|------|----------------|-------------------|
| **Container breakout** | N/A | Possible (CVEs in Docker runtime) |
| **Host filesystem access** | Full access (subject to app-level controls) | Limited to mounted volumes |
| **Network access** | Direct | Can be restricted/proxied |
| **Credential leakage** | Environment variables exposed | Can be filtered/injected by proxy |
| **Process isolation** | None | Strong (Linux namespaces) |
| **Resource exhaustion** | Affects entire host | Container-limited |

### Project-by-Project Execution Mode Details

#### IronClaw - Policy-Based Sandbox Control

**Location:** `src/sandbox/mod.rs`

```rust
pub enum SandboxPolicy {
    ReadOnly,        // Read workspace, proxied network
    WorkspaceWrite,  // Read/write workspace, proxied network
    FullAccess,      // Full host, full network (no sandbox)
}
```

**Host Execution Control:**
- `FullAccess` policy bypasses sandbox entirely
- Double-checked with `SANDBOX_ALLOW_FULL_ACCESS` environment variable
- Explicit opt-in required for host execution

**Source:** `src/sandbox/manager.rs:210-218`
```rust
// FullAccess policy bypasses the sandbox entirely.
// Double-check the allow_full_access guard at execution time as well,
// in case the policy was overridden per-call via execute_with_policy().
```

---

#### MicroClaw - Optional Container Sandbox

**Location:** `crates/microclaw-tools/src/sandbox.rs`

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SandboxMode {
    Off,   // Execute on host (default)
    All,   // All commands through Docker/Podman
    Auto,  // Fallback to host if runtime unavailable
}
```

**Default Behavior:** `sandbox.mode: "off"` - executes on host

**Configuration:** `microclaw.config.yaml`
```yaml
sandbox:
  mode: "off"  # or "all" or "auto"
  backend: "auto"  # or "docker" or "podman"
  security_profile: "hardened"  # or "standard" or "privileged"
  no_network: true
  require_runtime: true
```

**Fallback Behavior:** When `mode: "all"` but Docker unavailable:
- If `require_runtime: false` - falls back to host with warning
- If `require_runtime: true` - fails execution

---

#### NanoBot - Host-Only Execution

**Primary Implementation:** `nanobot/agent/tools/shell.py`

```python
process = await asyncio.create_subprocess_shell(
    command,
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
    cwd=cwd,
    env=env,
)
```

**No Sandbox Mode:** Commands always execute directly on host via subprocess

**Docker Usage:** Docker is only used for infrastructure deployment, not for command execution sandboxing

**Security:** Relies entirely on application-level controls (deny patterns, SSRF protection, workspace restrictions)

---

#### NanoClaw - Always Containerized

**Architecture:** Agents always run in isolated Docker containers

**Location:** `src/container-runner.ts`

**Container Isolation:**
```typescript
const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, {
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

**No Host Execution Option:** Architecture enforces containerization with no override

**Read-Only Project Root:** Main group's project root mounted read-only to prevent modification of host application code

**Source:** `docs/SECURITY.md`
> "Read-Only Project Root: The main group's project root is mounted read-only. This prevents the agent from modifying host application code (src/, dist/, package.json, etc.) which would bypass the sandbox entirely on next restart."

---

#### OpenClaw - Configurable Sandbox Option

**Location:** `src/agents/bash-tools.exec-runtime.ts`

**Execution Modes:**
- Sandbox mode: Commands run in Docker containers with security hardening
- Host mode: Commands run directly on the host with additional validation

**Configuration:** `PI_BASH_SANDBOX` and related settings

**Host Execution Controls:**
- Environment variable filtering more strict for host execution
- PATH modification blocked on host
- Additional validation before allowing host execution

---

#### OpenFang - Optional Docker Sandbox

**Location:** `crates/openfang-types/src/config.rs:897-902`

```rust
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DockerSandboxMode {
    #[default]
    Off,      // Direct execution (no sandbox)
    NonMain,  // Sandbox for non-main channels only
    All,      // All commands sandboxed
}
```

**Default:** `Off` - direct host execution

**Shell Execution:** Uses `Command::new(command).args(&args)` without shell to prevent injection

**Source:** `crates/openfang-runtime/src/tool_runner.rs:1472-1474`
```rust
// In Allowlist mode (default): Use direct execution via shlex argv splitting.
// This avoids invoking a shell interpreter, which eliminates an entire class
// of injection attacks (encoding tricks, $IFS, glob expansion, etc.).
```

---

#### PicoClaw - Host-Only Execution

**Primary Implementation:** `pkg/tools/shell.go`

```go
cmd := exec.CommandContext(cmdCtx, "sh", "-c", command)  // Unix
cmd := exec.CommandContext(cmdCtx, "powershell", "-NoProfile", "-NonInteractive", "-Command", command)  // Windows
```

**No Sandbox Option:** No containerization or sandbox mode available

**Security:** Relies on application-layer controls:
- Regex-based deny patterns
- Workspace restrictions
- Channel-based access control
- External hook system for approvals

**Portuguese Docs Warning:** `docs/pt-br/tools_configuration.md:132`
> "Isso significa que o guarda é útil para bloquear comandos diretos obviamente perigosos, mas **não** é um sandbox completo para pipelines de build não revisados. Se seu modelo de ameaça inclui código não confiável no workspace, use isolamento mais forte, como contêineres, VMs ou um fluxo de aprovação em torno de comandos de build e execução."

(Translation: "This means the guard is useful for blocking obviously dangerous direct commands, but **not** a complete sandbox for unreviewed build pipelines. If your threat model includes untrusted code in the workspace, use stronger isolation like containers, VMs, or an approval workflow around build and exec commands.")

---

#### ZeroClaw - Native Runtime with Optional Sandbox

**Location:** `src/runtime/native.rs`

```rust
pub struct NativeRuntime;

impl RuntimeAdapter for NativeRuntime {
    fn name(&self) -> &str {
        "native"
    }

    fn has_shell_access(&self) -> bool {
        true
    }

    fn has_filesystem_access(&self) -> bool {
        true
    }
}
```

**Default Runtime:** `native` - direct process execution on host

**Documentation:** `README.md:391`
```markdown
- **`native`** (default) — direct process execution, fastest path, ideal for trusted environments.
- **`docker`** — full container isolation, enforced security policies, requires Docker.
```

**Optional Sandboxing:**
- Landlock (Linux 5.13+)
- Firejail (user-space sandboxing)
- Bubblewrap (user namespace sandbox)
- Docker (container isolation)

**Security Layers:**
- Application-level (allowlist, path restrictions)
- Optional OS-level sandboxing
- Supervision modes (ReadOnly, Supervised, Full)

---

### Comparative Analysis: Host vs Sandbox

#### Host Execution - Advantages & Disadvantages

**Advantages:**
- Faster execution (no container overhead)
- Direct access to host resources
- Simpler debugging
- No Docker dependency

**Disadvantages:**
- Full host filesystem access (subject only to app-level controls)
- Direct network access (harder to intercept/filter)
- Credentials in environment variables visible to process
- No resource isolation
- Process can affect entire host system

#### Sandbox Execution - Advantages & Disadvantages

**Advantages:**
- Strong filesystem isolation (only mounted volumes accessible)
- Network can be restricted/proxied/monitored
- Credentials can be filtered/injected by proxy
- Resource limits enforced (CPU, memory, PIDs)
- Process isolation via Linux namespaces
- Easier cleanup (container removal)

**Disadvantages:**
- Container startup overhead
- Docker/container runtime dependency
- More complex debugging
- Potential for container breakout vulnerabilities
- May not work in all environments

---

### Recommendations for Choosing Execution Mode

| Use Case | Recommended Approach | Projects That Support It |
|----------|---------------------|--------------------------|
| **Trusted local development** | Host execution (fastest) | All except NanoClaw |
| **Untrusted code/inputs** | Mandatory sandbox | NanoClaw, OpenClaw, OpenFang, IronClaw |
| **CI/CD pipelines** | Configurable sandbox | IronClaw, MicroClaw, OpenClaw, OpenFang, ZeroClaw |
| **Production deployment** | Sandbox with strict policies | IronClaw (WorkspaceWrite), OpenFang (All) |
| **Multi-tenant environments** | Always containerized | NanoClaw (enforced) |
| **Resource-constrained environments** | Host with native sandboxing | ZeroClaw (Landlock/Firejail) |

---

## Project-by-Project Analysis

## 1. IronClaw (Rust)

### Command Execution Architecture

**Primary Implementation:** `src/tools/builtin/shell.rs`

**Shell:** Native bash execution through process spawning

### Security Layers

#### 1.1 Command Validation Pipeline

```rust
// Three-stage validation:
// 1. Exact pattern matching (BLOCKED_COMMANDS)
// 2. Substring dangerous patterns (DANGEROUS_PATTERNS)
// 3. Injection detection (detect_command_injection)
```

**Blocked Commands:**
- `rm -rf /`, `:(){ :|:& };:` (fork bomb)
- `dd if=/dev/zero`, `mkfs`
- `curl | sh`, `wget | bash`

**Risk Classification:**
- Low: Read-only (ls, cat, grep)
- Medium: Reversible mutations (mkdir, cp, git)
- High: Destructive/irreversible (rm -rf, DROP TABLE)

#### 1.2 Docker Sandbox

**Location:** `src/sandbox/`

**Sandbox Policies:**
```rust
pub enum SandboxPolicy {
    ReadOnly,        // Read-only workspace, proxied network
    WorkspaceWrite,  // Read-write workspace, proxied network
    FullAccess,      // No sandbox (requires double opt-in)
}
```

**Container Security:**
- All capabilities dropped except CHOWN
- No-new-privileges flag
- Read-only root filesystem
- Tmpfs for /tmp and cargo cache
- Non-root user (1000:1000)

#### 1.3 HTTP Proxy for Network Control

**Location:** `src/sandbox/proxy/`

**Features:**
- Domain allowlist enforcement
- Credential injection (API keys never exposed to containers)
- Request logging

**Default Allowlist:**
```
crates.io, registry.npmjs.org, pypi.org, github.com
api.openai.com, api.anthropic.com, api.near.ai
```

#### 1.4 WASM Sandbox Alternative

**Location:** `src/tools/wasm/`

**Resource Limits:**
- Memory limits
- Fuel metering (CPU instruction limits)
- Timeout protection
- Max output bytes

### Environment Handling

**Safe Environment Variables Only:**
```rust
const SAFE_ENV_VARS: &[&str] = &[
    "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "PWD",
    "TMPDIR", "CARGO_HOME", "EDITOR", "VISUAL"
    // ... carefully curated list
];
```

### Unique Features

1. **Credential Proxy:** API keys injected at HTTP layer, never in environment
2. **Multi-layer sandboxing:** Docker + HTTP proxy + WASM option
3. **Orchestrator for persistent jobs**
4. **AES-256-GCM encrypted secrets storage**

### Security Assessment

**Strengths:**
- Multiple independent security layers
- Strong network isolation through proxy
- Secret protection through credential injection
- Fuel metering in WASM prevents infinite loops

**Concerns:**
- No user approval workflow (fully automated)
- Complex architecture increases attack surface

---

## 2. MicroClaw (Rust)

### Command Execution Architecture

**Primary Implementation:** `src/tools/bash.rs`

**Shell:** Native bash through process spawning

### Security Layers

#### 2.1 Path Protection System

**Location:** `crates/microclaw-tools/src/path_guard.rs`

**Blocked Directories:**
```
.ssh, .aws, .gnupg, .kube
```

**Blocked Files:**
```
.env, .env.local, .credentials.json
id_rsa, id_ed25519, .netrc, .npmrc
```

**Blocked Absolute Paths:**
```
/etc/shadow, /etc/gshadow, /etc/sudoers
```

**Symlink Validation:** Checks each path component to prevent symlink attacks

#### 2.2 Sandbox System

**Location:** `crates/microclaw-tools/src/sandbox.rs`

**Modes:** Off, All, Auto

**Backends:** Docker (default), Podman, None

**Security Profiles:**
- **Hardened:** `--cap-drop ALL --security-opt no-new-privileges`
- **Standard:** Docker defaults
- **Privileged:** Full access (debug only)

#### 2.3 Execution Policies

```rust
pub enum ToolExecutionPolicy {
    HostOnly,      // Execute on host only
    SandboxOnly,   // Require sandbox
    Dual,          // Can run in either
}

// bash → Dual
// write_file → HostOnly
```

### Environment Handling

**Features:**
- Automatic loading from `.env` files
- Secret redaction in output (masks values >8 chars)
- No API key passthrough by default

### Unique Features

1. **Working Directory Isolation:** Shared vs Chat-specific modes
2. **Per-skill environment files**
3. **Subagent restrictions:** No recursive bash execution

### Security Assessment

**Strengths:**
- Comprehensive path blocking for sensitive directories
- Symlink attack prevention
- Flexible sandbox modes
- Environment secret redaction

**Concerns:**
- No user approval system
- Sandbox disabled by default
- No network isolation unless configured

---

## 3. NanoBot (Python)

### Command Execution Architecture

**Primary Implementation:** `nanobot/agent/tools/shell.py`

**Shell:** `asyncio.create_subprocess_shell()`

### Security Layers

#### 3.1 Command Guarding System

**Deny Patterns:**
```python
self.deny_patterns = [
    r"\brm\s+-[rf]{1,2}\b",
    r"\bdd\s+if=",
    r">\s*/dev/sd",
    r"\b(shutdown|reboot|poweroff)\b",
    r":\(\)\s*\{.*\};\s*:",  # Fork bomb
]
```

#### 3.2 Network Security (SSRF Protection)

**Location:** `nanobot/security/network.py`

**Blocked Networks:**
```
0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10
127.0.0.0/8, 169.254.0.0/16 (cloud metadata)
172.16.0.0/12, 192.168.0.0/16
::1/128, fc00::/7, fe80::/10
```

#### 3.3 Workspace Restriction

**Path Traversal Detection:**
```python
if "..\\" in cmd or "../" in cmd:
    return "Error: Command blocked (path traversal detected)"
```

**Directory Boundary Enforcement:**
```python
if p.is_absolute() and cwd_path not in p.parents and p != cwd_path:
    return "Error: Command blocked (path outside working dir)"
```

### Environment Handling

```python
env = os.environ.copy()
if self.path_append:
    env["PATH"] = env.get("PATH", "") + os.pathsep + self.path_append
```

**Note:** No environment variable scrubbing (documented limitation)

### Resource Limits

- Default timeout: 60 seconds
- Maximum timeout: 600 seconds
- Output truncation: 10KB limit

### Docker Containerization

**Location:** `docker-compose.yml`

```yaml
deploy:
  resources:
    limits:
      cpus: '1'
      memory: 1G
```

### Known Limitations (from SECURITY.md)

1. No rate limiting
2. Plain text config
3. No session management
4. Limited command filtering
5. No audit trail

### Security Assessment

**Strengths:**
- Async execution prevents blocking
- SSRF protection for private networks
- Workspace boundary enforcement
- Resource limiting through Docker

**Concerns:**
- No kernel-level sandboxing (no namespaces, seccomp)
- No environment variable filtering
- Relies solely on application-level controls
- Documented security limitations

---

## 4. NanoClaw (TypeScript)

### Command Execution Architecture

**Primary Implementation:** `container/agent-runner/src/index.ts`

**Shell:** Claude Agent SDK Bash tool inside Docker containers

### Security Layers

#### 4.1 Container Sandboxing

**Location:** `src/container-runner.ts`

**User Isolation:**
- Runs as `node` user (UID 1000)
- User namespace mapping when available

**Mount Control:**
```typescript
const mounts = [
  {
    hostPath: projectRoot,
    containerPath: '/workspace/project',
    readonly: true,  // Read-only for main groups
  },
  {
    hostPath: groupDir,
    containerPath: '/workspace/group',
    readonly: false,  // Writable per-group space
  }
];
```

#### 4.2 Credential Isolation

**Location:** `src/credential-proxy.ts`

**API Key Mode:**
- Containers receive `ANTHROPIC_API_KEY=placeholder`
- Proxy injects real key via `x-api-key` header

**OAuth Mode:**
- Container exchanges placeholder token for real one

#### 4.3 Mount Security Module

**Location:** `src/mount-security.ts`

**External Allowlist:** `~/.config/nanoclaw/mount-allowlist.json`

**Blocked Patterns by Default:**
```
.ssh, .gnupg, .env, credentials
```

**Different permissions for main vs non-main groups**

#### 4.4 IPC Namespace Isolation

Per-group IPC directories prevent cross-group escalation:
```typescript
const groupIpcDir = resolveGroupIpcPath(group.folder);
mounts.push({
  hostPath: groupIpcDir,
  containerPath: '/workspace/ipc',
  readonly: false,
});
```

### Environment Handling

**Controlled Variables:**
- TZ (timezone)
- ANTHROPIC_BASE_URL (routed through proxy)

**Clean environment:** No shell access or system environment

### Resource Limits

- Container timeout: 30 minutes
- Idle timeout: 30 minutes
- Max output: 10MB
- Max concurrent: 5 containers

### Security Assessment

**Strengths:**
- Credential proxy never exposes real secrets
- Per-group filesystem isolation
- External allowlist system
- Non-root container execution

**Concerns:**
- No seccomp syscall filtering
- No resource limits (CPU/memory)
- Bash tool fully accessible within containers
- No network isolation between containers

---

## 5. OpenClaw (TypeScript)

### Command Execution Architecture

**Primary Implementation:** `src/agents/bash-tools.exec-runtime.ts`

**Shell:** Native bash with PTY support option

### Security Layers

#### 5.1 Docker Sandbox

**Location:** `src/agents/sandbox/`

**Security Features:**
```typescript
--read-only                    // Read-only root
--security-opt no-new-privileges
--cap-drop ALL                 // Drop all capabilities
seccomp profiles              // Syscall filtering
AppArmor profiles            // (optional)
```

**Blocked Paths:**
```
/etc, /proc, /sys, /dev, /root, /boot, /run
/var/run/docker.sock, /run/docker.sock
```

#### 5.2 Environment Sanitization

**Location:** `src/agents/sandbox/sanitize-env-vars.ts`

**Blocked Patterns:**
```typescript
/^ANTHROPIC_API_KEY$/i
/^OPENAI_API_KEY$/i
/_?(API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|SECRET)$/i
```

**Allowed Patterns:**
```typescript
/^LANG$/, /^LC_.*$/i, /^PATH$/i, /^HOME$/i
/^USER$/i, /^SHELL$/i, /^TERM$/i, /^TZ$/i
```

#### 5.3 Execution Approval System

**Location:** `src/infra/exec-approvals.ts`

**Security Levels:**
```typescript
type ExecSecurity = "deny" | "allowlist" | "full"
type ExecAsk = "off" | "on-miss" | "always"
```

**Approval Flow:**
1. Request creation with UUID
2. Policy evaluation
3. Interactive user approval
4. Decision storage for future reference

#### 5.4 Host Execution Security

**PATH blocking on host:**
```typescript
if (upperKey === "PATH") {
  throw new Error(
    "Custom 'PATH' variable is forbidden during host execution."
  );
}
```

### Configuration Defaults

- Default timeout: 120 seconds
- Approval timeout: 130 seconds
- Output limits: 200k chars aggregated, 30k pending
- Sandbox image: `debian:bookworm-slim`

### Security Principles

1. Defense in depth
2. Principle of least privilege
3. Fail secure (default deny)
4. Zero trust (all commands require approval unless whitelisted)
5. Complete audit trail

### Security Assessment

**Strengths:**
- Interactive approval system
- Comprehensive environment filtering
- Multiple security modes (deny/allowlist/full)
- Seccomp and AppArmor support
- Strong host execution controls

**Concerns:**
- Complex approval flow may affect usability
- Requires proper user training for effective use

---

## 6. OpenFang (Rust)

### Command Execution Architecture

**Multi-layered:** WASM, Docker, and Process-level sandboxing

### Security Layers

#### 6.1 WASM Sandbox

**Location:** `crates/openfang-runtime/src/sandbox.rs`

**Features:**
- CPU fuel metering (default: 1M instructions)
- Memory limits (default: 16MB)
- Timeout protection (default: 30s)
- Capability-based API dispatch

#### 6.2 Docker Sandbox

**Location:** `crates/openfang-runtime/src/docker_sandbox.rs`

**Security Measures:**
- All capabilities dropped (`--cap-drop ALL`)
- No-new-privileges
- Resource limits (memory, CPU, PIDs)
- Network isolation (`--network none`)
- Read-only root filesystem
- Container pooling

#### 6.3 Shell Metacharacter Protection

**Location:** `crates/openfang-runtime/src/subprocess_sandbox.rs`

```rust
pub fn contains_shell_metacharacters(command: &str) -> Option<String> {
    if command.contains('`') return Some("backtick");
    if command.contains("$(") return Some("$() substitution");
    if command.contains(';') return Some("semicolon chaining");
    // ... more checks
}
```

**Execution Modes:**
- Deny: Blocks all shell execution
- Allowlist: Only safe binaries
- Full: All commands (dev only)

**Safe Bins:**
```
sleep, true, false, cat, sort, uniq, cut, tr
head, tail, wc, date, echo, printf, basename, dirname, pwd, env
```

#### 6.4 Capability-Based Security

**Location:** `crates/openfang-types/src/capability.rs`

```rust
pub enum Capability {
    FileRead(String),
    FileWrite(String),
    NetConnect(String),
    ToolInvoke(String),
    ShellExec(String),
    EnvRead(String),
    // ... more
}
```

**Pattern Matching:**
- Wildcard: `*.openai.com:443`
- Prefix: `api*`
- Suffix matching
- Special `*` matches everything

#### 6.5 SSRF Protection

```rust
fn is_ssrf_target(url: &str) -> Result<(), serde_json::Value> {
    // Only http/https allowed
    // Block: localhost, metadata.google.internal
    // DNS resolution + private IP check
}
```

#### 6.6 Human Approval Gates

Critical tools require human approval:
```rust
if kh.requires_approval(tool_name) {
    match kh.request_approval(agent_id, tool_name, &summary).await {
        Ok(true) => proceed,
        Ok(false) => block,
    }
}
```

### Environment Handling

```rust
const SAFE_ENV_VARS: &[&str] = &[
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP"
    "LANG", "LC_ALL", "TERM"
];
```

### Security Features Summary

1. Defense in depth
2. Least privilege
3. Capability-based access
4. Fail-safe (deny by default)
5. Secure defaults
6. Runtime protections
7. Input validation
8. Audit and logging
9. Human oversight
10. Containment

### Security Assessment

**Strengths:**
- Most sophisticated security model
- Multiple independent sandboxing technologies
- Capability-based fine-grained permissions
- Human approval for sensitive operations
- Comprehensive SSRF protection

**Concerns:**
- High complexity
- May be over-engineered for simple use cases

---

## 7. PicoClaw (Go)

### Command Execution Architecture

**Primary Implementation:** `pkg/tools/shell.go`

**Shell:**
- Unix: `sh -c <command>`
- Windows: `powershell -NoProfile -NonInteractive`

### Security Layers

#### 7.1 Deny Patterns System

**Location:** `pkg/tools/shell.go` (lines 32-80)

```go
var defaultDenyPatterns = []*regexp.Regexp{
    regexp.MustCompile(`\brm\s+-[rf]{1,2}\b`),
    regexp.MustCompile(`\bdd\s+if=`),
    regexp.MustCompile(`\b(shutdown|reboot|poweroff)\b`),
    regexp.MustCompile(`\bsudo\b`),
    regexp.MustCompile(`\bchmod\s+[0-7]{3,4}\b`),
    regexp.MustCompile(`\bdocker\s+run\b`),
    regexp.MustCompile(`\bgit\s+push\b`),
    regexp.MustCompile(`\bssh\b.*@`),
    // ... many more
}
```

#### 7.2 Workspace Restriction

- `restrictToWorkspace` boolean flag
- Path validation in `validatePathWithAllowPaths()`
- Symlink resolution to prevent traversal

#### 7.3 Channel-Based Restrictions

**Location:** `pkg/constants/channels.go`

**Internal Channels Only:** `cli`, `system`, `subagent`

**External Channels Blocked:** Telegram, Discord, etc.

#### 7.4 Process Hook System

**Location:** `pkg/agent/hook_process.go`

- JSON-RPC based external approval
- Support for observing, intercepting, approving tool calls

### Environment Handling

- Environment variables inherited from parent
- No explicit sanitization
- DNS override available for Android

### Resource Limits

- Max output: 10,000 characters
- Read file limit: 64KB
- Default timeout: 60 seconds

### Configuration System

**Location:** `pkg/config/config.go`

```go
type ExecConfig struct {
    EnableDenyPatterns  bool     `json:"enable_deny_patterns"`
    AllowRemote         bool     `json:"allow_remote"`
    CustomDenyPatterns  []string `json:"custom_deny_patterns"`
    CustomAllowPatterns []string `json:"custom_allow_patterns"`
    TimeoutSeconds      int      `json:"timeout_seconds"`
}
```

### Security Assessment

**Strengths:**
- Comprehensive regex-based blocking
- Channel isolation (only trusted channels)
- External hook system for approvals
- Workspace confinement

**Concerns:**
- No containerization
- No privilege dropping
- No seccomp/AppArmor
- Environment variables inherited unsanitized
- Relies solely on application-layer controls

---

## 8. ZeroClaw (Rust)

### Command Execution Architecture

**Primary Implementation:** `src/tools/shell.rs`

**Shell:**
- Linux/macOS: `sh -c <command>`
- Windows: `cmd.exe /C <command>`

### Security Layers

#### 8.1 Security Policy

**Location:** `src/security/policy.rs`

**Autonomy Levels:**
```rust
enum AutonomyLevel {
    ReadOnly,      // Observe only
    Supervised,    // Act with approval for risky ops
    Full,          // Autonomous within policy
}
```

**Risk Assessment:**
- Low: Safe commands (ls, cat, echo)
- Medium: File operations (touch, rm, cp)
- High: Network ops (curl, wget, rm -rf)

#### 8.2 Command Allowlisting

**Default Unix Commands:**
```
git, npm, cargo, ls, cat, grep, find, echo, pwd
```

**Forbidden Paths:**
- Unix: `/etc`, `/root`, `/home`, `/usr`, `.ssh`, `.gnupg`, `.aws`
- Windows: `C:\Windows`, `C:\Windows\System32`, `C:\Program Files`

#### 8.3 Sandbox Backend System

**Location:** `src/security/traits.rs`

**Available Sandboxes:**

1. **Landlock** (Linux 5.13+)
   - Kernel-level LSM
   - Filesystem access control
   - Most secure native option

2. **Firejail**
   - User-space sandboxing
   - `--private=home --private-dev --nosound`

3. **Bubblewrap**
   - User namespace sandbox
   - `--ro-bind /usr --unshare-all`

4. **Docker**
   - Container isolation
   - 512MB memory, 1.0 CPU default
   - `--network none`

5. **NoopSandbox**
   - Application-layer only
   - Fallback when no sandbox available

**Auto-Detection Priority:**
```
Landlock → Firejail → Bubblewrap → Docker → Noop
```

#### 8.4 Environment Variable Filtering

**Safe Vars Only:**
- Unix: `PATH, HOME, TERM, LANG, LC_ALL, LC_CTYPE, USER, SHELL, TMPDIR`
- Windows: `PATH, PATHEXT, USERPROFILE, SYSTEMROOT, COMSPEC`

**No API keys passed to shell commands**

### Advanced Features

**Workspace Isolation:**
- Per-workspace tool restrictions
- Domain allowlists
- Cross-workspace access control

**Rate Limiting:**
- 20 actions per hour (configurable)
- 500 cents/day default cost tracking

**Audit Logging:**
- Security event recording
- Command execution logging
- Tool access tracking

### Security Assessment

**Strengths:**
- Multiple native sandbox options (Landlock, Firejail, Bubblewrap)
- Graceful degradation when sandboxes unavailable
- Autonomy levels for different use cases
- Comprehensive command allowlisting
- Rate limiting and cost tracking

**Concerns:**
- Multiple sandbox backends increase complexity
- No interactive approval system (supervision is pre-configured)

---

## Comparative Analysis

### Approaches to Sandboxing

| Project | Sandbox Technology | Depth of Isolation |
|---------|-------------------|-------------------|
| IronClaw | Docker + HTTP Proxy + WASM | Deep (container + network + code) |
| MicroClaw | Docker/Podman (optional) | Medium (container only) |
| NanoBot | Docker (resource limits only) | Shallow (container only) |
| NanoClaw | Docker + credential proxy | Medium (container + auth) |
| OpenClaw | Docker + seccomp/AppArmor | Deep (container + syscall) |
| OpenFang | Docker + WASM + capability system | Very Deep (multi-layer) |
| PicoClaw | None | Application-layer only |
| ZeroClaw | Landlock/Firejail/Bubblewrap/Docker | Deep (native OS options) |

### Approaches to Command Approval

| Project | Approval Mechanism | User Involvement |
|---------|-------------------|------------------|
| IronClaw | None | None (fully automated) |
| MicroClaw | None | None (fully automated) |
| NanoBot | None | None (fully automated) |
| NanoClaw | None | None (fully automated) |
| OpenClaw | Interactive approval per command | High |
| OpenFang | Human approval for sensitive tools | Medium |
| PicoClaw | External hook system (optional) | Configurable |
| ZeroClaw | Supervised autonomy levels | Pre-configured |

### Environment Variable Handling

| Project | Filtering | Secret Protection |
|---------|-----------|-------------------|
| IronClaw | Safe allowlist | Credential proxy |
| MicroClaw | Auto .env loading + redaction | Output redaction |
| NanoBot | None (documented limitation) | None |
| NanoClaw | Minimal + proxy | Credential proxy |
| OpenClaw | Comprehensive blocking | Blocked patterns |
| OpenFang | Safe allowlist | Capability-based |
| PicoClaw | None | None |
| ZeroClaw | Safe allowlist | No API keys passed |

### Network Isolation

| Project | Method | SSRF Protection |
|---------|--------|-----------------|
| IronClaw | HTTP Proxy + allowlist | Yes (proxy-level) |
| MicroClaw | Optional `no_network` | No |
| NanoBot | None (Docker only) | Yes (IP blocking) |
| NanoClaw | None | No |
| OpenClaw | Optional network modes | No |
| OpenFang | `--network none` + DNS checks | Yes (comprehensive) |
| PicoClaw | None | No |
| ZeroClaw | `--network none` (Docker) | Yes (via allowlist) |

### Resource Limiting

| Project | Memory | CPU | Timeout | Output Limit |
|---------|--------|-----|---------|--------------|
| IronClaw | Yes | Yes | Yes | Yes |
| MicroClaw | Optional | Optional | Yes | Yes |
| NanoBot | Yes (Docker) | Yes (Docker) | 60s default | 10KB |
| NanoClaw | No | No | 30 min | 10MB |
| OpenClaw | Yes | Yes | 120s default | 200k chars |
| OpenFang | Yes | Yes | Yes (30s WASM) | Yes |
| PicoClaw | No | No | 60s default | 10k chars |
| ZeroClaw | 512MB default | 1.0 default | 60s | 1MB |

---

## Long-Running and Interactive Process Handling

A critical dimension of command execution is how frameworks handle processes that:
1. Run for extended periods (background jobs, daemons)
2. Require interactive terminal access (PTY support)
3. Need persistent state across sessions
4. Must be properly tracked and cleaned up

### Quick Reference: Process Management Capabilities

| Project | PTY Support | Background Jobs | Process Tracking | Tree Killing | Idle Timeout |
|---------|-------------|-----------------|------------------|--------------|--------------|
| **IronClaw** | ❌ No | ✅ Containers | ✅ Job States | ✅ Graceful | ✅ Yes |
| **MicroClaw** | ❌ No | ✅ Subagents | ✅ Database | ✅ Container | ❌ No |
| **NanoBot** | ❌ No | ✅ Spawn Tool | ⚠️ In-memory | ❌ OS only | ⚠️ Heartbeat |
| **NanoClaw** | ❌ No | ✅ Containers | ✅ GroupQueue | ✅ Docker | ✅ 30min |
| **OpenClaw** | ✅ Yes | ✅ Supervisor | ✅ Registry | ✅ SIGTERM/KILL | ✅ Dual |
| **OpenFang** | ❌ No | ✅ ProcessManager | ✅ Per-Agent | ✅ Grace period | ✅ Yes |
| **PicoClaw** | ❌ No | ✅ Spawn Tool | ⚠️ Agent Loop | ✅ Process group | ❌ No |
| **ZeroClaw** | ❌ No | ⚠️ Native Only | ⚠️ Runtime | ✅ Platform-specific | ✅ Yes |

### Project-by-Project Analysis

#### IronClaw (Rust)

**Background Process Management:**
- **ContainerJobManager** (`src/orchestrator/job_manager.rs`): Persistent container-based job execution
- **Job State Machine:** `Pending → InProgress → Completed → Submitted → Accepted`
- **Recovery State:** `Stuck` for long processes that need recovery
- **SandboxReaper** (`src/orchestrator/reaper.rs`): Scans for orphaned containers every 5 minutes

**PTY Support:** ❌ None - uses `std::process::Command` with stdout/stderr pipes only

**Timeout Handling:**
- Multi-level: Tool-level → Container-level → Job-level
- Default container timeout: 5 minutes
- Docker `auto_remove: true` for cleanup

**Process Tree Handling:**
- Container labeling with job IDs for tracking
- SIGTERM for graceful shutdown, SIGKILL as fallback
- Orphan detection after 10 minutes threshold

**Unique Feature:** Dual job modes - Worker Mode (standard LLM-driven) and Claude Code Mode (direct CLI in container)

---

#### MicroClaw (Rust)

**Background Process Management:**
- **Subagent System** (`src/tools/subagents.rs`): Spawn with `sessions_spawn`, returns run ID immediately
- **Database Tracking:** All runs stored in `subagent_runs` table with timestamps
- **Scheduler** (`src/scheduler.rs`): Background task execution, runs every minute
- **Recovery:** Recovers running tasks from previous process restarts

**PTY Support:** ❌ None - `cmd.stdin(std::process::Stdio::null())`

**Timeout Handling:**
- Command default: 120 seconds
- Subagent `run_timeout_secs`: 1800 (30 minutes) default
- Token budget: 400,000 tokens max per run
- Max iterations: 16

**Process Lifecycle States:**
`accepted → queued → running → completed/cancelled/timed_out/failed`

**Process Tree Limits:**
- `max_children_per_run`: Limits spawned processes
- `max_spawn_depth`: Prevents infinite nesting (default 1, max 5)
- Container sandboxing prevents orphans

---

#### NanoBot (Python)

**Background Process Management:**
- **SpawnTool** (`nanobot/agent/tools/spawn.py`): Creates subagents with unique 8-char IDs
- **Heartbeat Service** (`nanobot/heartbeat/service.py`): Periodic wake-up (30 min default)
- **Message Bus Communication:** Results announced back to main agent
- **Task Cancellation:** Tasks tracked per session, can be cancelled

**PTY Support:** ❌ None - `asyncio.create_subprocess_shell()` with pipes only

**Timeout Handling:**
- Default: 60 seconds, Maximum: 600 seconds (10 minutes)
- Timeout triggers `process.kill()` with 5-second wait

**Process Tracking:**
```python
self._active_tasks: dict[str, list[asyncio.Task]] = {}
self._session_tasks: dict[str, set[str]] = {}
self._background_tasks: list[asyncio.Task] = []
```

**Signal Handling:**
- No explicit SIGTERM/SIGKILL handlers
- Uses asyncio cancellation mechanism
- Restart command uses `os.execv()` for full process restart

**Limitations:**
- No process tree management
- No orphan cleanup
- No stdin support (non-interactive only)

---

#### NanoClaw (TypeScript)

**Background Process Management:**
- **Container-based** architecture with `GroupQueue` (`src/group-queue.ts`)
- **Session Persistence:** Session IDs in SQLite, passed to Claude SDK
- **Concurrent Limits:** 5 containers per group default
- **Orphan Cleanup:** `cleanupOrphans()` in `src/container-runtime.ts`

**PTY Support:** ❌ None - stdio pipes only, container runs Node.js process

**Timeout Handling:**
- Container timeout: 30 minutes (configurable `CONTAINER_TIMEOUT`)
- Idle timeout: 30 minutes after last output (`IDLE_TIMEOUT`)
- Scheduled tasks: 10 seconds
- Grace period before SIGKILL: 15 seconds

**Process Tracking:**
- Each container tracked in `GroupQueue.groups` with metadata
- Hard timeout must be ≥ IDLE_TIMEOUT + 30s

**Signal Handling:**
```typescript
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// Graceful shutdown: proxy closed, queues drained, containers detached
```

**IPC for Streaming:**
- `MessageStream` class for push-based async iteration
- File polling: `/workspace/ipc/input/` for follow-up messages
- JSON wrapped in `---NANOCLAW_OUTPUT_START---` markers

---

#### OpenClaw (TypeScript)

**Background Process Management:**
- **Process Supervisor** (`src/process/supervisor/`): Comprehensive process lifecycle management
- **BashProcessRegistry** (`src/agents/bash-process-registry.ts`): Default 30-min TTL
- **Command Queue** (`src/process/command-queue.ts`): Lanes for parallel execution
- **States:** `starting → running → exiting → completed`

**PTY Support:** ✅ Yes - Uses `@lydell/node-pty` library
```typescript
const pty = spawn(params.shell, params.args, {
  name: params.name ?? "xterm-256color",
  cols: params.cols ?? 120,
  rows: params.rows ?? 30,
});
```

**Timeout Handling:**
- **Dual timeout system:**
  - `overallTimeoutMs`: Maximum execution time
  - `noOutputTimeoutMs`: Timeout if no output received
- SIGKILL on timeout

**Interactive I/O:**
- **Stdin modes:**
  - `inherit`: Pass through stdin (interactive)
  - `pipe-open`: Open pipe, no initial input
  - `pipe-closed`: Closed pipe (background)
- **Background execution:**
  - `yieldMs`: Auto-background after delay
  - `background`: Immediately background

**Process Tree Killing:**
```typescript
// Unix: SIGTERM to process group, then SIGKILL
kill -TERM -{pid}
// Windows: taskkill /T, then /F if needed
taskkill /T /PID {pid}
```
- Grace period: 3 seconds default, 60 seconds max

**Signal Handling:**
- Gateway: SIGTERM/SIGINT (graceful), SIGUSR1 (in-process restart)
- Process respawn with fresh PID

---

#### OpenFang (Rust)

**Background Process Management:**
- **ProcessManager** (`crates/openfang-runtime/src/process_manager.rs`):
```rust
pub struct ProcessManager {
    processes: DashMap<ProcessId, ManagedProcess>,
    max_per_agent: usize,  // Default: 5
}
```
- Tracks stdin, stdout/stderr buffers, child handles
- Automatic timeout-based cleanup

**PTY Support:** ❌ None - `cmd.stdin(std::process::Stdio::null())`

**Timeout Handling:**
- **Triple timeout system:**
  - `timeout_secs`: 30 seconds default (absolute)
  - `no_output_timeout_secs`: 30 seconds default (idle)
  - `grace_period`: 3 seconds default, 60 seconds max (tree kill)

**Process Tree Killing:**
```rust
// Unix
kill -TERM -{pid}  // Process group
kill -9 -{pid}     // Force kill

// Windows
taskkill /T /PID {pid}   // Graceful
taskkill /F /T /PID {pid} // Force
```

**Buffer Management:**
- 1000-line buffers for stdout/stderr
- Oldest 100 lines removed when full
- Non-blocking drain via `read()` method

**Process Lifecycle:**
- Creation with unique IDs (`proc_1`, `proc_2`, ...)
- Listing with uptime and alive status
- Manual kill with tree termination

---

#### PicoClaw (Go)

**Background Process Management:**
- **Spawn Tool** (`pkg/tools/spawn.go`): Async subagents with callbacks
- **Agent Loop** (`pkg/agent/loop.go`): Centralized lifecycle management
- No persistent background processes - all tied to agent sessions

**PTY Support:** ❌ None - `exec.CommandContext` without terminal emulation

**Timeout Handling:**
- Default: 60 seconds (configurable via env var)
- Process tree termination with 2-second grace period
- SIGKILL after timeout

**Process Tree Killing:**
```go
// Unix
cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
syscall.Kill(-pid, syscall.SIGKILL)  // Kill group

// Windows
exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid))
```

**Signal Handling:**
- Gateway handles SIGTERM/SIGINT
- 15-30 second shutdown timeouts
- Provider cleanup on shutdown

**Interactive Features:**
- Readline support with history (`.picoclaw_history`)
- Bidirectional pipes for stdin/stdout/stderr

---

#### ZeroClaw (Rust)

**Background Process Management:**
- **Native runtime only** - No persistent job tracking system
- Subprocess sandbox (`src/runtime/subprocess_sandbox.rs`) for isolation

**PTY Support:** ❌ None - Standard `tokio::process::Command`

**Timeout Handling:**
- Shell tool: 60 seconds default
- Output limit: 1MB to prevent OOM
- UTF-8 lossy conversion for non-UTF8 output

**Process Tracking:**
- Runtime maintains process handles
- No persistent state across restarts

**Sandbox-Level Process Control:**
- Landlock: Filesystem access control only
- Firejail: User-space sandboxing
- Docker: Container isolation with resource limits

---

### Comparative Analysis: Process Management

#### PTY Support - Only OpenClaw

| Project | PTY Implementation | Use Cases Supported |
|---------|-------------------|---------------------|
| **OpenClaw** | `@lydell/node-pty` | vim, top, interactive REPLs |
| All Others | None | Batch commands only |

**Implication:** Only OpenClaw can run true interactive terminal applications. All other projects are limited to batch/command-line execution.

#### Background Job Persistence Models

| Approach | Projects | Characteristics |
|----------|----------|-----------------|
| **Container-based** | IronClaw, NanoClaw | Jobs survive process restart, Docker manages lifecycle |
| **Database-based** | MicroClaw | State in SQLite, recoverable across restarts |
| **In-memory** | NanoBot, PicoClaw | Lost on restart, simpler architecture |
| **Hybrid** | OpenClaw, OpenFang | Registry + process handles |

#### Timeout Strategy Comparison

| Project | Timeout Types | Grace Period |
|---------|---------------|--------------|
| **IronClaw** | Tool → Container → Job | SIGTERM → SIGKILL |
| **MicroClaw** | Command + Subagent + Token | Container-managed |
| **NanoBot** | Single timeout only | 5-second wait |
| **NanoClaw** | Hard + Idle | 15-second grace |
| **OpenClaw** | Overall + No-output | 3-second grace |
| **OpenFang** | Absolute + Idle + Grace | 3-second grace |
| **PicoClaw** | Single timeout only | 2-second grace |
| **ZeroClaw** | Single timeout only | OS-managed |

**Best Practice:** OpenClaw and OpenFang implement dual timeout systems (overall + idle) which is more robust than single timeout approaches.

#### Process Tree Termination

**Best Implementation:** OpenClaw and OpenFang
- Proper process group handling (`kill -{pid}`)
- Configurable grace periods
- Cross-platform (Unix/Windows)

**Adequate:** PicoClaw, IronClaw, MicroClaw
- Process group killing on Unix
- Platform-specific implementations

**Basic:** NanoBot, NanoClaw, ZeroClaw
- Rely on container runtime or OS
- No explicit tree management

#### Orphan Process Handling

| Project | Strategy |
|---------|----------|
| **IronClaw** | SandboxReaper scans every 5 min, removes containers >10 min old |
| **NanoClaw** | `cleanupOrphans()` on startup, Docker `--rm` flag |
| **MicroClaw** | Container isolation prevents orphans |
| **OpenClaw** | No orphan recovery (intentional design) |
| **OpenFang** | ProcessManager tracks all processes |
| **PicoClaw** | Process group termination |
| **NanoBot** | None (relies on OS) |
| **ZeroClaw** | Sandbox runtime manages |

#### Interactive I/O Models

| Project | Stdin Support | Output Streaming |
|---------|---------------|------------------|
| **OpenClaw** | ✅ inherit/pipe-open/closed | ✅ Real-time via PTY |
| **NanoClaw** | ⚠️ IPC-based polling | ✅ MessageStream |
| **IronClaw** | ❌ Captured output only | ⚠️ Docker logs |
| **OpenFang** | ⚠️ One-way (agent→process) | ❌ Accumulated buffers |
| **Others** | ❌ None | ❌ Batch at completion |

**Note:** Only OpenClaw provides true bidirectional interactive I/O. NanoClaw approximates this through IPC polling.

---

### Key Findings

1. **PTY Support is Rare:** Only OpenClaw implements true PTY support. Most frameworks are designed for batch/command-line execution, not interactive terminal applications.

2. **Container-Based Persistence:** IronClaw and NanoClaw use containers as the persistence mechanism, allowing jobs to survive process restarts.

3. **Database Tracking:** MicroClaw uniquely uses SQLite for comprehensive job state tracking, enabling recovery across restarts.

4. **Timeout Complexity:** OpenClaw and OpenFang implement sophisticated dual-timeout systems (overall + idle), while others use single timeouts.

5. **Process Group Killing:** Most Unix-based implementations properly kill process groups, but only OpenClaw and OpenFang have configurable grace periods.

6. **Orphan Handling:** IronClaw and NanoClaw actively scan for and clean up orphaned containers. OpenClaw intentionally does not recover orphans after restart.

7. **Interactive I/O is Limited:** Despite "interactive" claims, most frameworks only support batch execution with captured output. True bidirectional interaction is rare.

---

## Security Trade-offs

### Defense in Depth vs Complexity

**Best Implementation:** OpenFang
- Multiple independent layers
- Capability-based fine-grained control
- Human oversight for critical operations

**Simplest Implementation:** PicoClaw
- Application-layer only
- Easy to understand
- Limited protection against sophisticated attacks

### Usability vs Security

**Most Usable:** NanoClaw, IronClaw
- Minimal user intervention required
- Automated security controls

**Most Secure (with user friction):** OpenClaw
- Interactive approval for every command
- User must understand security implications

**Balanced:** ZeroClaw
- Configurable autonomy levels
- Pre-configured supervision

### Performance Overhead

**Lowest Overhead:** PicoClaw, ZeroClaw (native)
- No container startup time
- Native sandboxing (Landlock)

**Highest Overhead:** OpenFang, IronClaw
- Multiple sandbox layers
- Container pooling helps mitigate

## Recommendations

### For Production Use

1. **High Security Required:** OpenFang
   - Most comprehensive security model
   - Human oversight for critical operations

2. **Balanced Security/Usability:** OpenClaw
   - Interactive approval system
   - Strong container security

3. **Native Performance:** ZeroClaw
   - Landlock for filesystem isolation
   - Multiple sandbox options

### For Development

1. **Fast Iteration:** NanoClaw
   - Strong container isolation
   - Automated security controls

2. **Simple Setup:** PicoClaw
   - Application-layer controls
   - Easy to configure

### Security Best Practices Observed

Across all projects, the following patterns emerge:

1. **Allowlist over denylist** - More secure but requires maintenance
2. **Path validation** - Prevent traversal attacks
3. **Symlink checking** - Prevent symlink escape
4. **Output limiting** - Prevent DoS through large output
5. **Timeout enforcement** - Prevent hanging commands
6. **Environment hygiene** - Filter sensitive variables
7. **Non-root execution** - Reduce privilege escalation risk
8. **Audit logging** - Essential for security monitoring

### Areas for Improvement

1. **Standardized security testing** across all projects
2. **Common security criteria** for evaluation
3. **Shared security libraries** to reduce duplication
4. **Better documentation** of security assumptions
5. **Penetration testing** methodologies

## Conclusion

The the_claws ecosystem demonstrates a wide spectrum of approaches to securing AI agent command execution, from simple application-layer controls (PicoClaw) to sophisticated multi-layer sandboxing (OpenFang, IronClaw).

**Key Insights:**

1. **No one-size-fits-all solution** - Different use cases require different approaches
2. **Defense in depth matters** - The most secure implementations use multiple layers
3. **User experience vs security** - Interactive approvals add friction but increase security
4. **Native sandboxing is underutilized** - Only ZeroClaw leverages Landlock/Firejail
5. **Credential protection is critical** - Proxy approaches (IronClaw, NanoClaw) are innovative

**Future Directions:**

1. **Standardized security metrics** for comparison
2. **Hybrid approaches** combining best practices
3. **Better integration** of native Linux sandboxing features
4. **Comprehensive security audit** of all implementations
5. **Shared security components** to reduce duplication

---

*Document Version: 1.2*
*Generated by: Claude Code agent exploration*
*Analysis Date: 2026-03-24*
*Updates:*
  * v1.1 - Added Long-Running and Interactive Process Handling section*
  * v1.2 - Added Host vs Sandbox Execution Modes section*
