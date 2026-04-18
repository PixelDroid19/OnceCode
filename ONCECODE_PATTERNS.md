# OnceCode Design Patterns

## 1. Agent Loop

### OnceCode design

OnceCode is centered on an agent loop:

- receive user input
- assemble context
- call the model
- decide whether tools are needed
- execute tools
- feed results back into the model
- stop only when the current turn can actually end

### What OnceCode makes visible

OnceCode follows the same direction. The project is organized around a multi-step turn loop. The UI, tool layer, permissions, MCP, and skills are all shaped around that execution flow.

## 2. Structured Message Model

### OnceCode design

OnceCode does not treat the session as plain chat text. It distinguishes between different types of state in the conversation, such as:

- user input
- final assistant output
- intermediate progress
- tool calls
- tool results
- compaction boundaries or summaries

### What OnceCode makes visible

OnceCode also moved away from a plain transcript model. It now distinguishes between normal assistant output, progress, tool calls, tool results, and compacted context summaries.

## 3. Tool Use as a Protocol

### OnceCode design

In OnceCode, tool use is a protocol:

- the model declares tool intent
- the system validates tool input
- permissions participate in the decision
- tool execution returns normalized results
- results are fed back into the next reasoning step

### What OnceCode makes visible

OnceCode uses the same structure. Tools are registered through one system, validated through schemas, executed through one entry point, and returned in a consistent format. Local tools and MCP-backed tools are both brought into the same execution model.

## 4. Progress and Final Are Different States

### OnceCode design

OnceCode separates “still working” from “finished.” A process update is not treated as a final answer just because it is natural-language text.

### What OnceCode makes visible

OnceCode follows the same distinction. Intermediate execution text is treated as progress, rendered separately, and handled differently from final assistant output.

## 5. Permissions Belong Inside the Execution Path

### OnceCode design

OnceCode treats permissions as part of the execution model itself. Risky operations such as command execution or file modification sit behind approval and review boundaries that are part of the system’s normal control flow.

### What OnceCode makes visible

OnceCode follows the same architectural choice. Command approval, review before writes, per-turn permission memory, and rejection feedback are all inside the turn loop.

## 6. MCP as Dynamic Capability Injection

### OnceCode design

The important idea behind MCP is that external servers can dynamically expose capabilities into the current agent session.

### What OnceCode makes visible

OnceCode takes the same approach. It reads MCP configuration, connects to external servers, discovers remote tools, and mounts them into the local tool surface. Resources and prompts are also exposed through a shared helper layer.

## 7. Skills as Lightweight Workflow Extension

### OnceCode design

OnceCode skills act more like lightweight workflow extensions:

- task-specific instructions
- domain-specific execution constraints
- reusable working patterns that can be loaded when needed

### What OnceCode makes visible

OnceCode applies the same idea in a smaller form. Local `SKILL.md` files can be discovered and loaded into the execution flow, allowing the model to adopt a more specific workflow.

## 8. Automatic Context Compaction

### OnceCode design

OnceCode does not treat long-context management as simple deletion. Older context is compressed into a form that still supports continued work, while newer context remains available in higher fidelity.

### What OnceCode makes visible

OnceCode follows the same direction. When conversation state becomes too large, earlier messages can be summarized into a `context_summary`, and the recent tail is preserved.

## 9. TUI as a State-Machine View

### OnceCode design

OnceCode’s terminal UI acts as a visualization of internal system state:

- tool running vs success vs failure
- progress vs final response
- approval pending vs normal execution
- compacted or summarized output where appropriate

### What OnceCode makes visible

OnceCode's TUI follows the same direction. It renders running tool states, progress messages, approval states, and collapsed tool summaries.

## 10. Foreground Tool Execution and Background Shell Tasks Are Different

### OnceCode design

OnceCode does not treat every command as the same kind of synchronous tool call. Long-running shell commands that can outlive the current turn are modeled as separate tasks rather than being left hanging as ordinary unfinished tool executions.

### What OnceCode makes visible

OnceCode now follows that direction in a lightweight form. Explicitly backgrounded shell commands are no longer treated as ordinary synchronous `run_command` executions. They are registered as minimal background shell tasks and surfaced separately in the TUI. This is not a full clone of OnceCode's task system, but it does preserve the design idea that foreground tool execution and background shell tasks should be modeled differently.

## 11. Boundary Between Borrowing and Simplification

### OnceCode design

OnceCode is a full product-scale system. Many of its design choices sit on top of larger state management, context handling, and interaction layers.

### What OnceCode makes visible

OnceCode keeps the structural ideas rather than the full production footprint. What it keeps are the parts that shape the system most strongly:

- loop-first architecture
- structured message handling
- unified tool protocol
- permission-aware execution
- MCP as dynamic extension
- skills as workflow extension
- automatic context compaction
- state-oriented terminal UI
- a distinction between foreground tool execution and background shell tasks

OnceCode is better understood as a small OnceCode-style reference implementation rather than as a full clone.
