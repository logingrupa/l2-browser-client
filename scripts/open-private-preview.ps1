<# Open the private invite in this user's browser without printing its value. #>
[CmdletBinding()]
param([string]$InviteFile = (Join-Path $env:LOCALAPPDATA 'L2BrowserPreview/private-invite.txt'))
$ErrorActionPreference = 'Stop'
try { $invite = [IO.File]::ReadAllText($InviteFile).Trim(); $uri = [Uri]$invite }
catch { throw 'Private preview invitation is unavailable or invalid.' }
if ($uri.Scheme -cne 'https' -or $uri.Host -cne 'l2.kingdom.lv' -or $uri.AbsolutePath -cne '/enter' -or
    $uri.Query -cnotmatch '^\?key=[a-f0-9]{64}$' -or $uri.UserInfo -or $uri.Fragment) {
    throw 'Private preview invitation identity is invalid.'
}
# This is the interactive browser the user requested, not a background helper.
Start-Process -FilePath $uri.AbsoluteUri
