# Screenshots

These are picked from about 230 taken while building Ghostlight in Kiro between 6 and 11 Nov 2026. The 20 JPEGs were shrunk to 1600 px wide. The full set is kept outside the repo.

## Specs, steering and hooks

- `2026-11-06-01-spec-requirements-and-chat.png`: the engine spec's requirements next to the Kiro chat.
- `2026-11-06-02-process-log-and-powers.png`: the process log and the installed powers.
- `2026-11-06-03-tasks-hooks-steering-mcp.png`: the task list, hooks, steering files and MCP servers in one view.
- `2026-11-06-04-process-log-hook.png`: the hook that writes a process-log entry after each task.
- `2026-11-06-05-design-revision-diff.png`: a design revision shown as a diff.
- `2026-11-06-06-design-diff-and-approval-prompt.png`: the design diff with Kiro asking for approval.
- `2026-11-06-26-validate-pack-on-save-hook.jpg`: the hook that runs the pack validator whenever a file under packs/ is saved.
- `2026-11-06-63-player-spec-complete-21-of-21.jpg`: the player spec with all 21 tasks done.
- `2026-11-07-157-security-hook-blocks-own-write.jpg`: the new pre-tool-use security hook blocks Kiro's own first write.

## Kiro catching itself

- `2026-11-06-07-kiro-checks-environment-before-faking.jpg`: Kiro checks the machine before claiming it can run a native build, instead of faking checkpoints.
- `2026-11-06-08-kiro-offers-honest-options.jpg`: Kiro lays out three honest options when it can't run the checkpoints.
- `2026-11-06-10-rm-rf-denied-by-guardrail.jpg`: an `rm -rf` is denied by the permission rules and Kiro finds a safer way.
- `2026-11-06-16-pack-chat-flags-own-commit-mistake.jpg`: the pack chat finishes its spec and flags what's worth checking.
- `2026-11-06-35-harness-property-tests-found-contract-issues.jpg`: property tests find four real contract issues in the engine harness.
- `2026-11-06-48-engine-chat-spots-parallel-duplicate.jpg`: the engine chat notices a parallel chat already added the same steering rule.
- `2026-11-07-106-engine-takes-root-cause.jpg`: the engine chat takes a root cause for the chapter crossing and checks it before fixing.
- `2026-11-07-113-w3-finds-inv-inventory-mismatch.jpg`: the MCP spec chat finds an `inv` versus `inventory` mismatch between two contracts.

## Parallel chats, MCP, powers and workflows

- `2026-11-06-14-two-chats-in-parallel.jpg`: the engine and pack specs running in two chats at once.
- `2026-11-07-131-drascula-mcp-connected-16-tools.jpg`: the game's own MCP server connected in Kiro with 16 tools.
- `2026-11-07-173-power-audit-12-differences.jpg`: the Build a Power audit finds 12 differences from the new plugin format.
- `2026-11-07-183-workflow-creator-designs-steps.jpg`: a bug from the Crew survey handed to a Kiro workflow, which designs its own steps.
- `2026-11-07-189-examine-workflow-complete.jpg`: the examine-fix workflow done: code, review, tests, deploy.
- `2026-11-07-199-spec-check-hints-58-of-59.jpg`: the spec-check workflow's two reviewers agree on 58 of 59 acceptance criteria and find the one real gap.

## The game and the player

- `2026-11-06-27-engine-real-window-tavern.jpg`: the patched engine running natively in a real window, in the tavern.
- `2026-11-07-90-web-build-live-preview-deployed.jpg`: the web build spec done, with the first live preview deployed.
- `2026-11-08-01-nvda-vm-chrome-midi-prompt.jpg`: the live site in Chrome on the Windows test VM before the NVDA run.
- `2026-11-08-02-nvda-vm-predeploy-no-midi-prompt.png`: the same check after the fix, with no MIDI prompt.

## Kiro features added on 11 Nov

- `2026-11-11-01-whats-new-approve-for-me.png`: What's new: Approve for me.
- `2026-11-11-02-whats-new-memory.png`: What's new: memory.
- `2026-11-11-03-whats-new-workflows.png`: What's new: workflows.
- `2026-11-11-04-approve-for-me-hint-fix-started.png`: the H-hint fix started under Approve for me.
- `2026-11-11-05-approve-for-me-runs-command.png`: Approve for me running a command without a prompt.
- `2026-11-11-06-permission-mode-menu.png`: the permission mode menu.
- `2026-11-11-07-hint-fix-done-6-58-credits.png`: the H-hint fix done for 6.58 credits.
