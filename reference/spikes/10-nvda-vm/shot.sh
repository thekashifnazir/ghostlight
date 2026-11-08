#!/bin/bash
# Screenshot from inside the VM's user session -> $1 (png, 1000px wide)
D=$(dirname "$0")
"$D/vmps.sh" 'Add-Type -Name D -Namespace W -MemberDefinition "[DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();"; [W.D]::SetProcessDPIAware() | Out-Null; Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0,0,0,0,$bmp.Size); $ms=New-Object IO.MemoryStream; $bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray())' | tr -d '\r\n ' | base64 -d > "$1.full.png" && sips -Z 1000 "$1.full.png" --out "$1" >/dev/null && rm "$1.full.png"
