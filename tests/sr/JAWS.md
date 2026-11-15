# Testing with JAWS (no speech log)

How Ghostlight was checked with JAWS on 15 Nov 2026, written so the method can be reused, for example by QuestAloud's pack tooling. NVDA writes every utterance to `nvda.log` with a timestamp, so `sr-check.sh` reads speech straight from it. JAWS has no speech log, so this method listens to it instead.

## Set-up

- **VM:** "Ghostlight Win11" (Parallels, Windows 11 ARM64).
- **JAWS:** JAWS 2027.2610.428 (November 2026), downloaded from Freedom Scientific's JAWS downloads page. The `-any.exe` installer picks ARM64 by itself, and `jfw.exe` is a native ARM64 binary.
  - Silent install: `J2027....exe /type silent`. The installer is Authenticode-signed by Freedom Scientific Inc.
  - The first launch asks for one restart, then JAWS runs in **40-minute mode**: free for 40 minutes per Windows boot, and a full restart (`shutdown /r /t 0`) gives another 40.
  - JAWS registers as an assistive technology but doesn't start at login.
- **Snapshot:** `with-jaws-2026-11-15` is a fresh boot with JAWS installed and not yet started. Every run switches to it, so each run gets a full 40 minutes and leaves nothing behind. It's also the VM's current state. Harnesses that revert to an older snapshot (`before-questaloud-2026-11-15`, `5 edge ready`) are fine for NVDA, but they leave the VM without JAWS afterwards.
- **Activation dialog:** each start shows a "JAWS Activation" dialog. The runner presses **Continue to Run in 40 Minute Mode** through Windows UI Automation (InvokePattern), with no activation and nothing bought. If it's left open, it sits on top of Edge and can take key presses.

## Capturing what JAWS says

1. **Edge starts with `--mute-audio`.** The game's own voices are silent, so the only sound out of the VM is JAWS.
2. **The VM's sound plays through the Mac,** so `sysaudio-rec` (ScreenCaptureKit, works with the Mac muted) records JAWS as system audio.
3. **whisper.cpp transcribes the recording with word timings:** `whisper-cli -ml 1 -sow -oj`, model `ggml-small.en`.
4. **Line the two clocks up with a beep.** The step script in the VM logs its clock, then plays `[console]::Beep(2900,400)`. On the Mac, a 2.9 kHz band-pass plus `silencedetect` finds the beep's onset, which gives the VM-to-recording offset to within tens of milliseconds.
   - Don't trust a `prlctl exec` round-trip bracket for this. It was off by about 1.2 s.
   - Don't use JAWS's key echo either. It lags 0.3 to 2.5 s when JAWS is busy.
5. **Press every key from one PowerShell process in the VM,** reusing `scripts/sr-keys.ps1` for scan codes and logging each step's time on the VM clock. A separate `prlctl exec` per key opens a console window each time, and JAWS reads its title aloud ("C colon backslash…").
6. **Get page events from the same recorder as the NVDA runs:**
   - `A11Y_VTEXT` and `A11Y_VEND` give the actor line windows.
   - Live-region writes are timestamped on the VM clock through CDP.

## Judging

- **Scenario steps** (tests/sr/scenarios/*.json): the words heard between one step and the next, plus about 1 s for JAWS's start lag, are matched against `expectSpoken` and `expectNotSpoken`. Numbers are normalised ("two" to "2"), because whisper writes some as words.
- **D off:** any JAWS word inside an actor line's window counts as an overlap. The exception is utterances that are clearly VM or browser noise ("C colon backslash Program Files Parallels…", "Microsoft Edge" window titles), which are dropped and listed separately, the way the NVDA comparer drops `prl_tools`.
- **D on:** JAWS reads the actor lines on purpose, so an overlap is a word from line *i* heard while line *i+1* is playing.

## Known limits

- whisper mishears some words ("drunk" as "drug"), and its word edges are only good to about 0.2 to 0.5 s. Treat sub-second overlaps as worth a listen, not as proof.
- **JAWS speaks things NVDA doesn't:**
  - the key it heard ("enter", "L", "H")
  - "leaving menus"
  - the page title more than once on the first room

  These are JAWS defaults, not Ghostlight output.
- Re-recording an NVDA scenario for JAWS needs longer waits on long readouts. JAWS's default rate is slower, so the first room needs about 30 s, not 15 s.

## Where the scripts are

The runner (`jaws-run.sh`) and analyser (`analyse.py`) were written as scratch tools on 15 Nov and are not part of this repo. QuestAloud was sent copies to turn into reusable tooling.
