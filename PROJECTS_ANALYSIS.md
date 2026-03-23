# The "Claws" Ecosystem - Complete Feature Analysis

*Generated: 2026-03-22*

## Executive Summary

Analysis of 8 AI assistant projects in the "Claws" ecosystem. All share the same core concept: **self-hosted AI assistant that connects to messaging platforms**. The differentiator is **architectural philosophy** and **target use case**.

---

## Quick Comparison Table

| Project | Language | Channels | Tools/Skills | RAM | Startup | Unique Angle |
|---------|----------|----------|-------------|-----|---------|--------------|
| **NanoClaw** | TS | 5 | Container skills | Container | Medium | Per-group container isolation |
| **PicoClaw** | Go | 8 | ClawHub + MCP | <10MB | <1s | Runs on $10 hardware, RISC-V |
| **NanoBot** | Python | 10+ | MCP + minimal | Standard | Medium | 99% fewer lines (69 files) |
| **MicroClaw** | Rust | 15+ | 44 tools + Skills | Standard | Fast | Unified multi-platform runtime |
| **IronClaw** | Rust | 8 | WASM + MCP | Standard | Fast | 16-layer security, self-healing |
| **OpenFang** | Rust | 40 | 60+ skills, 3 runtimes | 40MB | 180ms | Autonomous agent OS ("Hands") |
| **OpenClaw** | TS | 40+ | 70+ extensions | 394MB | 6s | Mobile apps, most feature-complete |
| **ZeroClaw** | Rust | 25+ | 70+ tools + hardware | <5MB | <10ms | Extreme optimization, GPIO |

---

## Feature Matrix

| Feature | Nano | Pico | NanoBot | Micro | Iron | OpenFang | OpenClaw | Zero |
|---------|------|------|---------|-------|------|----------|----------|------|
| Multi-provider (OpenAI, Anthropic, etc.) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| MCP (Model Context Protocol) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | via mcporter | ✅ |
| WASM Tools | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | Extism |
| Container Isolation | ✅ | ❌ | ❌ | Docker | Docker | WASM | Sandbox | Multi (Docker/Bubblewrap/Landlock) |
| Mobile Apps | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | iOS/Android | ❌ |
| Hardware GPIO (Arduino/RPi) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Autonomous Background Agents | ❌ | ❌ | ❌ | ❌ | ❌ | Hands | ❌ | ❌ |
| Sub-agents | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Voice Support | ❌ | Groq | Groq | ❌ | ❌ | ❌ | ✅ | ❌ |
| Web Dashboard | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ (React 19) |

---

## Channel Support Comparison

| Project | Platform Count | Notable Inclusions | Hardware |
|---------|---------------|-------------------|----------|
| NanoClaw | 5 | WA, TG, Discord, Slack, Gmail | None |
| PicoClaw | 8 | + Matrix, IRC, WeChat, QQ | None |
| NanoBot | 10+ | + Feishu, DingTalk, Email, Matrix | None |
| MicroClaw | 15+ | + Signal, iMessage, Nostr, Feishu/Lark | None |
| IronClaw | 8 | Via WASM: TG, Signal, Slack, HTTP | None |
| OpenFang | 40 | Most comprehensive | None |
| OpenClaw | 40+ | + iMessage, BlueBubbles, LINE, Teams | None |
| ZeroClaw | 25+ | + Bluesky, LinkedIn, Reddit, Twitter | Arduino, STM32, ESP32, RPi GPIO |

---

## Security Architecture Comparison

| Project | Security Model | Notable Features |
|---------|---------------|------------------|
| NanoClaw | Container isolation | Credential proxy, mount allowlists, non-root containers |
| PicoClaw | Standard auth | Rate limiting, health checks, workspace restrictions |
| NanoBot | Workspace restriction | Path guards, command allowlists, empty deny lists |
| MicroClaw | Path guards | High-risk tool approvals, Docker sandbox option |
| IronClaw | **16-layer defense** | Prompt injection defense, Merkle audits, secret leak detection, capability-based permissions |
| OpenFang | **16-layer defense** | Taint tracking, Ed25519 manifests, SSRF protection, secret zeroization, fuel metering |
| OpenClaw | 3-layer | Sandbox execution, authentication profiles, content policies |
| ZeroClaw | Pairing + sandboxing | Device pairing, autonomy levels, encrypted storage, E-stop, 16 security modules |

