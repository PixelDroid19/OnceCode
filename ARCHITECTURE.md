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
- Keep extension points inspired by modern agent runtimes: local skills and MCP-backed tools

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
├── index.ts                        CLI entry point
├── constants.ts                    Global app constants (name, version, limits)
├── types.ts                        Global shared type definitions
│
├── agent/                          Agent loop and model adapters
│   ├── loop.ts                     Multi-turn model -> tool -> model loop
│   ├── anthropic-adapter.ts        Anthropic Messages API adapter
│   └── mock-model.ts              Offline fallback adapter
│
├── context/                        Context window management
│   ├── tracker.ts                  Token usage tracking, overflow detection, display helpers
│   ├── compaction.ts              Context compaction (micro-compact + full summarisation)
│   └── window.ts                  Context window sizing, token estimation, overflow detection
│
├── config/                         Configuration
│   ├── runtime.ts                 Runtime config loading, settings merge, type definitions
│   └── store.ts                   Persistence helpers for ~/.oncecode JSON files
│
├── permissions/                    Permission system
│   ├── manager.ts                 Path, command, and edit approval with allowlists
│   ├── rules.ts                   Dangerous-command classification rules
│   └── store.ts                   Persisted permission decisions
│
├── commands/                       CLI slash commands
│   ├── handlers.ts                Slash command definitions and handling
│   ├── shortcuts.ts               Shortcut syntax parsing (e.g. @file, !command)
│   └── manage.ts                  CLI subcommands for MCP and skill management
│
├── session/                        Session concerns
│   ├── prompt.ts                  System prompt assembly from runtime + tools
│   ├── system-prompt.ts           Shared system prompt builder (deduped)
│   ├── history.ts                 Command history persistence
│   └── skills.ts                  Skill discovery, loading, installation
│
├── workspace/                      Workspace and file operations
│   ├── paths.ts                   Path resolution and sandbox enforcement
│   ├── file-review.ts            Diff review before writing files
│   ├── background-tasks.ts       Background shell task registry
│   └── install.ts                 Self-installer (npm global link)
│
├── tools/                          Tool framework and implementations
│   ├── framework.ts               Tool contract, registration, validation (ToolDefinition, ToolRegistry)
│   ├── index.ts                   Default tool registry factory
│   ├── search-replace.ts          Shared search/replace engine for edit + patch tools
│   ├── write-file.ts              write_file + modify_file (shared implementation)
│   ├── modify-file.ts            Re-exports modify_file from write-file
│   ├── edit-file.ts               Single search/replace edits
│   ├── patch-file.ts              Multi-replacement patch operations
│   ├── read-file.ts               Read file contents with line ranges
│   ├── list-files.ts              Directory listing
│   ├── grep-files.ts              Content search via ripgrep
│   ├── run-command.ts             Shell command execution
│   ├── web-fetch.ts               HTTP page fetching
│   ├── web-search.ts              Web search via DuckDuckGo/Sogou
│   ├── ask-user.ts                Interactive user prompts
│   └── load-skill.ts              Dynamic skill loading
│
├── mcp/                            MCP protocol
│   ├── constants.ts               MCP timeout and protocol constants
│   ├── types.ts                   JSON-RPC, descriptor, and client interface types
│   ├── utils.ts                   Error formatting, env interpolation, auth helpers
│   ├── protocol-cache.ts          On-disk protocol negotiation cache
│   ├── stdio-client.ts            Stdio transport MCP client
│   ├── http-client.ts             Streamable HTTP transport MCP client
│   ├── registry.ts                Server discovery and tool registration factory
│   ├── tool-utils.ts              MCP response formatting and schema normalization
│   ├── helper-tools.ts            Resource/prompt wrapper tools for MCP servers
│   └── status.ts                  MCP server status aggregation
│
├── tty/                            TTY application
│   ├── app.ts                     Full-screen TTY application shell
│   ├── types.ts                   TTY state and screen types
│   ├── state.ts                   Navigation, scroll, history, render helpers
│   ├── transcript-helpers.ts      Transcript entry manipulation and formatting
│   └── approval-controller.ts     Permission approval prompt logic
│
├── tui/                            TUI rendering
│   ├── index.ts                   Barrel re-exports for the TUI layer
│   ├── constants.ts               Terminal layout constants (widths, rows, limits)
│   ├── chrome.ts                  Panels, banners, borders, badges, diff colorizer
│   ├── transcript.ts              Transcript rendering and scrolling
│   ├── input.ts                   Input prompt rendering
│   ├── input-parser.ts            Raw terminal input → key event parser
│   ├── screen.ts                  Screen clearing and cursor management
│   ├── markdown.ts                Lightweight terminal markdown renderer
│   └── types.ts                   Shared TUI type definitions
│
├── i18n/                           Internationalization
│   ├── index.ts                   Translation lookup, interpolation, and locale loading
│   ├── languages.ts               Supported UI languages and auto-detection
│   └── locales/                   Built-in locale dictionaries (en, es)
│
└── utils/                          General utilities
    ├── fs.ts                      File-system helpers (readTextFileOrNull)
    ├── http.ts                    HTTP retry helpers (sleep, shouldRetryStatus)
    ├── web.ts                     Web fetching and search (DuckDuckGo, Sogou)
    ├── command-line.ts            Shell command-line tokenizer
    └── errors.ts                  Error code extraction utilities
