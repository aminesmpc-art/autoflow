param([switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$motionRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$distRoot = [IO.Path]::GetFullPath((Join-Path $motionRoot 'dist'))
$manifestPath = Join-Path $distRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.name -match 'TEST BUILD') { throw 'dist holds a TEST build: the Motion subscription check is off. Run npm run build first.' }
$sourceManifest = Get-Content -LiteralPath (Join-Path $motionRoot 'manifest.json') -Raw | ConvertFrom-Json
if (($manifest | ConvertTo-Json -Depth 20) -ne ($sourceManifest | ConvertTo-Json -Depth 20)) { throw 'Build is stale. Run npm run build first.' }
if ($manifest.manifest_version -ne 3 -or $manifest.name -notmatch 'Motion') { throw 'Not a Motion MV3 build.' }
if ($manifest.content_security_policy.extension_pages -match 'localhost|127\.0\.0\.1|https://\*;|unsafe-eval') { throw 'Development or unsafe CSP in release.' }
if ($manifest.host_permissions -contains '<all_urls>') { throw 'Broad host permission in release.' }
$required = @('manifest.json', 'sidepanel.html', 'privacy.html', 'motion.js', 'motion.css', 'background.js', 'flow-content.js', 'chatgpt-content.js', 'gemini-content.js', 'claude-content.js', 'sw-bypass.js', 'icons/icon128.png')
foreach ($relative in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $distRoot $relative) -PathType Leaf)) { throw "Missing $relative" }
}
if ((Get-Content -LiteralPath (Join-Path $distRoot 'motion.js') -Raw).Contains('Subscription check off')) { throw 'dist/motion.js is a TEST build: the Motion subscription check is off. Run npm run build first.' }
$files = @(Get-ChildItem -LiteralPath $distRoot -Recurse -File)
foreach ($file in $files) {
  $relative = $file.FullName.Substring($distRoot.Length + 1).Replace('\', '/')
  if ($relative -notmatch '^(manifest\.json|[a-zA-Z0-9_.-]+\.(js|css|html)|[a-zA-Z0-9_.-]+\.js\.LICENSE\.txt|icons/icon(16|32|48|128|512)\.png)$') { throw "Unexpected packaged file: $relative" }
}
$releaseRoot = Join-Path $motionRoot 'release'
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$zipPath = Join-Path $releaseRoot "autoflow-motion-$($manifest.version)-candidate.zip"
if ((Test-Path -LiteralPath $zipPath) -and -not $VerifyOnly) { throw "Candidate exists: $zipPath. Use -VerifyOnly to validate it, or choose a new version before packaging." }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Entries are written one by one: ZipFile.CreateFromDirectory under Windows
# PowerShell 5.1 names them "icons\icon128.png", and a backslash is not a path
# separator in the ZIP format, so outside Windows the icons are not in icons/.
if (-not $VerifyOnly) {
  $zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in $files) {
      $name = $file.FullName.Substring($distRoot.Length + 1).Replace('\', '/')
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $name, [IO.Compression.CompressionLevel]::Optimal)
    }
  } finally { $zip.Dispose() }
}
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
$hasher = [Security.Cryptography.SHA256]::Create()
try {
  if (-not ($archive.Entries.FullName -contains 'manifest.json')) { throw 'ZIP manifest is not at root.' }
  foreach ($entry in $archive.Entries) { if ($entry.FullName.Contains('\')) { throw "ZIP entry uses a backslash: $($entry.FullName)" } }
  if ($archive.Entries.Count -ne $files.Count) { throw 'ZIP entry count mismatch.' }
  foreach ($entry in $archive.Entries) {
    $zipStream = $entry.Open()
    $diskStream = [IO.File]::OpenRead((Join-Path $distRoot $entry.FullName))
    try {
      $z = [BitConverter]::ToString($hasher.ComputeHash($zipStream))
      $d = [BitConverter]::ToString($hasher.ComputeHash($diskStream))
      if ($z -ne $d) { throw "Stale ZIP file: $($entry.FullName)" }
    } finally { $zipStream.Dispose(); $diskStream.Dispose() }
  }
} finally { $archive.Dispose(); $hasher.Dispose() }
$hasher = [Security.Cryptography.SHA256]::Create()
$zipStream = [IO.File]::OpenRead($zipPath)
try { $hash = [BitConverter]::ToString($hasher.ComputeHash($zipStream)).Replace('-', '') }
finally { $zipStream.Dispose(); $hasher.Dispose() }
Write-Output "Candidate: $zipPath"
Write-Output "Files: $($files.Count)"
Write-Output "SHA256: $hash"
Write-Output 'Not cleared for publication: complete STORE_RELEASE.md production gates first.'