---

## Codebase Size Comparison

```
NanoBot    ████ (69 Python files, minimal)
NanoClaw   █████ (~20 TS files + containers)
PicoClaw   ████████ (Go, medium)
ZeroClaw   ██████████ (Rust, medium, 8.8MB binary)
MicroClaw  ████████████████ (Rust workspace, 7 crates)
IronClaw   ██████████████████ (Rust + WASM crates)
OpenFang   ████████████████████████████████ (137K LOC, 14 crates)
OpenClaw   ████████████████████████████████ (TypeScript monorepo, 70+ extensions)
```

---

## Use Case Recommendations

| If you want... | Use | Why |
|---------------|-----|-----|
| Run on $10 SBC/embedded hardware | **PicoClaw** or **ZeroClaw** | <10MB RAM, RISC-V support |
| Maximum security isolation | **IronClaw** or **OpenFang** | 16-layer defense, WASM sandboxing |
| Mobile companion apps | **OpenClaw** | Only one with iOS/Android apps |
| Autonomous background tasks | **OpenFang** | "Hands" run on schedules without prompts |
| Hardware integration (GPIO) | **ZeroClaw** | Arduino/STM32/ESP32/RPi support |
| Simple, understandable code | **NanoBot** or **NanoClaw** | Minimal files, easy to modify |
| Multi-platform consistency | **MicroClaw** | Unified agent loop across 15+ channels |
| Per-group isolation | **NanoClaw** | Container per conversation group |
| Enterprise-grade autonomous OS | **OpenFang** | Hands architecture, RBAC, workflows |

---

# Detailed Project Analysis

## NanoClaw (TypeScript/Node.js)

### What It Does
Personal AI assistant with **isolated containers per conversation group**.

### Core Architecture
- **Single Node.js orchestrator** (`src/index.ts`) polling SQLite for messages
- **Container isolation**: Docker (Linux/macOS) or Apple Container (macOS) per group
- **Credential proxy pattern**: API keys never enter containers
- **Channel registry**: Modular skill-based channels

### Key Features
- **5 channels**: WhatsApp, Telegram, Discord, Slack, Gmail
- **Per-group isolation**: Each group has its own filesystem, DB, CLAUDE.md memory, container
- **4 skill types**: Feature (branch-based), Utility (CLI), Operational (setup/debug), Container (inside agent)
- **Scheduled tasks**: Cron, interval, one-time
- **Agent swarms**: Specialized sub-agents for complex tasks
- **Web integration**: Search, fetch, browser automation via `agent-browser` container skill
- **Remote control**: Web-based interface for agent activity monitoring

### Unique Technical Decisions
1. Container isolation over application permissions
2. Credential proxy - secrets injected at host boundary
3. SQLite with polling (not real-time streaming)
4. Filesystem IPC via JSON files in `/workspace/ipc/`
5. No config files - customization via code modification

### Security Model
- Defense in depth: container + allowlist + credential proxy
- Non-root containers, restricted mounts
- Tamper-proof mount allowlist stored outside project

---

## PicoClaw (Go)

### What It Does
Ultra-lightweight AI assistant designed for **$10 hardware and embedded systems**.

### Core Architecture
- **Go-based single binary** <10MB RAM
- **Multi-platform**: x86_64, ARM64, MIPS, RISC-V, LoongArch
- **Config-based**: JSON model list with smart routing

### Key Features
- **25+ AI providers** with intelligent routing (simple queries → lightweight models)
- **8+ chat platforms**: Telegram, Discord, Slack, WhatsApp, Matrix, QQ, WeChat, IRC
- **MCP protocol**: Native Model Context Protocol integration
- **Vision pipeline**: Image/file processing with automatic base64 encoding
- **Hardware support**: LicheeRV-Nano, NanoKVM, MaixCAM, Android via Termux
- **Docker profiles**: Agent (one-shot), Gateway (bot), Launcher (web UI)
- **Skills system**: ClawHub registry integration
- **Subagents**: Async task execution with spawn tool