```

## Key patterns

- **Domain-driven directory structure**: Source files are grouped by domain (agent, context, config, permissions, commands, session, workspace, tools, mcp, tty, tui, i18n, utils). Only three global files remain at `src/` root: `index.ts`, `constants.ts`, and `types.ts`.
- **Barrel re-exports**: `tui/index.ts` acts as the public API surface for the rendering layer.
- **Shared constants**: Magic numbers live in `constants.ts`, `mcp/constants.ts`, and `tui/constants.ts` instead of inline.
- **Localized UI strings**: User-facing CLI/TUI text goes through `i18n/t()` so the interface can switch language without forking logic.
- **Tool contract**: Every tool implements `ToolDefinition<T>` with a Zod schema and an `inputSchema` for the model.
- **Permission flow**: Tools that modify the filesystem go through `applyReviewedFileChange` which shows a diff for user approval.
- **MCP transport abstraction**: Both stdio and HTTP clients implement `McpClientLike` so the registry treats them uniformly.

## Context window management

OnceCode tracks token usage reported by the provider and automatically compacts the conversation when the context window fills up. The design was informed by studying ForgeCode, Qwen-Code, and OpenCode.

### Token accounting

- The Anthropic adapter extracts the `usage` object from every API response (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`).
- `ContextTracker` records each response's usage and exposes `usageFraction`, `usagePercent`, `warningLevel`, and `shouldCompact()`.
- `lastInputTokens` (input + cache_creation + cache_read) serves as the primary proxy for current context size because it reflects exactly what the provider computed.

### Context window sizing

- `context/window.ts` contains a static table of 21 regex rules mapping model IDs to context window sizes (e.g. Anthropic = 200K, GPT-5 = 128K, Gemini 2.5 = 1M).
- `getContextWindowSize(model)` returns the limit; `getEffectiveContextBudget()` subtracts `maxOutputTokens` and a 20K compaction buffer to determine the usable budget.

### Compaction

Two-phase compaction in `context/compaction.ts`:

1. **Micro-compact**: Clears old tool_result outputs (>200 chars, outside the last 3 user turns) with a placeholder. This is fast, local, and does not call the model.
2. **Full compaction**: Sends the entire conversation to the model with a structured summarisation prompt. The result replaces all old messages with: retained system messages + summary + assistant acknowledgement + the last user message.

Auto-compaction runs before each agent turn when `contextTracker.shouldCompact()` returns true. Users can also trigger `/compact` manually.

### TUI integration

- The banner displays a `[context XX%]` badge with colour coding: green (<60%), yellow (60-80%), red (>80%).
- `/context` prints detailed tracker stats; `/compact` triggers manual compaction.

## Why it is good for learning

One strength of OnceCode is that it delivers production-grade behavior and core architectural ideas in a much lighter implementation.

That makes it well suited to:

- Learning the basic pieces of a terminal coding agent
- Studying tool-calling loops
- Understanding permission approval and file review flows
- Seeing how skills and external MCP tools can be added without a heavy plugin platform
- Seeing a lightweight distinction between foreground tool execution and background shell tasks
- Experimenting with how terminal UIs are organized
- Customizing further on top of a small codebase

## Future improvements

1. A more complete virtual-scrolling transcript
2. Richer input editing behavior
3. A finer-grained tool execution status panel
4. Session history persistence and project memory
5. Stronger UI componentization
