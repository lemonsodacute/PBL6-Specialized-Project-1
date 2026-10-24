param([string[]]$Names = @('front','dev','turbo','api','acceptance','regression-front'))
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$processes = @(Get-CimInstance Win32_Process)
foreach ($name in $Names) {
    $file = Join-Path $workspace "backend\private\release-qa\performance-$name.pid"
    if (!(Test-Path -LiteralPath $file)) { continue }
    $auditPid = [int]([IO.File]::ReadAllText($file).Trim())
    $rootProcess = $processes | Where-Object ProcessId -eq $auditPid | Select-Object -First 1
    if (!$rootProcess) { continue }
    $pattern = if ($name -eq 'api') { 'release_qa_runtime.py.*(uvicorn.*8001|scripts.performance_backend)' }
        elseif ($name -eq 'acceptance') { 'release_qa_runtime.py.*uvicorn.*8000' }
        elseif ($name -eq 'regression-front') { 'next.*start.*3000' }
        else { 'next.*(dev|start).*(3100|3101)' }
    if ($rootProcess.CommandLine -notmatch $pattern -or [Math]::Abs(($rootProcess.CreationDate - (Get-Item -LiteralPath $file).LastWriteTime).TotalSeconds) -gt 5) {
        Write-Output "Preserved ${name}: PID no longer matches this audit."
        continue
    }
    $owned = @{}; $owned[$auditPid] = $rootProcess.CreationDate
    do {
        $added = $false
        foreach ($process in $processes) {
            $parent = [int]$process.ParentProcessId; $child = [int]$process.ProcessId
            if ($owned.ContainsKey($parent) -and !$owned.ContainsKey($child) -and $process.CreationDate -ge $owned[$parent]) {
                $owned[$child] = $process.CreationDate; $added = $true
            }
        }
    } while ($added)
    foreach ($child in @($owned.Keys) | Where-Object { $_ -ne $auditPid }) { Stop-Process -Id $child -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $auditPid -Force -ErrorAction SilentlyContinue
    Write-Output "Stopped owned performance $name service."
}
