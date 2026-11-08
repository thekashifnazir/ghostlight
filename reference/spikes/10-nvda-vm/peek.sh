#!/bin/bash
# Evaluate JS ($1) in the Ghostlight tab inside the VM and print the result. cdp.mjs must already be at C:\gl.
D=$(dirname "$0"); X=$(printf '%s' "$1" | base64 | tr -d '\n')
"$D/vmps.sh" "[IO.File]::WriteAllBytes('C:\gl\expr.js',[Convert]::FromBase64String('$X')); & 'C:\Program Files\nodejs\node.exe' C:\gl\cdp.mjs C:\gl\expr.js"
