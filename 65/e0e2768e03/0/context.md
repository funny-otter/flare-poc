# Session Context

## User Prompts

### Prompt 1

whats the bd ready and opensec list state

### Prompt 2

start working on bd tasks and keep openspec in sync

### Prompt 3

run it, the pk is funded

### Prompt 4

withdraw why deposit minus gas? which gas? who pays for gas?

### Prompt 5

no ok thanks.
can you verify the contract on sapphire via sourcify

### Prompt 6

sync openspec, all task done? can we archive?

### Prompt 7

Base directory for this skill: /home/tom/dev/oasis/flare-poc/.claude/skills/openspec-sync-specs

Sync delta specs from a change to main specs.

This is an **agent-driven** operation - you will read delta specs and directly edit main specs to apply the changes. This allows intelligent merging (e.g., adding a scenario without copying the entire requirement).

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MU...

### Prompt 8

yes

### Prompt 9

Base directory for this skill: /home/tom/dev/oasis/flare-poc/.claude/skills/openspec-archive-change

Archive a completed change in the experimental workflow.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **If no change name provided, prompt for selection**

   Run `openspec list --json` to get available changes. Use the **AskUserQuestion tool** to let the...

### Prompt 10

all commited?

### Prompt 11

yes

