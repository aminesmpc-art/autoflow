param([Parameter(Mandatory=$true)][string]$SourceDirectory, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$packageSource = [IO.Path]::GetFullPath($SourceDirectory)
$packageTarget = [IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath (Join-Path $packageSource 'manifest.json') -PathType Leaf)) { throw 'Missing built manifest.' }
if (Test-Path -LiteralPath $packageTarget) { throw 'Package exists; choose a new version instead of overwriting it.' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$files = @(Get-ChildItem -LiteralPath $packageSource -Recurse -File)
$zip = [IO.Compression.ZipFile]::Open($packageTarget, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $name = $file.FullName.Substring($packageSource.Length + 1).Replace('\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $name, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $zip.Dispose() }
$zip = [IO.Compression.ZipFile]::OpenRead($packageTarget)
$hasher = [Security.Cryptography.SHA256]::Create()
try {
  if (-not ($zip.Entries.FullName -contains 'manifest.json')) { throw 'Manifest is not at ZIP root.' }
  if ($zip.Entries.Count -ne $files.Count) { throw 'ZIP file count does not match dist.' }
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName.Contains('\')) { throw 'Invalid ZIP path separator.' }
    $packed = $entry.Open()
    $built = [IO.File]::OpenRead((Join-Path $packageSource $entry.FullName))
    try {
      if ([BitConverter]::ToString($hasher.ComputeHash($packed)) -ne [BitConverter]::ToString($hasher.ComputeHash($built))) { throw "ZIP mismatch: $($entry.FullName)" }
    } finally { $packed.Dispose(); $built.Dispose() }
  }
} finally { $zip.Dispose(); $hasher.Dispose() }
Write-Output "Verified $($files.Count) ZIP entries against dist."
