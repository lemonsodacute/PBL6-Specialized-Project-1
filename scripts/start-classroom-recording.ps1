# Explicit local recording setup; never invoked by npm dev or classroom creation.
$ErrorActionPreference = 'Stop'
$taskWorkspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$taskBackend = Join-Path $taskWorkspace 'backend'
$taskPython = Join-Path $taskBackend '.venv\Scripts\python.exe'
$taskRuntime = Join-Path $taskBackend 'scripts\classroom_recording_runtime.py'
& $taskPython $taskRuntime --check-idle
if ($LASTEXITCODE -ne 0) { throw 'Local recording setup stopped because the SFU is not idle.' }
$taskRoute = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
$taskAddress = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $taskRoute.InterfaceIndex | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1
if (!$taskAddress) { throw 'No local IPv4 route is available to the Egress worker.' }
& $taskPython $taskRuntime --node-ip $taskAddress.IPAddress
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare private recording configuration.' }
$taskCompose = Join-Path $taskWorkspace 'infra\livekit\recording.compose.yaml'
docker compose -f $taskCompose up -d redis
if ($LASTEXITCODE -ne 0) { throw 'Could not start recording Redis.' }
$taskListener = Get-NetTCPConnection -State Listen -LocalPort 7880 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($taskListener) {
    $taskServer = Join-Path $taskBackend 'private\livekit\livekit-server.exe'
    $taskOwner = Get-Process -Id $taskListener.OwningProcess -ErrorAction Stop
    if ($taskOwner.Path -ne $taskServer) { throw 'Port 7880 belongs to a different service; it was not stopped.' }
    Stop-Process -Id $taskOwner.Id
    $taskOwner.WaitForExit(10000)
}
& (Join-Path $PSScriptRoot 'start-classroom-sfu.ps1') -Background
if ($LASTEXITCODE -ne 0) { throw 'Could not restart the local classroom SFU.' }
docker compose -f $taskCompose up -d egress
if ($LASTEXITCODE -ne 0) { throw 'Could not start the server-side Egress worker.' }
Write-Host 'Local recording workers started. Reload/restart FastAPI to read its updated configuration.'
