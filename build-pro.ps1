# AutoFlow Pro — Build & Package Script
# Run this from the project root to build the extension and create the download ZIP.

Write-Host "⚡ AutoFlow Pro — Build & Package" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build the extension
Write-Host "📦 Building extension..." -ForegroundColor Yellow
Push-Location "extension"
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "✅ Extension built successfully" -ForegroundColor Green

# Step 2: Create ZIP for website download
$zipPath = "website\public\autoflow-pro.zip"
Write-Host "📦 Creating $zipPath..." -ForegroundColor Yellow

# Remove old ZIP if exists
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Compress-Archive -Path "extension\dist\*" -DestinationPath $zipPath -Force

$zipSize = [math]::Round((Get-Item $zipPath).Length / 1024)
Write-Host "✅ ZIP created: $zipPath ($zipSize KB)" -ForegroundColor Green
Write-Host ""
Write-Host "🚀 Ready to deploy! The ZIP is in website/public/" -ForegroundColor Cyan
Write-Host "   Users download it from: https://auto-flow.studio/autoflow-pro.zip" -ForegroundColor Gray
