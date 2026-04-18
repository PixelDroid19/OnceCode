# OnceCode Architecture

This document describes the lightweight architecture decisions behind `oncecode`.
The goal is not to build a giant all-in-one terminal agent platform, but to prioritize the most valuable execution loop, interaction experience, and safety boundaries.

## Design Principles

OnceCode prioritizes these capabilities:

1. the main `model -> tool -> model` loop
2. full-screen TUI interaction rhythm
3. directory awareness, permission checks, and dangerous-action confirmation
4. a componentized transcript / tool / input UI structure
5. a user-reviewable file modification flow

In other words, OnceCode is a smaller, more controllable terminal coding assistant.

## Current implementation focus

- Keep the skeleton of the `model -> tool -> model` loop
- Keep a unified tool contract and centralized registration
- Keep a message-driven terminal interaction rhythm
- Keep safety boundaries: path permissions, command permissions, and write approval
- Keep Claude Code-inspired extension points: local skills and MCP-backed tools

## Planned / not yet built

- Full Ink/React rendering stack
- Bridge / IDE two-way communication
- Remote session
- Task swarm / sub-agent orchestration
- LSP
- Skill marketplace
- More complex permission modes
- Feature-flag system
- Telemetry / analytics
## Source layout

```
src/
├── constants.ts              Global app constants (name, version, limits)
├── index.ts                  CLI entry point
├── agent-loop.ts             Multi-turn model -> tool -> model loop
├── anthropic-adapter.ts      Anthropic Messages API adapter
├── mock-model.ts             Offline fallback adapter
├── context-tracker.ts        Token usage tracking, overflow detection, display helpers
├── compaction.ts             Context compaction (micro-compact + full summarisation)
│
├── config.ts                 Runtime and settings type definitions
├── config-store.ts           Persistence helpers for ~/.oncecode JSON files
├── i18n/
│   ├── index.ts              Translation lookup, interpolation, and locale loading
│   ├── languages.ts          Supported UI languages and auto-detection
│   └── locales/              Built-in locale dictionaries (en, es)
│
├── tool.ts                   Tool contract, registration, validation
├── tools/
│   ├── index.ts              Default tool registry factory
│   ├── search-replace.ts     Shared search/replace engine for edit + patch tools
│   ├── write-file.ts         write_file + modify_file (shared implementation)
│   ├── modify-file.ts        Re-exports modify_file from write-file
│   ├── edit-file.ts          Single search/replace edits
│   ├── patch-file.ts         Multi-replacement patch operations
│   ├── read-file.ts          Read file contents with line ranges
│   ├── list-files.ts         Directory listing
│   ├── grep-files.ts         Content search via ripgrep
│   ├── run-command.ts        Shell command execution
│   ├── web-fetch.ts          HTTP page fetching
│   ├── web-search.ts         Web search via DuckDuckGo/Sogou
│   ├── ask-user.ts           Interactive user prompts
│   └── load-skill.ts         Dynamic skill loading
│
├── permissions.ts            Path, command, and edit approval with allowlists
├── permission-rules.ts       Dangerous-command classification rules
├── permission-store.ts       Persisted permission decisions
├── file-review.ts            Diff review before writing files
├── workspace.ts              Path resolution and sandbox enforcement
│
├── tty-app.ts                Full-screen TTY application shell
├── tty/
│   ├── types.ts              TTY state and screen types
│   ├── state.ts              Navigation, scroll, history, render helpers
│   ├── transcript-helpers.ts Transcript entry manipulation and formatting
│   └── approval-controller.ts Permission approval prompt logic
│
├── tui/
│   ├── constants.ts          Terminal layout constants (widths, rows, limits)
│   ├── index.ts              Barrel re-exports for the TUI layer
│   ├── chrome.ts             Panels, banners, borders, badges, diff colorizer
│   ├── transcript.ts         Transcript rendering and scrolling
│   ├── input.ts              Input prompt rendering
│   ├── input-parser.ts       Raw terminal input → key event parser
│   ├── screen.ts             Screen clearing and cursor management
│   ├── markdown.ts           Lightweight terminal markdown renderer
│   └── types.ts              Shared TUI type definitions
├── ui.ts                     Public barrel re-exporting tui/* for consumers
│
├── mcp.ts                    Barrel re-exporting mcp/* for consumers
├── mcp/
│   ├── constants.ts          MCP timeout and protocol constants
│   ├── types.ts              JSON-RPC, descriptor, and client interface types
│   ├── utils.ts              Error formatting, env interpolation, auth helpers
│   ├── protocol-cache.ts     On-disk protocol negotiation cache
│   ├── stdio-client.ts       Stdio transport MCP client
│   ├── http-client.ts        Streamable HTTP transport MCP client
│   └── registry.ts           Server discovery and tool registration factory
├── mcp-tool-utils.ts         MCP response formatting and schema normalization
├── mcp-helper-tools.ts       Resource/prompt wrapper tools for MCP servers
├── mcp-status.ts             MCP server status aggregation
│
├── session/
│   └── system-prompt.ts      Shared system prompt builder (deduped)
├── prompt.ts                 System prompt assembly from runtime + tools
│
├── skills.ts                 Skill discovery, loading, installation
├── history.ts                Command history persistence
├── cli-commands.ts           Slash command definitions and handling
├── local-tool-shortcuts.ts   Shortcut syntax parsing (e.g. @file, !command)
├── background-tasks.ts       Background shell task registry
├── manage-cli.ts             CLI subcommands for MCP and skill management
├── install.ts                Self-installer (npm global link)
│
├── utils/
│   ├── fs.ts                 File-system helpers (readTextFileOrNull)
│   ├── http.ts               HTTP retry helpers (sleep, shouldRetryStatus)
│   ├── web.ts                Web fetching and search (DuckDuckGo, Sogou)
│   ├── command-line.ts       Shell command-line tokenizer
│   ├── errors.ts             Error code extraction utilities
│   └── context.ts            Context window sizing, token estimation, overflow detection
│
└── types.ts                  Global shared type definitions
```

