# Real key presses (with scan codes) to Chrome, then print what NVDA said. Usage: keys.ps1 "nvda+space,right,down" [waitSecondsPerKey]
param([string]$seq, [int]$wait = 3)
Add-Type -Name K -Namespace W -MemberDefinition @"
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
[DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
"@
$vk = @{ left=0x25; up=0x26; right=0x27; down=0x28; enter=0x0D; esc=0x1B; tab=0x09; space=0x20; insert=0x2D; f1=0x70; shift=0x10; slash=0xBF; backspace=0x08 }
$ext = @('left','up','right','down','insert')
function down($k){ $v = if ($vk.ContainsKey($k)) { $vk[$k] } else { [int][char]$k.ToUpper() }; $f = if ($ext -contains $k) {1} else {0}; [W.K]::keybd_event($v,[W.K]::MapVirtualKey($v,0),$f,[UIntPtr]::Zero) }
function up($k){ $v = if ($vk.ContainsKey($k)) { $vk[$k] } else { [int][char]$k.ToUpper() }; $f = if ($ext -contains $k) {3} else {2}; [W.K]::keybd_event($v,[W.K]::MapVirtualKey($v,0),$f,[UIntPtr]::Zero) }
$log = Join-Path $env:TEMP "nvda.log"
$sh = New-Object -ComObject WScript.Shell; [void]$sh.AppActivate("Google Chrome"); Start-Sleep -Milliseconds 600
foreach ($chord in $seq.Split(',')) {
  $n = (Get-Content $log).Count
  $parts = $chord.Split('+') | % { if ($_ -eq 'nvda') { 'insert' } else { $_ } }
  foreach ($p in $parts) { down $p; Start-Sleep -Milliseconds 40 }
  [array]::Reverse($parts); foreach ($p in $parts) { up $p; Start-Sleep -Milliseconds 40 }
  Start-Sleep $wait
  $said = Get-Content $log | Select -Skip $n | Select-String "^Speaking " | % { $_.Line -replace "^Speaking \[","" -replace "LangChangeCommand \(.en_US.\), ","" -replace ", CancellableSpeech \(still valid\)\]$","" }
  "[$chord] " + (($said | Where { $_ -notmatch "Google Chrome', 'window'|', 'document'$" }) -join " | ")
}
