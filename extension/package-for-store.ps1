# AutoFlow - Chrome Web Store Package Script
# Run this in PowerShell to create the store-ready ZIP

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AutoFlow - Store Packaging Script" -ForegroundColor Cyan  
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$extensionDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$distDir = Join-Path $extensionDir "dist"
$zipPath = Join-Path $extensionDir "autoflow-chrome-store.zip"

# Step 1: Check dist exists
if (-not (Test-Path $distDir)) {
    Write-Host "[ERROR] dist/ folder not found! Run 'npm run build' first." -ForegroundColor Red
    exit 1
}

# Step 2: Remove source maps (not needed for store)
Write-Host "[1/4] Removing source maps..." -ForegroundColor Yellow
Get-ChildItem -Path $distDir -Filter "*.map" -Recurse | Remove-Item -Force
Write-Host "  Done." -ForegroundColor Green

# Step 3: Verify essential files
Write-Host "[2/4] Verifying dist contents..." -ForegroundColor Yellow
$required = @("manifest.json", "background.js", "content.js", "sidepanel.html", "sidepanel.js", "sidepanel.css")
$missing = @()
foreach ($file in $required) {
    $path = Join-Path $distDir $file
    if (-not (Test-Path $path)) {
        $missing += $file
    }
}

if ($missing.Count -gt 0) {
    Write-Host "  [ERROR] Missing files: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "  Run 'npm run build' first!" -ForegroundColor Red
    exit 1
}

# Check icons
$iconDir = Join-Path $distDir "icons"
if (-not (Test-Path (Join-Path $iconDir "icon128.png"))) {
    Write-Host "  [WARN] icon128.png missing from icons/" -ForegroundColor Yellow
}

Write-Host "  All required files present." -ForegroundColor Green

# Step 4: Check manifest has store fields
Write-Host "[3/4] Checking manifest.json..." -ForegroundColor Yellow
$manifest = Get-Content (Join-Path $distDir "manifest.json") | ConvertFrom-Json
if (-not $manifest.minimum_chrome_version) {
    Write-Host "  [WARN] minimum_chrome_version not set in manifest" -ForegroundColor Yellow
} else {
    Write-Host "  manifest_version: $($manifest.manifest_version)" -ForegroundColor Gray
    Write-Host "  name: $($manifest.name)" -ForegroundColor Gray
    Write-Host "  version: $($manifest.version)" -ForegroundColor Gray
    Write-Host "  minimum_chrome_version: $($manifest.minimum_chrome_version)" -ForegroundColor Gray
}
Write-Host "  Manifest OK." -ForegroundColor Green

# Step 5: Create ZIP
Write-Host "[4/4] Creating ZIP..." -ForegroundColor Yellow
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}
Compress-Archive -Path "$distDir\*" -DestinationPath $zipPath -Force

$zipSize = (Get-Item $zipPath).Length / 1KB
Write-Host "  Created: autoflow-chrome-store.zip ($([math]::Round($zipSize, 1)) KB)" -ForegroundColor Green

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  PACKAGING COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Your store-ready ZIP is at:" -ForegroundColor White
Write-Host "  $zipPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Go to: https://chrome.google.com/webstore/devconsole" -ForegroundColor Gray
Write-Host "  2. Click 'New Item'" -ForegroundColor Gray
Write-Host "  3. Upload autoflow-chrome-store.zip" -ForegroundColor Gray
Write-Host "  4. Fill in listing details (see walkthrough)" -ForegroundColor Gray
Write-Host "  5. Submit for review" -ForegroundColor Gray
Write-Host ""
