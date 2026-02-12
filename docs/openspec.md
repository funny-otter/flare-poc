# OpenSpec — Knowledge Document

> Source: [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)
> License: MIT

## What It Does

A spec framework for AI-assisted development. OpenSpec adds a lightweight specification layer between humans and AI coding assistants so you agree on *what* to build before any code is written.

- **Structured planning** — each change gets its own folder with proposal, specs, design, and tasks
- **Iterative workflow** — no rigid phase gates; update any artifact anytime
- **Multi-agent support** — works with 20+ AI assistants (Claude Code, Cursor, Copilot, Windsurf, Cline, etc.) via slash commands
- **Delta-based changes** — specs describe current behavior; changes propose modifications that merge back when archived

## Architecture Overview

```
openspec/
├── specs/                      # Source of truth (current system behavior)
│   ├── auth/spec.md
│   ├── payments/spec.md
│   └── ...
├── changes/                    # Proposed modifications (one folder per change)
│   ├── add-dark-mode/
│   │   ├── proposal.md         # Why we're doing this
│   │   ├── specs/              # Requirement deltas
│   │   ├── design.md           # Technical approach
│   │   └── tasks.md            # Implementation checklist
│   └── archive/                # Completed changes (merged into specs/)
└── config.yaml                 # Project-level OpenSpec config
```

## Core Workflow

```
/opsx:new <name>      → Create change folder
/opsx:ff              → Fast-forward: generate proposal → specs → design → tasks
/opsx:apply           → Implement tasks from the spec
/opsx:archive         → Archive change, merge deltas into specs/
```

## Key Concepts

- **Specs** — structured Markdown describing system behavior with requirements and scenarios
- **Changes** — proposed modifications; each is a folder containing planning artifacts
- **Artifacts** — the documents within a change (proposal, specs, design, tasks)
- **Schemas** — configurable templates that control artifact structure (built-in `spec-driven` schema or custom)
- **Delta-based specs** — changes include spec deltas that describe *what's different*, not the whole spec

## Tech Stack

- TypeScript (strict, ESM)
- Node.js 20.19+
- pnpm for package management
- Vitest for testing
- esbuild for bundling (single-file CLI output)
- Zod for schema validation

## Why It Matters for This Project

OpenSpec provides a structured way to plan and track the FDC accounting PoC implementation across multiple approaches (Plan 1: Trusted Relayer, Plan 2: Merkle Verification). Its change-based workflow maps well to iterating on cross-chain verification designs where requirements evolve as we learn more about FDC's Merkle proof format and Sapphire integration.

## Project Metadata

- **554 files**, ~41k lines of code
- CLI tool distributed via npm: `@fission-ai/openspec`
- Supports project-local schemas and global config (`~/.openspec/`)
- Shell completions for bash, zsh, fish, PowerShell
- PostHog telemetry (opt-out via `OPENSPEC_TELEMETRY=0`)
