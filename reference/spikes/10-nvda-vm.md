# Spike 10: NVDA in a Windows VM, driven from the Mac (8 Nov 2026)

Written by Claude Code (co-pilot) as a spike, like the earlier ones. The scripts are in `10-nvda-vm/`. A real harness should be built from this by a Kiro spec.

## Set-up

- Parallels VM "Ghostlight Win11" (Windows 11 ARM, 8 GB RAM, no shared folders). Snapshots: `1 clean install`, `2 tools installed`, `3 NVDA logging + helpers`.
- Chrome 157, NVDA (installed copy, `C:\Program Files\NVDA`), Node 26.13, all via winget.
- NVDA config (`%APPDATA%\nvda\nvda.ini`): `loggingLevel = IO`, so every utterance lands in `%TEMP%\nvda.log` as a `Speaking [...]` line. Welcome, usage-stats and update prompts are off.
- Chrome starts with `--remote-debugging-port=9222 --user-data-dir=C:\gl\chrome` so the page can be read (live region, focus) without touching the input path.
- Default terminal set to the classic console host, so `prlctl exec` windows can start hidden and don't steal focus from Chrome.

## How it works

- `vmps.sh 'script'`: runs PowerShell in the VM as the logged-in user (`prlctl exec --current-user`, encoded command, hidden window). There's a command-length limit of about 8 KB, so `push.sh` copies files in chunks.
- `keys.sh 'right,down,nvda+space,shift+r' [wait]`: real key presses with scan codes (`keybd_event`), so NVDA sees them exactly as typed keys. After each chord it prints what NVDA said, taken from the new `Speaking` lines in the log.
- `peek.sh 'js'`: evaluates JS in the Ghostlight tab over the debugging port (focused element, live-region text).
- `shot.sh out.png`: screenshot from inside the session. `prlctl capture` returns black while NVDA or UAC is involved.
- Don't use `WScript.Shell.SendKeys` for arrows. It toggles Num Lock and sends numpad keys, which NVDA treats as review-cursor commands, so the results are false.

## Findings (live site, build `index-DK-f1zY2.js`)

1. **NVDA's browse mode eats every game key.** After Start, focus is on `<body>` and NVDA stays in browse mode. Right arrow moved NVDA's virtual cursor by one character, Down read the next line of the page, and `L` said "no next list" (NVDA's quick-nav key). The game got nothing. After NVDA+Space (focus mode), everything worked: "bin, 2 of 10", examine read the menu board, `L` read the room, and H, Tab, Escape, Shift+R, V, S, N and G all spoke the right lines. **Fix:** move focus on start to a game element with `role="application"` (NVDA and JAWS switch to focus mode on their own), keep focus there after menus close, and say "If keys don't work, press NVDA+Space" in onboarding and F1. VoiceOver on the Mac doesn't intercept keys the same way, which is why our Mac testing missed this.
2. **Chrome asks "Control and reprogram MIDI devices?"** as soon as the engine boots (ScummVM's Web MIDI probe). It's a surprise permission dialog for a screen-reader user. **Fix:** stop the probe, either with a build flag or by hiding `navigator.requestMIDIAccess` before the module loads.
3. **The tab title changes** from "Ghostlight ..." to "Drascula: The Vampire Strikes Back (DOS/English)" once ScummVM boots. NVDA says that every time the window gets focus, and "Ghostlight" disappears. **Fix:** set the title back after boot (for example "Ghostlight: Drascula").
4. **Menus speak twice.** Tab says "Inventory, 1 item. mobile phone, 1 of 1." in the live region, then NVDA reads the focused item again ("mobile phone, 1 of 1"). The verb menu does the same. **Fix:** when focus moves to an item, the live-region line gives the menu name and count only.
5. **Escape from a menu puts focus back on the document**, so NVDA reads the page title again plus a stray character. With the `role="application"` fix, focus should go back to the game element.
6. Dialogue lines are all capitals (it's the game's own text). NVDA reads them fine. Braille users get capitals. A sentence-case option could come later.

Working fine: the live region (`role=log`, polite), hints, the inventory and verb menus, line history, sonar summary and step, the ghost toggle, and the bartender conversation, which played all lines in order.

## Pre-deploy re-run (8 Nov, about 16:00, build at d6d67aa)

Claude Code served the build from the Mac to the VM (`http://10.211.55.2:5175`, Chrome started with a fresh profile and `--unsafely-treat-insecure-origin-as-secure` so Web Crypto behaves as on HTTPS). NVDA in its default state, no NVDA+Space:

- Start puts focus on "Ghostlight game" and NVDA switches to focus mode by itself. Right, Down, H, Tab, Escape and L all reach the game and speak once.
- No MIDI permission prompt with a fresh profile. Tab title stays "Ghostlight: Drascula".
- H twice: nudge, then clue. C: "Saved." Reload: focus lands on Continue; Enter: "Loaded: Inn bar", and keys work straight away.
- Still to fix (minor): "Nothing happened." is spoken just before "Saved."; the Web MIDI stub's rejection shows as an unhandled "disabled" error in the console (no effect on players).
- Found on the way: on a plain-http origin `crypto.subtle` is missing, so before 17a6f64 H said nothing there. HTTPS (the live site) was never affected.

## Live run (8 Nov, about 18:45, ghostlight.kashifnazir.com, bundle `index-CwP9MWY3.js`)

Claude Code, same VM (snapshot 3 state), fresh Chrome profile, NVDA in its default state, no NVDA+Space. Passes the tester-DM checklist:

- Space on the landing page starts the engine; Tab then lands on "Ghostlight game" and NVDA reads the room. Keys reach the game without NVDA+Space.
- Right: "bin, 2 of 10". Down: the bin description plus the game's own line. H twice: nudge, then clue. Tab: "Inventory, 1 item." then "mobile phone, 1 of 1" (once each). Escape: "Closed inventory." and focus back on "Ghostlight game". L reads the room.
- C: "Saved." only (the "Nothing happened." fix is live).
- Reload: focus lands on Continue ("main landmark, Continue, button"); Enter: "Loaded: Inn bar", and Right works straight away.
- No MIDI prompt; tab title "Ghostlight: Drascula".
- Harness noise only: hidden `prlctl exec` windows briefly take focus ("terminal, blank") and SendKeys toggles Num Lock. Neither reaches players.
