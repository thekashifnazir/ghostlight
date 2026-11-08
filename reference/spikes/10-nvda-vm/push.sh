#!/bin/bash
# Copy a local file into the VM at C:\gl\<name>, in chunks (prlctl exec has a command-length limit).
D=$(dirname "$0"); N=$(basename "$1"); B=$(base64 < "$1" | tr -d '\n'); P="C:\\gl\\$N"
"$D/vmps.sh" "Set-Content -NoNewline -Path '$P.b64' -Value ''" >/dev/null
for ((i=0; i<${#B}; i+=700)); do "$D/vmps.sh" "Add-Content -NoNewline -Path '$P.b64' -Value '${B:i:700}'; (Get-Item '$P.b64').Length" | tail -1; done
"$D/vmps.sh" "[IO.File]::WriteAllBytes('$P',[Convert]::FromBase64String((Get-Content -Raw -Path '$P.b64'))); Remove-Item '$P.b64'; (Get-Item '$P').Length"
