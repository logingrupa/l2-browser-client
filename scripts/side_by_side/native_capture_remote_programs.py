from __future__ import annotations

import base64
import json
import re

POWERSHELL_INPUT_PLACEHOLDER = '__NATIVE_CAPTURE_INPUT_BASE64__'
BASE64_TEXT_PATTERN = re.compile(r'^[A-Za-z0-9+/]+={0,2}$')
PREFLIGHT_PROGRAM_NAME = 'preflight'
PREPARE_FOLDER_PROGRAM_NAME = 'prepare-capture-folder'
CAPTURE_PROGRAM_NAME = 'capture'
TASK_REMOVAL_PROGRAM_NAME = 'task-removal'
BATCH_INPUT_FILE_NAME = 'batch-input.json'
BATCH_SCRIPT_FILE_NAME = 'batch-script.ps1'
COMPLETION_MARKER_FILE_NAME = 'batch-complete.json'

PROGRAM_HEADER = f"""$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$NativeCaptureInput=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{POWERSHELL_INPUT_PLACEHOLDER}'))|ConvertFrom-Json
"""

READ_SHA256_FUNCTION = """function Read-Sha256($path){
 $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);$hash=[Security.Cryptography.SHA256]::Create()
 try{return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
 finally{$hash.Dispose();$stream.Dispose()}
}
"""

PREFLIGHT_PROGRAM = READ_SHA256_FUNCTION + """$processes=@(Get-CimInstance Win32_Process)
$clientProcesses=@($processes|Where-Object{@($NativeCaptureInput.clientProcessNames) -contains $_.Name}|ForEach-Object{[ordered]@{processId=[int]$_.ProcessId;name=$_.Name;path=$_.ExecutablePath}})
$botText=[string]$NativeCaptureInput.botProcessText
$botProcesses=@($processes|Where-Object{($_.ExecutablePath -and $_.ExecutablePath.IndexOf($botText,[StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($_.CommandLine -and $_.CommandLine.IndexOf($botText,[StringComparison]::OrdinalIgnoreCase) -ge 0)}|ForEach-Object{[ordered]@{processId=[int]$_.ProcessId;name=$_.Name;path=$_.ExecutablePath}})
$sessionPattern='\\s'+[int]$NativeCaptureInput.sessionId+'\\s+([A-Za-z]+)'
$sessionState=$null
foreach($line in @(query session 2>$null)){if($line -match $sessionPattern){$sessionState=$Matches[1];break}}
[ordered]@{program=$NativeCaptureInput.program;host=$env:COMPUTERNAME;controllerSha256=(Read-Sha256 $NativeCaptureInput.controllerPath);controlDocumentSha256=(Read-Sha256 $NativeCaptureInput.controlDocumentPath);engineDllSha256=(Read-Sha256 $NativeCaptureInput.engineLibraryPath);l2IniSha256=(Read-Sha256 $NativeCaptureInput.l2IniPath);clientProcesses=$clientProcesses;botProcesses=$botProcesses;sessionId=[int]$NativeCaptureInput.sessionId;sessionState=$sessionState}|ConvertTo-Json -Depth 5 -Compress
"""

PREPARE_FOLDER_PROGRAM = """$captureRoot=[IO.Path]::GetFullPath($NativeCaptureInput.captureRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$captureFolder=[IO.Path]::GetFullPath($NativeCaptureInput.captureFolder)
if(-not $captureFolder.StartsWith($captureRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'capture folder escapes the capture root'}
$null=New-Item -ItemType Directory -Path $captureFolder -Force
if(Test-Path -LiteralPath $NativeCaptureInput.completionMarkerPath){Remove-Item -LiteralPath $NativeCaptureInput.completionMarkerPath -Force}
[ordered]@{program=$NativeCaptureInput.program;captureFolder=$NativeCaptureInput.captureFolder}|ConvertTo-Json -Compress
"""

CAPTURE_PROGRAM = READ_SHA256_FUNCTION + """$taskName=[string]$NativeCaptureInput.taskName
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$NativeCaptureInput.batchScriptPath+'"')
$principal=New-ScheduledTaskPrincipal -UserId $NativeCaptureInput.userName -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds ([int]$NativeCaptureInput.timeLimitSeconds))
$registered=$false;$completed=$false;$taskGone=$false
try{
 $null=Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings
 $registered=$true
 Start-ScheduledTask -TaskName $taskName
 $deadline=[DateTime]::UtcNow.AddSeconds([int]$NativeCaptureInput.timeLimitSeconds)
 while(-not (Test-Path -LiteralPath $NativeCaptureInput.completionMarkerPath) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 500}
 $completed=Test-Path -LiteralPath $NativeCaptureInput.completionMarkerPath
}finally{
 Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
 $taskGone=$null -eq (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)
}
$completion=if($completed){[IO.File]::ReadAllText($NativeCaptureInput.completionMarkerPath,[Text.Encoding]::UTF8)|ConvertFrom-Json}else{$null}
$batchInput=[IO.File]::ReadAllText($NativeCaptureInput.batchInputPath,[Text.Encoding]::UTF8)|ConvertFrom-Json
$receipts=@(foreach($entry in @($batchInput.keys)){if(Test-Path -LiteralPath $entry.receiptPath){[IO.File]::ReadAllText($entry.receiptPath,[Text.Encoding]::UTF8)|ConvertFrom-Json}})
[ordered]@{program=$NativeCaptureInput.program;taskName=$taskName;registered=$registered;completed=$completed;taskGone=$taskGone;completion=$completion;l2IniSha256After=(Read-Sha256 $NativeCaptureInput.l2IniPath);receipts=$receipts}|ConvertTo-Json -Depth 6 -Compress
"""

