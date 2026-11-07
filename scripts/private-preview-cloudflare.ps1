<#
Creates only this client's dedicated private-preview tunnel and DNS route.
Run on IMPORTA-PC through the enrolled fleet SSH alias. The static origin and
its access gate must pass local verification before -Apply. Existing routes,
origin certificates, native client files and services are never modified.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RunDir,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:COMPUTERNAME -cne 'IMPORTA-PC') { throw 'Run on IMPORTA-PC through fleet.' }
$RunDir = (Resolve-Path -LiteralPath $RunDir).Path
$Hostname = 'l2.kingdom.lv'
$TunnelName = 'l2-browser-client-preview'
$Cloudflared = 'C:/Program Files (x86)/cloudflared/cloudflared.exe'
$CertPath = Join-Path $env:USERPROFILE '.cloudflared/cert.pem'
foreach ($requiredPath in @($Cloudflared, $CertPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw 'Required Cloudflare tool or login certificate is unavailable.' }
}
$apiToken = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN', 'User')
if (-not $apiToken) { $apiToken = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN', 'Process') }
if (-not $apiToken) { throw 'Cloudflare read credential unavailable.' }
$Headers = @{ Authorization = 'Bearer ' + $apiToken }

function Get-CloudflareResult([string]$Path) {
    try { $response = Invoke-RestMethod -Uri ('https://api.cloudflare.com/client/v4/' + $Path) -Headers $Headers -TimeoutSec 30 }
    catch { throw 'Cloudflare read request failed; response suppressed.' }
    if (-not $response.success) { throw 'Cloudflare read request unsuccessful.' }
    return $response.result
}
function Get-Tunnels {
    $raw = & $Cloudflared tunnel --origincert $CertPath list --output json 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare tunnel listing failed.' }
    return $raw | ConvertFrom-Json
}
function Get-DnsRecords([string]$Name) {
    Get-CloudflareResult ('zones/' + $script:ZoneId + '/dns_records?name=' + $Name) |
        Select-Object id, type, name, content, proxied, ttl
}
function Test-DnsMatch($Records, [string]$Id) {
    return @($Records).Count -eq 1 -and $Records[0].name -ceq $Hostname -and
        $Records[0].type -ceq 'CNAME' -and $Records[0].content -ceq ($Id + '.cfargotunnel.com') -and $Records[0].proxied -eq $true
}
function Get-ProtectedDns {
    @('lineagen.kingdom.lv', 'island-lineagen.kingdom.lv', 't3-db.kingdom.lv') |
        ForEach-Object { Get-DnsRecords $_ } | Sort-Object name
}
function Get-TunnelIdentities($Items) {
    $Items | Where-Object name -CNE $TunnelName | Select-Object id, name, created_at, deleted_at | Sort-Object id
}

$zones = @(Get-CloudflareResult 'zones?name=kingdom.lv')
if ($zones.Count -ne 1 -or $zones[0].name -cne 'kingdom.lv') { throw 'Exact kingdom.lv zone not found.' }
$script:ZoneId = $zones[0].id
$certificateHash = (Get-FileHash -LiteralPath $CertPath -Algorithm SHA256).Hash
$beforeTunnels = @(Get-Tunnels)
$beforeProtected = @(Get-ProtectedDns)
if ($beforeProtected.Count -ne 3) { throw 'Expected existing protected routes are ambiguous.' }
$matching = @($beforeTunnels | Where-Object name -CEQ $TunnelName)
$existingDns = @(Get-DnsRecords $Hostname)
if ($matching.Count -gt 1) { throw 'Multiple exact tunnel matches; refusing changes.' }
if ($existingDns.Count -gt 0 -and ($matching.Count -ne 1 -or -not (Test-DnsMatch $existingDns $matching[0].id))) {
    throw 'Hostname already exists without an exact dedicated tunnel match; refusing changes.'
}
if (-not $Apply) {
    $plan = [ordered]@{
        host = $env:COMPUTERNAME; hostname = $Hostname; tunnel = $TunnelName
        tunnelExists = $matching.Count -eq 1; dnsExists = $existingDns.Count -gt 0
        intendedOrigin = 'DATABASE-PC http://127.0.0.1:8189'
        prerequisite = 'Local private static origin gate must pass before apply.'
        apply = $false
    }
    $plan | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $RunDir 'cloudflare-plan.json') -Encoding utf8NoBOM
    $plan | ConvertTo-Json
    return
}

$created = $matching.Count -eq 0
if ($created) {
    & $Cloudflared tunnel --origincert $CertPath create $TunnelName *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Tunnel creation failed; output suppressed.' }
}
$matching = @(Get-Tunnels | Where-Object name -CEQ $TunnelName)
if ($matching.Count -ne 1) { throw 'Dedicated tunnel identity was not established.' }
$id = $matching[0].id
if ($id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'Invalid tunnel UUID.' }
$credentialPath = Join-Path $env:USERPROFILE ('.cloudflared/' + $id + '.json')
if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) { throw 'Dedicated tunnel credentials unavailable; existing credentials were not changed.' }
$credential = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
if ($credential.TunnelID -cne $id -or $credential.AccountTag -cne $zones[0].account.id -or -not $credential.TunnelSecret) {
    throw 'Dedicated credential identity verification failed; contents suppressed.'
}
$credential = $null
$currentDns = @(Get-DnsRecords $Hostname)
if ($currentDns.Count -eq 0) {
    & $Cloudflared tunnel --origincert $CertPath route dns $id $Hostname *> $null
    if ($LASTEXITCODE -ne 0) { throw 'DNS creation failed; no existing DNS was overwritten.' }
} elseif (-not (Test-DnsMatch $currentDns $id)) { throw 'Hostname changed during operation; refusing changes.' }
$dns = @(Get-DnsRecords $Hostname)
if (-not (Test-DnsMatch $dns $id)) { throw 'Dedicated proxied CNAME verification failed.' }
$afterTunnels = @(Get-Tunnels)
$afterProtected = @(Get-ProtectedDns)
if (($beforeProtected | ConvertTo-Json -Depth 6 -Compress) -cne ($afterProtected | ConvertTo-Json -Depth 6 -Compress)) {
    throw 'Protected DNS changed during the operation.'
}
if ((Get-TunnelIdentities $beforeTunnels | ConvertTo-Json -Depth 6 -Compress) -cne
    (Get-TunnelIdentities $afterTunnels | ConvertTo-Json -Depth 6 -Compress)) { throw 'Another tunnel identity changed during the operation.' }
if ((Get-FileHash -LiteralPath $CertPath -Algorithm SHA256).Hash -cne $certificateHash) { throw 'Login certificate changed during the operation.' }
$receipt = [ordered]@{
    utc = [DateTimeOffset]::UtcNow.ToString('o'); host = $env:COMPUTERNAME
    hostname = $Hostname; tunnel = $TunnelName; id = $id; created = $created
    zoneId = $script:ZoneId; accountId = $zones[0].account.id
    dns = $dns[0]; credentialPath = $credentialPath
    credentialSha256 = (Get-FileHash -LiteralPath $credentialPath -Algorithm SHA256).Hash
    credentialIdentityVerified = $true; protectedDnsUnchanged = $true
    otherTunnelIdentitiesUnchanged = $true; certificateUnchanged = $true
    origin = 'DATABASE-PC http://127.0.0.1:8189'; connectorStarted = $false
}
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $RunDir 'cloudflare-receipt.json') -Encoding utf8NoBOM
$receipt | ConvertTo-Json -Depth 6