### Unique Technical Decisions
1. Go for extreme memory efficiency and fast startup
2. Model-centric configuration (vendor/model format)
3. Workspace isolation as default security
4. Agent refactoring with explicit semantic boundaries
5. Event-driven async message processing

### Deployment
- Single static binary for all platforms
- Docker compose with multiple profiles
- Embedded deployment on SBCs
- Android Termux support

---

## NanoBot (Python)

### What It Does
Minimalist AI assistant with **99% fewer lines of code** than competitors.

### Core Architecture
- **Python with LiteLLM** provider abstraction
- **Provider registry**: 20+ providers with smart detection
- **Memory system**: MEMORY.md (facts) + HISTORY.md (grep-searchable log)
- **Event-driven**: Async message bus with non-blocking operations

### Key Features
- **10+ chat platforms**: Telegram, Discord, WhatsApp, Feishu, Slack, Email, Matrix, QQ, DingTalk, WeCom
- **Skills framework**: GitHub, weather, summarize, tmux, cron, clawhub, skill-creator, memory
- **Web search**: Brave, Tavily, Jina, DuckDuckGo with fallback
- **Cron scheduling**: With delivery to last active channel
- **Heartbeat service**: Periodic tasks via HEARTBEAT.md (every 30 min)
- **MCP support**: Model Context Protocol integration
- **Subagents**: Background task spawning
- **Provider registry**: Single source of truth for all LLM providers

### Unique Technical Decisions
1. **Ultra-lightweight**: 69 Python files total
2. **Two-layer memory**: Facts + searchable history
3. **LLM-driven memory consolidation**
4. **Provider registry** with gateway vs direct distinction
5. **Empty deny lists** (more secure than empty allow lists)
6. **Progressive skill loading**: summary first, full content on-demand

### Extensibility
- Channel plugins via entry points
- Skill system with YAML frontmatter
- Tool registry with dynamic registration
- MCP integration for external tools

---

## MicroClaw (Rust)

### What It Does
Multi-platform AI agent runtime with **unified agent loop across 15+ channels**.

### Core Architecture
- **Rust workspace**: core, storage, tools, channels, app, observability, clawhub
- **`process_with_agent` loop**: Tool iteration with persistent sessions
- **Session persistence**: Context compaction when sessions grow large

### Key Features
- **15+ channel adapters**: Telegram, Discord, Slack, Feishu/Lark, IRC, Web UI, WhatsApp, Signal, iMessage, Matrix, Nostr, QQ, DingTalk, Email
- **20+ built-in tools**: File ops, bash (Docker sandbox), web search/fetch, memory management, scheduling, sub-agents
- **Memory system**: File-based AGENTS.md + SQLite structured memory with automatic deduplication
- **Sub-agents**: Parallel execution with restricted tool set (9 tools vs 20+ main)
- **Anthropic Skills-compatible**: Auto-discovery, platform filtering, ClawHub integration
- **Natural language scheduling**: "Remind me every 30 minutes" creates cron task
- **Observability**: OpenTelemetry, Langfuse integration
- **Web UI**: Local control plane at http://127.0.0.1:10961

### Unique Technical Decisions
1. **Channel-agnostic core**: Same agent loop for all platforms
2. **Smart group behavior**: Telegram loads all messages since last reply
3. **Session persistence**: Full state including tool_use/tool_result blocks
4. **Context compaction**: Old messages summarized automatically
5. **MCP-first** extensibility
6. **Path guards** blocking sensitive paths (.ssh, .aws, .env)

### Deployment
- One-liner installer, Homebrew, Docker, source build
- Gateway service, ACP stdio mode, web mode
- OpenTelemetry metrics export

---

## IronClaw (Rust)

### What It Does
Security-first personal AI assistant with **WASM sandboxing and self-healing**.

### Core Architecture
- **Agent loop**: Undo/redo, context compaction, self-repair
- **WASM sandbox**: Fuel metering, memory limits, capability-based permissions
- **Dual database**: PostgreSQL (production) + libSQL/Turso (embedded)

