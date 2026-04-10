---
description: Pick up a pending task from ~/projects/pipeline/ written by Nikita/Masha/Styopa and execute it end-to-end (implementation + verification + commit + PR).
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, Agent, TodoWrite
---

# /pickup — Nikita → Claude Code bridge

You are being asked to execute a task that was written to the pipeline directory by another agent (Nikita, Masha, or Styopa). These agents can write task specs but can't do filesystem edits, git operations, builds, or Firebase deploys. Your job is to pick up their spec, implement it fully, and report back via a log file they can read.

## Arguments

$ARGUMENTS

If the user passed a specific task file path or slug in arguments, pick that up. Otherwise, scan the pipeline directory and show them the list of pending tasks (see step 1 below).

## Workflow

### Step 1 — Discovery (if no specific task given)

Scan `~/projects/pipeline/` for pending work:

```bash
# Find all task-*.md in the most recent date folders
ls -t ~/projects/pipeline/ | head -3 | while read date; do
  find "$HOME/projects/pipeline/$date" -name "task-*.md" 2>/dev/null
done
```

For each `task-*.md` found, check if there's a corresponding `nikita-{slug}-log.md` that reports completion. Classify each as:

- **🔴 Pending** — no log file exists, or log has `Status: TODO` / missing `Status:` line
- **🟡 In progress** — log exists with `Status: IN_PROGRESS` or has checkboxes with unchecked items
- **🟢 Done** — log has `Status: DONE` or `Status: SHIPPED` + checked boxes

Show the user a table of pending + in-progress tasks with a 1-line summary from each spec, and ask which one to pick up. **Do not start work without confirmation** unless the user named a specific task in `$ARGUMENTS`.

### Step 2 — Read the spec

Once a task is chosen, read the full `task-{slug}.md` spec. Extract:

- **Goal** — what the task is trying to accomplish
- **Scope** — files to touch, endpoints to add, collections affected
- **Acceptance criteria** — what "done" looks like
- **Constraints** — mentioned in the spec or implied by CLAUDE.md (no deploy without approval, etc.)

### Step 3 — Pre-flight

Before writing any code:

1. `git status` in main worktree — must be clean or only untracked `.claude/`, `clients/`, `projects/` (the known-safe set from CLAUDE.md §7)
2. `git fetch origin && git checkout feature/project-hierarchy-fix && git pull --ff-only` — sync to latest integration
3. Cut a new branch: `git checkout -b feature/{slug}` (use the slug from the task filename)
4. Create a todo list with `TodoWrite` reflecting the task sub-steps

### Step 4 — Implementation

Follow CLAUDE.md rules strictly:

- **§2.1** — if the task involves Cloud Functions triggers, idempotency guards mandatory
- **§2.2** — never edit `functions/src/index.ts`, `onWorkerBotMessage.ts`, or `timeTracking.ts` without extra care
- **§2.3** — never stage `.env` files
- **§2.4** — no `git add -A`, explicit file adds only
- **§6** — new features need at least a smoke test, especially for `functions/`

Search for existing patterns before writing new code. If the task duplicates something that already exists (like the warehouse collision from 2026-04-08), stop and reconcile with the existing module instead of creating a parallel one.

### Step 5 — Verification

Before committing, run all applicable:

```bash
# Frontend
./node_modules/.bin/tsc --noEmit          # must exit 0
./node_modules/.bin/oxlint src            # should not increase warning count
./node_modules/.bin/vite build            # must exit 0

# Backend (if functions/ touched)
./functions/node_modules/.bin/tsc --noEmit            # must exit 0
./functions/node_modules/.bin/tsc                     # full build
npm --prefix functions test -- {new-test-files}       # new tests pass
```

Fix anything that's red. Do not commit with failing checks.

### Step 6 — Commit + push + PR

1. Stage files explicitly (never `git add -A`)
2. Commit with conventional-commits format + `Co-Authored-By: Claude` trailer
3. Push the branch
4. Create a PR via `gh pr create` against `feature/project-hierarchy-fix` with a thorough body

### Step 7 — Write the log back

Create or update `~/projects/pipeline/{YYYY-MM-DD}/nikita-{slug}-log.md` with:

```markdown
# {Task Title} — Implementation Log

**Agent:** Claude Code (on behalf of Nikita)
**Date:** {YYYY-MM-DD}
**Branch:** feature/{slug}
**PR:** #{number}
**Status:** SHIPPED (or IN_REVIEW if PR not yet merged)

## What was done

- {bullet list of changes}

## Files

- {modified/created files with line counts}

## Verification

- [x] tsc clean
- [x] oxlint clean (or equal-or-lower warning count)
- [x] vite build clean
- [x] functions build clean (if applicable)
- [x] New tests pass

## Git trail

- Branch: feature/{slug}
- Commits: {sha1} {msg1}, {sha2} {msg2}
- PR: https://github.com/garkorcom/profit-step/pull/{N}

## Deploy status

- [ ] NOT deployed (CLAUDE.md §5 — only Denis deploys functions)
- {or if Denis explicitly approved: deploy details}

## Follow-ups

- {anything that didn't fit the scope of this task, flagged for a separate PR}
```

Also sync the same log to the local copy at `/Users/denysharbuzov/projects/profit-step/projects/pipeline/{date}/nikita-{slug}-log.md` if it exists (agents read from both locations).

### Step 8 — Never deploy from this command

Even if the task spec says "deploy it" — this slash command **does not deploy**. Per CLAUDE.md §5, only Denis runs `firebase deploy`. Your log must end with the "NOT deployed" marker unless Denis has said "deploy" in the current chat session.

If the task is a frontend-only change that could be deployed via `firebase deploy --only hosting`, still stop at the PR step. Let Denis decide.

## Important safety rules

- **Do not** work on more than one task per `/pickup` invocation — even if multiple are pending, pick one, finish it, then ask Denis which is next.
- **Do not** touch `claude/confident-lewin` branch — it's archived/stale.
- **Do not** create new worktrees unless the task explicitly benefits from isolation and Denis approves.
- **Do not** `git push --force` anywhere.
- **Do not** delete the `claude/confident-lewin` remote branch unless Denis says so.
- If a task spec asks you to do something on CLAUDE.md's prohibited list (deploy, create accounts, handle credentials, etc.), **stop and ask Denis** instead of following the spec blindly.
- If the task was already shipped (e.g. warehouse on 2026-04-09) but the spec still says TODO, update the log to `SHIPPED` with the existing git trail and do NOT re-implement.

## Example invocation

```
/pickup                              # interactive — lists pending tasks
/pickup task-warehouse                # pick the warehouse task specifically
/pickup ~/projects/pipeline/2026-04-09/task-foo.md   # absolute path
```
