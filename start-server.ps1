# Fundo launcher - restarts the server detached and pings the health endpoints.
# Runs from anywhere: all paths are relative to this script's folder.
$dir = $PSScriptRoot
Set-Location $dir

Get-Process deno -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Prefer deno on PATH; fall back to the WinGet install location.
$deno = "deno"
$winget = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\deno.exe"
if (-not (Get-Command deno -ErrorAction SilentlyContinue) -and (Test-Path $winget)) { $deno = $winget }

# Launch fully detached via WMI so it outlives this shell
$cmd = "cmd /c cd /d `"$dir`" && `"$deno`" task dev > server.log 2> server.err.log"
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd } | Out-Null

Start-Sleep -Seconds 7
try {
  $h = (Invoke-WebRequest -UseBasicParsing http://localhost:3000/health -TimeoutSec 5).Content
  Write-Output "HEALTH: $h"
  $p = (Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/progress -TimeoutSec 5).Content
  Write-Output "PROGRESS: $p"
  $d = (Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/documents -TimeoutSec 5).Content
  Write-Output "DOCUMENTS: $d"
} catch {
  Write-Output "FAILED: $($_.Exception.Message)"
  Get-Content (Join-Path $dir "server.err.log") -ErrorAction SilentlyContinue | Select-Object -First 15
  Get-Content (Join-Path $dir "server.log") -ErrorAction SilentlyContinue | Select-Object -First 15
}
