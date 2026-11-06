---
inclusion: always
---

# Process log

`docs/kiro-process.md` is the running record of building Ghostlight in Kiro. It is part of the hackathon write-up and the Technological Implementation story. Keeping it current is not optional.

## When to write an entry

- After every spec phase you finish (requirements, design, or tasks for any spec).
- After every task you complete.

Never skip the entry. If you finished work and there is no matching entry, you are not done.

## What each entry contains

Append to the end of `docs/kiro-process.md` (dated entries, newest last). Each entry:

- A heading with the next sequence number, the date, and a short title.
- **What was asked:** the request in one or two sentences.
- **What Kiro did:** the actual work.
- **Files changed:** the paths created or edited.
- **Time taken:** rough is fine.
- **What went wrong or surprised you:** gotchas, dead ends, anything unexpected. Write "nothing" only if truly nothing.
- **What was learned:** the takeaway for next time.

Keep it honest and specific. This is a log, not marketing.

## Keep the feature table current

Whenever a Kiro feature is first used, update its row in `docs/kiro-features.md` (status and evidence path) as part of the same logging pass.

## Then commit and push

After writing the entry:

1. Stage the specific files you changed (not `git add .`).
2. Commit with a clear message describing the work (not just "update log").
3. Push. Pushing straight to `main` is fine in this repo.

Do not amend or force push. Leave git config and hooks alone. Flag any file that might contain a key before committing.

## Entry 02

Entry 02 covers the first Kiro reading of `reference/` and playing the project back without writing code. Fill in its blanks from the actual chat: what was asked, what was read, time taken, and anything learned. Do this as part of the first logging pass.
