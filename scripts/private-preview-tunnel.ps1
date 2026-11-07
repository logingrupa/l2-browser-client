<# Starts/stops only this client's provisioned private-preview connector. #>
[CmdletBinding()]
param([ValidateSet('Start','Stop','Status')][string]$Action = 'Status')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$tunnelRoot = Join-Path $root '.assets/private-preview/tunnel'
$identityPath = Join-Path $tunnelRoot 'identity.json'
$statePath = Join-Path $tunnelRoot 'connector-state.json'
$configPath = Join-Path $tunnelRoot 'config.yml'
$cloudflared = 'C:/Program Files (x86)/cloudflared/cloudflared.exe'

if (-not (Test-Path -LiteralPath $identityPath)) {
    if ($Action -eq 'Status') { @{configured=$false;running=$false} | ConvertTo-Json; return }
    throw 'Dedicated tunnel is not provisioned. See docs/PRIVATE_PREVIEW.md.'
}
$identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
if ($identity.hostname -cne 'l2.kingdom.lv' -or $identity.name -cne 'l2-browser-client-preview' -or
    $identity.id -notmatch '^[0-9a-f-]{36}$') { throw 'Unexpected private-preview tunnel identity.' }
$credentialPath = Join-Path $tunnelRoot ($identity.id + '.json')
if ((Get-FileHash -LiteralPath $credentialPath -Algorithm SHA256).Hash -ine $identity.credentialSha256) {
    throw 'Dedicated tunnel credential checksum changed.'
}
$credential = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
if ($credential.TunnelID -cne $identity.id -or $credential.AccountTag -cne $identity.accountId -or -not $credential.TunnelSecret) {
    throw 'Dedicated tunnel credential identity failed; contents suppressed.'
}
$credential = $null
$owned = $null
if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $candidate = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$state.pid)
    if ($candidate) {
        if (-not $state.PSObject.Properties['createdUtc'] -or -not $state.PSObject.Properties['commandLine']) {
            throw 'Recorded connector lacks process creation evidence; refusing process control.'
        }
        if ([IO.Path]::GetFullPath($candidate.ExecutablePath) -ine [IO.Path]::GetFullPath($cloudflared) -or
            $candidate.CommandLine -cne $state.commandLine -or
            $candidate.CreationDate.ToUniversalTime().Ticks -ne ([DateTimeOffset]$state.createdUtc).UtcDateTime.Ticks) {
            throw 'Recorded PID no longer identifies this connector; refusing process control.'
        }
        $owned = $candidate
    }
}
if ($Action -eq 'Stop') {
    if ($owned) { Stop-Process -Id $owned.ProcessId -ErrorAction Stop }
    @{hostname=$identity.hostname;running=$false;stoppedOwnedConnector=[bool]$owned} | ConvertTo-Json
    return
}
if ($Action -eq 'Status') {
    @{hostname=$identity.hostname;configured=$true;running=[bool]$owned;pid=$(if($owned){$owned.ProcessId}else{$null});origin='http://127.0.0.1:8189'} | ConvertTo-Json
    return
}
& node (Join-Path $PSScriptRoot 'private-preview.mjs') start
if ($LASTEXITCODE -ne 0) { throw 'Private origin startup failed.' }
if (-not $owned) {
    $metricProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 20259)
    try { $metricProbe.Start() } finally { $metricProbe.Stop() }
    $credentialForward = $credentialPath.Replace([char]92,[char]47)
    $configuration = "tunnel: $($identity.id)`ncredentials-file: '$credentialForward'`ningress:`n  - hostname: l2.kingdom.lv`n    service: http://127.0.0.1:8189`n  - service: http_status:404`n"
    if (Test-Path -LiteralPath $configPath) {
        if ((Get-Content -LiteralPath $configPath -Raw) -cne $configuration) { throw 'Existing dedicated connector configuration differs; refusing overwrite.' }
    } else { [IO.File]::WriteAllText($configPath, $configuration, [Text.UTF8Encoding]::new($false)) }
    & $cloudflared tunnel --config $configPath ingress validate
    if ($LASTEXITCODE -ne 0) { throw 'Dedicated tunnel ingress validation failed.' }
    $quotedConfig = '{0}{1}{0}' -f [char]34,$configPath
    $connector = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel','--no-autoupdate','--config',$quotedConfig,'--metrics','127.0.0.1:20259','--loglevel','error','run',$identity.id) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $tunnelRoot 'connector.stdout.log') -RedirectStandardError (Join-Path $tunnelRoot 'connector.stderr.log')
    $createdProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $connector.Id)
    if (-not $createdProcess) { throw 'Dedicated connector exited before its identity could be recorded.' }
    @{pid=$connector.Id;startedUtc=[DateTimeOffset]::UtcNow.ToString('o');createdUtc=$createdProcess.CreationDate.ToUniversalTime().ToString('o');commandLine=$createdProcess.CommandLine;id=$identity.id;hostname=$identity.hostname;config=$configPath} |
        ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8NoBOM
    $connectorId = $connector.Id
} else { $connectorId = $owned.ProcessId }
$ready = $false
for ($attempt = 0; $attempt -lt 15; $attempt++) {
    try { $response = Invoke-WebRequest -Uri 'http://127.0.0.1:20259/ready' -TimeoutSec 2 -NoProxy -SkipHttpErrorCheck; if ($response.StatusCode -eq 200) { $ready=$true;break } } catch { }
    if (-not (Get-Process -Id $connectorId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Seconds 1
}
@{hostname=$identity.hostname;pid=$connectorId;connected=$ready;url='https://l2.kingdom.lv/?world=interlude&authored=1'} | ConvertTo-Json
if (-not $ready) { throw 'Connector is not ready; private diagnostics remain under .assets/private-preview/tunnel.' }