### Key Features
- **16 security systems**: Prompt injection defense, credential leak detection, Merkle audit trails, endpoint allowlisting
- **WASM tools**: Sandboxed with explicit capabilities.json
- **MCP integration**: HTTP/stdio transports, dynamic server discovery
- **Hybrid search**: Reciprocal Rank Fusion (FTS + vector similarity)
- **Background automation**: Heartbeat, cron triggers, webhook handlers
- **Self-healing**: Automatic tool rebuilding, context monitoring, stuck job detection
- **Hot-reloadable extensions**: WASM channel runtime
- **Skills system**: Trusted vs installed, keyword/pattern matching

### Unique Technical Decisions
1. **WASM over Docker for tools**: Lightweight isolation, fuel metering
2. **Dual database backend**: Feature-gated compilation
3. **Capability-based security**: Tools declare permissions upfront
4. **Hybrid search**: RRF combining FTS + vectors
5. **Self-healing architecture**: Job state machine with recovery paths
6. **Hot-reloadable WASM channels**

### Security Layers
- Prompt injection scanner
- Secret leak detection
- Network allowlisting
- Credential injection at host boundary
- Content sanitization
- Policy enforcement
- SSRF protection

---

## OpenFang (Rust)

### What It Does
**Agent Operating System** with autonomous "Hands" that work on schedules without human prompts.

### Core Architecture
- **137K LOC** across 14 Rust crates
- **Hands system**: Pre-built autonomous packages running independently
- **Three-tier memory**: SQLite + semantic search + knowledge graphs

