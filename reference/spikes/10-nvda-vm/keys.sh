#!/bin/bash
# keys.sh 'chord,chord' [wait] : real key presses into Chrome in the VM, prints what NVDA said after each
D=$(dirname "$0"); "$D/vmps.sh" "& ([scriptblock]::Create((Get-Content -Raw C:\gl\keys.ps1))) '$1' ${2:-3}"
