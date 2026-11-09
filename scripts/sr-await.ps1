# sr-await.ps1 — press a chord (or sequence), then wait for a specific line to
# appear in the PAGE's live region (read over Chrome's debugging port) before
# capturing what NVDA said. Re-implemented for sr-harness; not copied from
# reference/.
#
# This is the deterministic alternative to a fixed sleep for steps whose spoken
# line lands after a variable delay (the Start step: onboarding is appended to
# the first room reading, which arrives when the engine is ready, not at a fixed
# time). Instead of guessing a duration, we poll the live region until the
# awaited substring shows, then read the NVDA speech produced since the press.
#
# Everything runs in ONE prlctl round-trip (press + poll + capture), which
# matters because per-call VM latency is the harness's main cost. Keys are
# pressed with scan codes via sr-keys.ps1's presser logic (loaded here), never
# WScript SendKeys.
#
# Usage:  sr-await.ps1 "<chord[,chord]>" "<awaitSubstring>" <capSeconds>
# Output: the raw new NVDA "Speaking [...]" lines (same shape sr-match reduces).
param(
  [string]$seq,
  [string]$await,
  [double]$cap = 8
)

# sr-vm-lib runs this as a scriptblock, where MyCommand.Path is empty, so fall
# back to the staging dir. (Seen 9 Nov: an empty $gl made every live-region
# poll throw "Join-Path ... null", so the await silently became a fixed sleep
# of the whole cap.)
$gl = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { 'C:\gl' }
$log = Join-Path $env:TEMP "nvda.log"
$node = "C:\Program Files\nodejs\node.exe"
$cdp = Join-Path $gl "sr-cdp.mjs"

# --- scan-code key press (same technique as sr-keys.ps1; SendKeys is never used) ---
Add-Type -Name KA -Namespace W -MemberDefinition @"
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
[DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
"@
$vk = @{ left=0x25; up=0x26; right=0x27; down=0x28; enter=0x0D; esc=0x1B; tab=0x09; space=0x20; insert=0x2D; f1=0x70; shift=0x10; slash=0xBF; backspace=0x08 }
$ext = @('left','up','right','down','insert')
function KeyDown($k){ $v = if ($vk.ContainsKey($k)) { $vk[$k] } else { [int][char]$k.ToUpper() }; $f = if ($ext -contains $k) {1} else {0}; [W.KA]::keybd_event($v,[W.KA]::MapVirtualKey($v,0),$f,[UIntPtr]::Zero) }
function KeyUp($k){ $v = if ($vk.ContainsKey($k)) { $vk[$k] } else { [int][char]$k.ToUpper() }; $f = if ($ext -contains $k) {3} else {2}; [W.KA]::keybd_event($v,[W.KA]::MapVirtualKey($v,0),$f,[UIntPtr]::Zero) }

# --- read the page's live-region text over the debugging port ---
function LiveRegionText {
  $expr = "(function(){var n=document.querySelector('#live-region,[role=log]');return n?n.textContent:'';})()"
  [IO.File]::WriteAllText((Join-Path $gl 'sr-live.js'), $expr)
  try { & $node $cdp (Join-Path $gl 'sr-live.js') 2>$null } catch { '' }
}

# Focus Chrome so keys land in the page.
$sh = New-Object -ComObject WScript.Shell
[void]$sh.AppActivate("Google Chrome")
Start-Sleep -Milliseconds 600

# Record the NVDA log size before the press, so we capture only new speech.
$before = if (Test-Path $log) { (Get-Content $log).Count } else { 0 }

# Press each chord in the sequence (modifiers down in order, up in reverse).
foreach ($chord in $seq.Split(',')) {
  $parts = $chord.Split('+') | ForEach-Object { if ($_ -eq 'nvda') { 'insert' } else { $_ } }
  foreach ($p in $parts) { KeyDown $p; Start-Sleep -Milliseconds 40 }
  [array]::Reverse($parts)
  foreach ($p in $parts) { KeyUp $p; Start-Sleep -Milliseconds 40 }
}

# Poll the live region until the awaited substring appears, or the cap elapses.
$deadline = (Get-Date).AddSeconds($cap)
if ($await -and $await.Length -gt 0) {
  while ((Get-Date) -lt $deadline) {
    $txt = LiveRegionText
    if ($txt -and $txt.ToLower().Contains($await.ToLower())) { break }
    Start-Sleep -Milliseconds 400
  }
  # A short settle so NVDA finishes speaking the line it just received.
  Start-Sleep -Milliseconds 500
} else {
  Start-Sleep -Seconds $cap
}

# Emit the new NVDA Speaking lines produced since the press.
if (Test-Path $log) {
  Get-Content $log | Select-Object -Skip $before | Select-String "^Speaking " | ForEach-Object { $_.Line }
}