### Key Features
- **7 Hands**: Clip (video editing), Lead (lead gen), Collector (OSINT), Researcher (deep research), Twitter (account management), Browser (automation), Predictor (superforecasting)
- **Cold start**: 180ms (vs OpenClaw's 6s)
- **40 messaging adapters**
- **16-layer security**: WASM metering, taint tracking, Merkle trails, SSRF protection, secret zeroization, Ed25519 manifests
- **OpenAI-compatible API**: Drop-in replacement
- **Skills marketplace**: 60+ bundled skills, WASM/Python/Node.js runtimes
- **Workflow orchestration**: Complex step sequences
- **RBAC authentication**: Role-based access control

### Unique Technical Decisions
1. **Hands architecture**: Curated autonomous packages vs reactive chatbots
2. **Taint tracking system**: Information flow security
3. **Dual memory**: SQLite + semantic search + knowledge graphs
4. **WASM metering**: Fuel-based execution limits
5. **Capability-based security**: Agents declare tools, kernel enforces
6. **Merkle audit trail**: Cryptographic verification of all actions

### Performance vs Competitors
- **Cold Start**: 180ms (LangGraph: 2.5s, OpenClaw: 6s)
- **Memory**: 40MB idle (OpenClaw: 394MB)
- **Size**: 32MB binary (OpenClaw: 500MB)
- **Security**: 16 layers (OpenClaw: 3)
- **Channels**: 40 adapters (OpenClaw: 13)

---

## OpenClaw (TypeScript)

### What It Does
Full-featured personal AI assistant with **iOS and Android mobile companion apps**.

### Core Architecture
- **TypeScript monorepo** with pnpm workspaces
- **Gateway service**: WebSocket-based real-time communication
- **Plugin SDK**: 70+ extensions available
- **Multi-agent support**: Isolated workspaces with shared gateway

### Key Features
- **40+ messaging platforms**: WhatsApp, Telegram, Discord, Slack, Signal, iMessage, BlueBubbles, Google Chat, Matrix, Feishu, LINE, Mattermost, Nextcloud Talk, Nostr, Synology Chat, Tlon, Twitch, Zalo, Microsoft Teams, IRC, and 20+ more
- **35+ AI providers** with automatic fallback
- **iOS/Android apps**: Pairing, Canvas, camera, screen recording, location, voice
- **macOS menu bar app**: Quick access and control
- **70+ extensions**: AI providers, channels, skills (GitHub, Spotify, Notion, 1Password), tools
- **Computer use**: Pi agent integration for file ops and browsing
- **Thinking levels**: Adjustable reasoning (low/medium/high/x-high)
- **Memory system**: Multiple backends (in-memory, LanceDB), semantic search
- **Voice support**: Transcription, text-to-speech
- **Canvas rendering**: Interactive interfaces
- **Browser automation**: Safe sandboxed execution

### Unique Technical Decisions
1. **Plugin architecture**: Core stays lean, extensibility through SDK
2. **CLI-first philosophy**: Terminal-based setup, transparent security
3. **Multi-agent design**: Isolated workspaces, shared gateway
4. **TypeScript primary**: Chosen for hackability over performance
5. **mcporter bridge**: MCP integration via plugin (not built-in)
6. **Real-time WebSocket gateway**: Low-latency interactions

### Deployment
- npm/pnpm/bun global install
- Docker containers (multiple configurations)
- Fly.io cloud deployment
- Systemd/Launchd daemon
- Package managers: Homebrew, Nix

---

## ZeroClaw (Rust)

### What It Does
Ultra-optimized personal AI assistant for **$10 devices with <5MB RAM and <10ms startup**.

### Core Architecture
- **Rust with trait-based architecture**: Provider, Channel, Tool, Memory, Sandbox traits
- **Single binary**: ~8.8MB with zero runtime dependencies
- **70+ built-in tools**
- **Tokio async runtime**

### Key Features
- **25+ platforms**: Telegram, Discord, Slack, WhatsApp, Matrix, IRC, Email, Bluesky, Nostr, Mattermost, Nextcloud Talk, DingTalk, Lark, QQ, Reddit, LinkedIn, Twitter, iMessage, and 7+ more
- **20+ AI providers** with automatic tool calling detection
- **Hardware integration**: STM32, Arduino, ESP32, Raspberry Pi GPIO via peripheral trait
- **70+ tools**: File I/O, shell, browser automation, business tools (Jira, LinkedIn, Notion), hardware tools
- **Security**: Device pairing, autonomy levels (ReadOnly/Supervised/Full), encrypted secret storage
- **Sandboxing**: Docker, Bubblewrap, Landlock backends
- **Web dashboard**: React 19 + Vite frontend
- **WASM plugins**: Extism-based plugin runtime
- **Skills system**: User-defined in `~/.zeroclaw/workspace/skills/`
- **Cron system**: Standard expressions with agent/shell jobs
- **SOPs**: Event-driven automation

### Unique Technical Decisions
1. **Extreme optimization**: `opt-level = "z"`, 8.8MB binary, <10ms startup
2. **Trait-based architecture**: Simple trait for adding providers/channels/tools
3. **Security by default**: Pairing required, workspace isolation
4. **Local-first**: All data stored locally, no cloud dependencies
5. **Hardware abstraction**: Peripheral trait for embedded devices
6. **Production-ready**: OpenTelemetry, Prometheus metrics, health checks

### Performance Metrics
- Binary size: 8.8MB (OpenClaw: 500MB)
- Memory: <5MB RAM (competitors: >1GB)
- Startup: <10ms (Node.js: 500ms+)
- Install: Single command bootstrap

---

# Extensibility Comparison

## Skills/Plugin Systems

| Project | System | Format | Discovery |
|---------|--------|--------|-----------|
| NanoClaw | 4 skill types | YAML + code | Branch-based |
| PicoClaw | ClawHub | ? | Marketplace |
| NanoBot | Skills | YAML frontmatter | Built-in |
| MicroClaw | Anthropic Skills | YAML frontmatter | Auto + ClawHub |
| IronClaw | Skills + WASM | SKILL.md, capabilities.json | Trusted/Installed |
| OpenFang | Skills + WASM/Python/Node | Multiple | FangHub |
| OpenClaw | Extensions | Plugin SDK | ClawHub |
| ZeroClaw | Skills + WASM | SKILL.md/SKILL.tomL | Auto + Extism |

## MCP (Model Context Protocol) Support

| Project | MCP Support | Notes |
|---------|------------|-------|
| NanoClaw | ❌ | Not mentioned |
| PicoClaw | ✅ | Native integration |
| NanoBot | ✅ | stdio/HTTP |
| MicroClaw | ✅ | stdio/HTTP with fallback |
| IronClaw | ✅ | HTTP/stdio, OAuth handling |
| OpenFang | ✅ | Full integration |
| OpenClaw | ✅ | Via mcporter bridge |
| ZeroClaw | ✅ | Native support |

---

# Deployment Comparison

## Installation Methods

| Project | Methods | Notes |
|---------|---------|-------|
| NanoClaw | Source | Fork and modify |
| PicoClaw | Binary, Docker, Termux | Single static binary |
| NanoBot | PyPI, uv, source | `pip install nanobot-ai` |
| MicroClaw | Installer, Homebrew, Docker, source | One-liner |
| IronClaw | Binary, Docker | 7-step wizard |
| OpenFang | Binary, Docker | ~32MB static binary |
| OpenClaw | npm, Docker, Homebrew, Nix | Monorepo |
| ZeroClaw | curl, Homebrew, source | One-click bootstrap |

## Service Management

| Project | systemd | launchd | Docker | Notes |
|---------|---------|---------|--------|-------|
| NanoClaw | ✅ | ✅ | ✅ | Container runtime |
| PicoClaw | ✅ | ? | ✅ | 3 profiles |
| NanoBot | ✅ | ? | ✅ | Gateway mode |
| MicroClaw | ✅ | ✅ | ✅ | Gateway service |
| IronClaw | ✅ | ✅ | ✅ | Sandbox execution |
| OpenFang | ✅ | ? | ✅ | Single binary |
| OpenClaw | ✅ | ✅ | ✅ | Daemon service |
| ZeroClaw | ✅ | ✅ | ❌ | Native service |

---

# Hardware Support

Only **ZeroClaw** has explicit hardware peripheral support:
- Arduino (Uno, compatible)
- STM32/Nucleo
- Raspberry Pi GPIO
- ESP32
- Serial communication

**PicoClaw** and **ZeroClaw** target embedded/low-resource hardware:
- LicheeRV-Nano
- NanoKVM
- MaixCAM
- Android via Termux (PicoClaw)
- RISC-V boards (PicoClaw)

---

# Security Deep Dive

## IronClaw / OpenFang (16-Layer Defense)

1. WASM dual-metered sandbox (fuel + epoch interruption)
2. Merkle hash-chain audit trail
3. Information flow taint tracking
4. Ed25519 signed agent manifests
5. SSRF protection (private IPs blocked)
6. Secret zeroization (auto-wipe from memory)
7. OFP mutual authentication (HMAC-SHA256)
8. Capability gates (RBAC)
9. Security headers (CSP, X-Frame-Options, HSTS)
10. Health endpoint redaction
11. Subprocess sandbox (env_clear)
12. Prompt injection scanner
13. Loop guard (SHA256-based)
14. Session repair (7-phase validation)
15. Path traversal prevention
16. GCRA rate limiter

## ZeroClaw Security Modules

- Device pairing (one-time codes)
- Autonomy levels (ReadOnly, Supervised, Full)
- Sandbox backends (Docker, Bubblewrap, Landlock)
- Encrypted secret storage
- E-stop (emergency controls)
- Workspace boundary enforcement
- Audit logging
- Prompt injection defense
- OTP validator
- IAM policy integration

---

# Conclusions

## The "Claws" Philosophy

All 8 projects share:
- **Self-hosted, local-first architecture**
- **Multi-LLM provider support** (OpenAI, Anthropic, Google, etc.)
- **Skills/plugin extensibility**
- **Persistent memory systems**
- **Scheduled/automated tasks**
- **Privacy and control focus**

## Differentiation Strategy

Each project carves its niche through:

1. **Hardware targets**: PicoClaw/ZeroClaw for embedded
2. **Security posture**: IronClaw/OpenFang for enterprise
3. **Mobile experience**: OpenClaw with companion apps
4. **Autonomy**: OpenFang's Hands for background tasks
5. **Simplicity**: NanoBot for understandable code
6. **Isolation**: NanoClaw for per-group containers
7. **Consistency**: MicroClaw for unified multi-platform
8. **Optimization**: ZeroClaw for extreme efficiency

## Recommendations by Use Case

| Use Case | Recommended Project |
|----------|-------------------|
| Embedded/IoT deployment | PicoClaw, ZeroClaw |
| Enterprise security | IronClaw, OpenFang |
| Personal use with mobile | OpenClaw |
| Autonomous agents | OpenClaw |
| Hardware integration | ZeroClaw |
| Learning/contributing | NanoBot, NanoClaw |
| Production multi-platform | MicroClaw, OpenClaw |
| Minimum resource usage | ZeroClaw, PicoClaw |

---

*Analysis generated via autonomous codebase exploration using Claude Code agents.*
