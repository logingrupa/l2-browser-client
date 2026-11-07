param([Parameter(Mandatory = $true)][string]$Request)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $Request -Raw | ConvertFrom-Json
[Reflection.Assembly]::LoadFrom($config.library) | Out-Null
[UELib.UnrealConfig]::VariableTypes = [Collections.Generic.Dictionary[string,Tuple[string,UELib.Types.PropertyType]]]::new()
foreach ($name in @('Emitters')) {
    [UELib.UnrealConfig]::VariableTypes[$name] = [Tuple[string,UELib.Types.PropertyType]]::new('Emitter', [UELib.Types.PropertyType]::ObjectProperty)
}
foreach ($name in @('ColorScale','SizeScale','RevolutionScale','VelocityScale','BeamEndPoints','CastingActions','ShotActions')) {
    [UELib.UnrealConfig]::VariableTypes[$name] = [Tuple[string,UELib.Types.PropertyType]]::new('ParticleEmitter', [UELib.Types.PropertyType]::StructProperty)
}
$results = @()
foreach ($item in $config.packages) {
    $package = [UELib.UnrealLoader]::LoadFullPackage($item.path, [IO.FileAccess]::Read)
    try {
        foreach ($name in $item.classes) {
            $matches = @($package.Objects | Where-Object { $_.Name.ToString() -ceq $name -and $_.ExportTable -and $_ -is [UELib.Core.UClass] })
            if ($matches.Count -ne 1) { throw "Class did not resolve uniquely: $name" }
            $text = $matches[0].Decompile()
            $file = Join-Path $config.output ($item.label + '.' + $name + '.uc')
            [IO.File]::WriteAllText($file, $text, [Text.UTF8Encoding]::new($false))
            $results += [pscustomobject]@{ package = $item.label; name = $name; file = $file; bytes = (Get-Item -LiteralPath $file).Length }
        }
    } finally { $package.Dispose() }
}
$results | ConvertTo-Json -Depth 5