TASK_REMOVAL_PROGRAM = """$taskName=[string]$NativeCaptureInput.taskName
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
[ordered]@{program=$NativeCaptureInput.program;taskName=$taskName;taskGone=($null -eq (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue))}|ConvertTo-Json -Compress
"""

BATCH_SCRIPT = f"""$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$batchInput=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '{BATCH_INPUT_FILE_NAME}'),[Text.Encoding]::UTF8)|ConvertFrom-Json
{READ_SHA256_FUNCTION}function Invoke-Controller([hashtable]$parameters){{
 $text=(& $batchInput.controllerPath @parameters|Out-String)
 $result=$text|ConvertFrom-Json
 if(-not $result.ok){{throw ('controller action '+$parameters.Action+' failed: '+$text)}}
 return $result
}}
function Read-RigaTime{{
 return [TimeZoneInfo]::ConvertTime([DateTimeOffset]::Now,[TimeZoneInfo]::FindSystemTimeZoneById($batchInput.rigaTimeZoneId)).ToString("yyyy-MM-dd'T'HH:mm:sszzz")
}}
$status='failed';$errorText=$null;$receiptCount=0
try{{
 foreach($entry in @($batchInput.keys)){{
  $l2IniBefore=Read-Sha256 $batchInput.l2IniPath
  $state=Invoke-Controller @{{Action='State'}}
  $actionStatuses=@()
  if($entry.command){{$actionStatuses+=[string](Invoke-Controller @{{Action='Command';Command=[string]$entry.command}}).status}}
  if($entry.skillId){{$actionStatuses+=[string](Invoke-Controller @{{Action='PlaySkill';SkillId=[int]$entry.skillId}}).status}}
  if($entry.searchText){{$actionStatuses+=[string](Invoke-Controller @{{Action='Keys';Keys=[string]$entry.searchText}}).status}}
  $screenshot=Invoke-Controller @{{Action='Screenshot';ScreenshotPath=[string]$entry.pngPath}}
  $receipt=[ordered]@{{key=$entry.key;part=$entry.part;viewer=$entry.viewer;batchId=$batchInput.batchId;capturedBy=$batchInput.capturedBy;controllerSha256=(Read-Sha256 $batchInput.controllerPath);controlDocumentSha256=(Read-Sha256 $batchInput.controlDocumentPath);engineDllSha256=(Read-Sha256 $batchInput.engineLibraryPath);l2IniSha256Before=$l2IniBefore;l2IniSha256After=(Read-Sha256 $batchInput.l2IniPath);windowSize=[ordered]@{{width=[int]$state.window.width;height=[int]$state.window.height}};clientSize=[ordered]@{{width=[int]$state.client.width;height=[int]$state.client.height}};actionStatuses=$actionStatuses;captureMethod=[string]$screenshot.captureMethod;pngPath=$entry.pngPath;pngSha256=(Read-Sha256 $entry.pngPath);capturedAtRiga=(Read-RigaTime)}}
  [IO.File]::WriteAllText($entry.receiptPath,($receipt|ConvertTo-Json -Depth 5 -Compress),[Text.UTF8Encoding]::new($false))
  $receiptCount++
 }}
 $status='complete'
}}catch{{$errorText=($_|Out-String)}}
finally{{[IO.File]::WriteAllText($batchInput.completionMarkerPath,([ordered]@{{batchId=$batchInput.batchId;status=$status;error=$errorText;receiptCount=$receiptCount}}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))}}
"""

PROGRAM_BODY_BY_NAME = {
    PREFLIGHT_PROGRAM_NAME: PREFLIGHT_PROGRAM,
    PREPARE_FOLDER_PROGRAM_NAME: PREPARE_FOLDER_PROGRAM,
    CAPTURE_PROGRAM_NAME: CAPTURE_PROGRAM,
    TASK_REMOVAL_PROGRAM_NAME: TASK_REMOVAL_PROGRAM,
}


class RemoteProgramError(ValueError):
    pass


def base64_json_text(input_document):
    encoded = base64.b64encode(json.dumps(input_document, sort_keys=True).encode('utf-8')).decode('ascii')
    if not BASE64_TEXT_PATTERN.fullmatch(encoded):
        raise RemoteProgramError('remote program input did not encode to plain base64 text')
    return encoded


def remote_program_text(program_name, input_document):
    if program_name not in PROGRAM_BODY_BY_NAME:
        raise RemoteProgramError(f'no remote program is named {program_name!r}')
    if input_document.get('program') != program_name:
        raise RemoteProgramError(f'remote program input must name its program {program_name}')
    return PROGRAM_HEADER.replace(POWERSHELL_INPUT_PLACEHOLDER, base64_json_text(input_document)) + PROGRAM_BODY_BY_NAME[program_name]


def encoded_powershell_command(program_name, input_document):
    return base64.b64encode(remote_program_text(program_name, input_document).encode('utf-16le')).decode('ascii')
