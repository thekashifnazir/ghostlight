#!/bin/bash
# Run a PowerShell snippet in the Ghostlight Win11 VM as the logged-in user. Usage: vmps.sh 'script'
V=6679e65f-39d6-4a73-875f-660fba0b0df1
E=$(printf '$ProgressPreference="SilentlyContinue"; %s' "$1" | iconv -t UTF-16LE | base64)
prlctl exec $V --current-user powershell -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $E 2>&1 | grep -v -e '^#< CLIXML' -e '^<Objs'
