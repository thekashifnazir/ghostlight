# sr-keys.ps1 — press a sequence of key chords into Chrome inside the VM with
# REAL scan codes, then emit the new NVDA "Speaking" lines produced after each
# chord. Re-implemented for sr-harness from Spike 10's keys.ps1 technique; not
# copied from reference/.
#
# SCAN CODES ONLY. This script uses user32 keybd_event with MapVirtualKey scan
# codes so NVDA sees genuine typed keys. It NEVER uses WScript.Shell.SendKeys:
# SendKeys toggles Num Lock and emits numpad keys that NVDA treats as
# review-cursor commands, which gives false "the key worked" results (Spike 10).
#
# It does NOT decide pass/fail. It only presses keys and prints, per chord, a
# marker line followed by the raw new NVDA log lines. The Mac side (sr-match.ts)
# reduces and matches them, so all judgement lives in one unit-tested place.
#
# Usage:  sr-keys.ps1 "right,down,shift+r" [waitSecondsPerChord]
# Output, per input chord:
#   <<<CHORD right
#   Speaking [...]            (zero or more raw new nvda.log lines)
#   >>>CHORD right
param([string]$seq, [double]$wait = 1.5)

Add-Type -Name K -Namespace W -MemberDefinition @"
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
[DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
"@

# Virtual-key codes for named keys; single characters fall through to their
# uppercase char code below.
$vk = @{ left=0x25; up=0x26; right=0x27; down=0x28; enter=0x0D; esc=0x1B; tab=0x09; space=0x20; insert=0x2D; f1=0x70; shift=0x10; slash=0xBF; backspace=0x08 }
$ext = @('left','up','right','down','insert')  # extended-key flag required

function KeyDown($k) {
  $v = if ($vk.ContainsKey($k)) { $vk[$k] } else { [int][char]$k.ToUpper() }
  $f = if ($ext -contains $k) { 1 } else { 0 }
  [W.K]::keybd_event($v, [W.K]::MapVirtualKey($v, 0), $f, [UIntPtr]::Zero)
}
function KeyUp($k) {
  $v = if ($vk.ContainsKey($k)) { $vk[$k] } else { [int][char]$k.ToUpper() }
  $f = if ($ext -contains $k) { 3 } else { 2 }
  [W.K]::keybd_event($v, [W.K]::MapVirtualKey($v, 0), $f, [UIntPtr]::Zero)
}

$log = Join-Path $env:TEMP "nvda.log"

# Focus the browser (Chrome or Edge, whichever this run started) by the process
# that owns a visible window. Edge's title has a zero-width space in
# "Microsoft Edge", so activate by process id rather than by title.
$sh = New-Object -ComObject WScript.Shell
$bw = Get-Process chrome, msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($bw) { [void]$sh.AppActivate($bw.Id) } else { [void]$sh.AppActivate("Google Chrome") }
Start-Sleep -Milliseconds 600

foreach ($chord in $seq.Split(',')) {
  $before = if (Test-Path $log) { (Get-Content $log).Count } else { 0 }

  # Press the chord: modifiers + key down in order, then up in reverse. The
  # 'nvda' alias maps to the Insert modifier, matching the spike.
  $parts = $chord.Split('+') | ForEach-Object { if ($_ -eq 'nvda') { 'insert' } else { $_ } }
  foreach ($p in $parts) { KeyDown $p; Start-Sleep -Milliseconds 40 }
  [array]::Reverse($parts)
  foreach ($p in $parts) { KeyUp $p; Start-Sleep -Milliseconds 40 }

  Start-Sleep -Seconds $wait

  "<<<CHORD $chord"
  if (Test-Path $log) {
    Get-Content $log | Select-Object -Skip $before | Select-String "^Speaking " | ForEach-Object { $_.Line }
  }
  ">>>CHORD $chord"
}
