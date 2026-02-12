# Session Context

## User Prompts

### Prompt 1

delete fdc-trusted-relayer dir, not neede on this branch

### Prompt 2

create folder for fdc-trustless-merkle

### Prompt 3

init openspec

### Prompt 4

Base directory for this skill: /home/tom/dev/oasis/flare-poc/.claude/skills/openspec-new-change

Start a new change using the experimental artifact-driven approach.

**Input**: The user's request should include a change name (kebab-case) OR a description of what they want to build.

**Steps**

1. **If no clear input provided, ask what they want to build**

   Use the **AskUserQuestion tool** (open-ended, no preset options) to ask:
   > "What change do you want to work on? Describe what you want ...

### Prompt 5

create change which alings with @docs/plan2.md

### Prompt 6

contitune

### Prompt 7

Base directory for this skill: /home/tom/dev/oasis/flare-poc/.claude/skills/openspec-continue-change

Continue working on a change by creating the next artifact.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **If no change name provided, prompt for selection**

   Run `openspec list --json` to get available changes sorted by most recently modified. Then u...

### Prompt 8

continue

### Prompt 9

continue

### Prompt 10

inid bd

### Prompt 11

Initialize beads issue tracking in the current directory.

If a prefix is provided as , use it as the issue prefix (e.g., "myproject" creates issues like myproject-1, myproject-2). If not provided, the default is the current directory name.

Use the beads MCP `init` tool with the prefix parameter (if provided) to set up a new beads database.

After initialization:
1. Show the database location
2. Show the issue prefix that will be used
3. Explain the basic workflow (or suggest running `/beads:wo...

### Prompt 12

yes import

