param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
# A local test dependency only. Never installs globally or ships in Loadstone.
$taskTarget = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $taskTarget) { throw 'Choose a new test dependency directory.' }
$taskBootstrap = (Get-Command 7z.exe -ErrorAction SilentlyContinue).Source
if (-not $taskBootstrap) { $taskBootstrap = Join-Path $env:ProgramFiles '7-Zip\7z.exe' }
if (-not (Test-Path -LiteralPath $taskBootstrap -PathType Leaf)) { throw 'An existing 7-Zip tool is required to unpack the verified upstream release.' }
New-Item -ItemType Directory -Path $taskTarget | Out-Null
$taskDownload = Join-Path $taskTarget '7z2604-x64.exe'
Invoke-WebRequest -Uri 'https://github.com/ip7z/7zip/releases/download/26.04/7z2604-x64.exe' -OutFile $taskDownload
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $taskDownload).Hash.ToLowerInvariant() -ne 'd54bf805f9f3704d1e8db2fa3498ae7ef2df0312b40b558e7c71c734430a665d') { throw '7-Zip upstream release digest mismatch.' }
$taskTool = Join-Path $taskTarget 'tool'
& $taskBootstrap x $taskDownload "-o$taskTool" -y '7z.exe' '7z.dll' 'License.txt' 'readme.txt' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not unpack verified 7-Zip release.' }
Write-Output (Join-Path $taskTool '7z.exe')