## Key patterns

- **Barrel re-exports**: `mcp.ts` and `ui.ts` act as public API surfaces so internal module splits don't break consumers.
- **Shared constants**: Magic numbers live in `constants.ts`, `mcp/constants.ts`, and `tui/constants.ts` instead of inline.
- **Localized UI strings**: User-facing CLI/TUI text goes through `i18n/t()` so the interface can switch language without forking logic.
- **Tool contract**: Every tool implements `ToolDefinition<T>` with a Zod schema and an `inputSchema` for the model.
- **Permission flow**: Tools that modify the filesystem go through `applyReviewedFileChange` which shows a diff for user approval.
- **MCP transport abstraction**: Both stdio and HTTP clients implement `McpClientLike` so the registry treats them uniformly.

## Context window management

OnceCode tracks token usage reported by the provider and automatically compacts the conversation when the context window fills up. The design was informed by studying Claude Code, ForgeCode, Qwen-Code, and OpenCode.

### Token accounting

- The Anthropic adapter extracts the `usage` object from every API response (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`).
- `ContextTracker` records each response's usage and exposes `usageFraction`, `usagePercent`, `warningLevel`, and `shouldCompact()`.
- `lastInputTokens` (input + cache_creation + cache_read) serves as the primary proxy for current context size because it reflects exactly what the provider computed.

### Context window sizing

- `utils/context.ts` contains a static table of 21 regex rules mapping model IDs to context window sizes (e.g. Claude = 200K, GPT-5 = 128K, Gemini 2.5 = 1M).
- `getContextWindowSize(model)` returns the limit; `getEffectiveContextBudget()` subtracts `maxOutputTokens` and a 20K compaction buffer to determine the usable budget.

### Compaction

Two-phase compaction in `compaction.ts`:

1. **Micro-compact**: Clears old tool_result outputs (>200 chars, outside the last 3 user turns) with a placeholder. This is fast, local, and does not call the model.
2. **Full compaction**: Sends the entire conversation to the model with a structured summarisation prompt. The result replaces all old messages with: retained system messages + summary + assistant acknowledgement + the last user message.

Auto-compaction runs before each agent turn when `contextTracker.shouldCompact()` returns true. Users can also trigger `/compact` manually.

### TUI integration

- The banner displays a `[context XX%]` badge with colour coding: green (<60%), yellow (60-80%), red (>80%).
- `/context` prints detailed tracker stats; `/compact` triggers manual compaction.

## Why it is good for learning

One strength of OnceCode is that it delivers Claude Code-like behavior and core architectural ideas in a much lighter implementation.

That makes it well suited to:

- Learning the basic pieces of a terminal coding agent
- Studying tool-calling loops
- Understanding permission approval and file review flows
- Seeing how skills and external MCP tools can be added without a heavy plugin platform
- Seeing a lightweight Claude Code-style distinction between foreground tool execution and background shell tasks
- Experimenting with how terminal UIs are organized
- Customizing further on top of a small codebase

## Future improvements

1. A more complete virtual-scrolling transcript
2. Richer input editing behavior
3. A finer-grained tool execution status panel
4. Session history persistence and project memory
5. Stronger UI componentization
