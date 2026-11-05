param(
    [switch]$ConfigureOnly,
    [switch]$Background,
    [string]$WebhookUrl = 'http://127.0.0.1:8000/api/v1/live-classes/provider-webhook'
)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$privateDir = Join-Path $workspace 'backend\private\livekit'
New-Item -ItemType Directory -Force -Path $privateDir | Out-Null
$version = '1.13.9'
$archiveName = "livekit_${version}_windows_amd64.zip"
$executable = Join-Path $privateDir 'livekit-server.exe'
if ($Background -and !$ConfigureOnly) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort 7880 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $owner = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
        if ($owner.Path -ne $executable) { throw 'Port 7880 belongs to another process. Check the configured SFU port.' }
        Write-Host 'Local classroom SFU is already running on port 7880.'
        return
    }
}
if (!(Test-Path -LiteralPath $executable)) {
    $archive = Join-Path $privateDir $archiveName
    Invoke-WebRequest -Uri "https://github.com/livekit/livekit/releases/download/v${version}/${archiveName}" -OutFile $archive
    $checksumFile = Join-Path $privateDir 'checksums.txt'
    Invoke-WebRequest -Uri "https://github.com/livekit/livekit/releases/download/v${version}/checksums.txt" -OutFile $checksumFile
    $checksum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    $expected = Get-Content -LiteralPath $checksumFile | Where-Object { $_ -match ([regex]::Escape($archiveName) + '$') }
    if (!$expected -or !$expected.StartsWith($checksum)) { throw 'LiveKit archive checksum mismatch.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $privateDir -Force
}
$envPath = Join-Path $workspace 'backend\.env'
$content = if (Test-Path -LiteralPath $envPath) { [IO.File]::ReadAllText($envPath) } else { '' }
$values = @{}
foreach ($name in @('LIVEKIT_URL','LIVEKIT_API_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_REDIS_ADDRESS','LIVEKIT_NODE_IP')) {
    $match = [regex]::Match($content, "(?m)^${name}=(.*)$")
    $values[$name] = $match.Groups[1].Value.Trim().Trim('"').Trim("'")
}
if ($values['LIVEKIT_URL'] -and $values['LIVEKIT_URL'] -notin @('ws://localhost:7880','ws://127.0.0.1:7880')) {
    throw 'An existing remote provider is configured. Use its SFU rather than replacing server credentials.'
}
function Test-ClassroomRedis([string]$Address) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $endpoint = [Uri]("tcp://" + $Address)
        if (!$client.ConnectAsync($endpoint.Host, $endpoint.Port).Wait(500)) { return $false }
        $client.ReceiveTimeout = 500
        $client.SendTimeout = 500
        $stream = $client.GetStream()
        $ping = [Text.Encoding]::ASCII.GetBytes("PING`r`n")
        $stream.Write($ping, 0, $ping.Length)
        $reader = [IO.StreamReader]::new($stream)
        return $reader.ReadLine() -eq '+PONG'
    } catch { return $false }
    finally { $client.Dispose() }
}
if (!$ConfigureOnly -and $values['LIVEKIT_REDIS_ADDRESS']) {
    $redisAddress = $values['LIVEKIT_REDIS_ADDRESS']
    if (!(Test-ClassroomRedis $redisAddress)) {
        if ($redisAddress -notin @('127.0.0.1:6382','localhost:6382')) {
            throw 'The configured LIVEKIT_REDIS_ADDRESS is unavailable. Start that Redis service before starting LiveKit.'
        }
        $redisHelp = 'Start Docker Desktop, then run: docker compose -f infra/livekit/recording.compose.yaml up -d redis'
        if (!(Get-Command docker -ErrorAction SilentlyContinue)) { throw "Local recording Redis is unavailable. $redisHelp" }
        Write-Host 'Local recording Redis is unavailable; starting its Docker Compose service.'
        & docker compose -f (Join-Path $workspace 'infra\livekit\recording.compose.yaml') up -d redis
        if ($LASTEXITCODE -ne 0) { throw "Could not start local recording Redis. $redisHelp" }
        $redisReady = $false
        for ($redisAttempt = 0; $redisAttempt -lt 40; $redisAttempt++) {
            if (Test-ClassroomRedis $redisAddress) { $redisReady = $true; break }
            Start-Sleep -Milliseconds 250
        }
        if (!$redisReady) { throw "Local recording Redis did not become ready on port 6382. $redisHelp" }
    }
}
if (!$values['LIVEKIT_API_KEY']) { $values['LIVEKIT_API_KEY'] = 'classroom-' + [guid]::NewGuid().ToString('N') }
if (!$values['LIVEKIT_API_SECRET']) {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes); $rng.Dispose()
    $values['LIVEKIT_API_SECRET'] = [Convert]::ToBase64String($bytes)
}
$values['LIVEKIT_URL'] = 'ws://localhost:7880'
$values['LIVEKIT_API_URL'] = 'http://127.0.0.1:7880'
foreach ($name in @('LIVEKIT_URL','LIVEKIT_API_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET')) {
    $line = $name + '=' + $values[$name]
    if ([regex]::IsMatch($content, "(?m)^${name}=.*$")) { $content = [regex]::Replace($content, "(?m)^${name}=.*$", [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $line }) }
    else { $content = $content.TrimEnd() + "`r`n" + $line + "`r`n" }
}
[IO.File]::WriteAllText($envPath, $content, [Text.UTF8Encoding]::new($false))
$nodeAddress = if ($values['LIVEKIT_NODE_IP']) { $values['LIVEKIT_NODE_IP'] } else { '127.0.0.1' }
$bindAddress = if ($nodeAddress -eq '127.0.0.1') { '127.0.0.1' } else { '0.0.0.0' }
# The Docker recording worker needs the Windows/WSL interface candidate as well
# as the LAN mapping. Replacing internal candidates can prevent its ICE join.
$advertiseInternal = if ($values['LIVEKIT_REDIS_ADDRESS']) { 'true' } else { 'false' }
$configuration = @"
port: 7880
bind_addresses: [$bindAddress]
rtc:
  node_ip: $nodeAddress
  use_external_ip: false
  advertise_internal_ip: $advertiseInternal
  enable_loopback_candidate: true
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
room:
  auto_create: false
  enable_remote_unmute: false
keys:
  '$($values['LIVEKIT_API_KEY'])': '$($values['LIVEKIT_API_SECRET'])'
webhook:
  api_key: '$($values['LIVEKIT_API_KEY'])'
  urls:
    - '$WebhookUrl'
logging:
  level: warn
"@
if ($values['LIVEKIT_REDIS_ADDRESS']) { $configuration += "`nredis:`n  address: '$($values['LIVEKIT_REDIS_ADDRESS'])'`n" }
$configPath = Join-Path $privateDir 'livekit.yaml'
[IO.File]::WriteAllText($configPath, $configuration, [Text.UTF8Encoding]::new($false))
Write-Host 'Local classroom SFU configured. Restart FastAPI if its environment values changed.'
if ($Background -and !$ConfigureOnly) {
    $sfuProcess = Start-Process -FilePath $executable -ArgumentList @('--config', ('"' + $configPath + '"')) -WorkingDirectory $privateDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $privateDir 'stdout.log') -RedirectStandardError (Join-Path $privateDir 'stderr.log')
    for ($attemptIndex = 0; $attemptIndex -lt 40; $attemptIndex++) {
        if ($sfuProcess.HasExited) { throw 'LiveKit did not start. Inspect backend/private/livekit/stderr.log locally.' }
        try {
            $health = Invoke-WebRequest -Uri 'http://127.0.0.1:7880/' -UseBasicParsing -TimeoutSec 1
            if ($health.StatusCode -eq 200) { Write-Host 'Local classroom SFU is ready on port 7880.'; return }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
    throw 'LiveKit did not become ready. Inspect backend/private/livekit/stderr.log locally.'
}
if (!$ConfigureOnly) { & $executable --config $configPath }
