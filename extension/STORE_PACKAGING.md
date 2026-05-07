# AutoFlow – Chrome Web Store Packaging Guide

## Step 1: Build the Production Bundle

Open PowerShell in the `extension` folder and run:

```powershell
cd "c:\Users\HP PROBOOK\Desktop\autoflow\extension"
npm run build
```

This creates/updates the `dist/` folder with the production-ready extension.

## Step 2: Create the ZIP for Upload

After building, create a clean ZIP of the `dist/` folder:

```powershell
cd "c:\Users\HP PROBOOK\Desktop\autoflow\extension"

# Remove old ZIP if exists
Remove-Item -Path "autoflow-chrome-store.zip" -Force -ErrorAction SilentlyContinue

# Remove source maps from dist (not needed in store version)
Remove-Item -Path "dist\*.map" -Force -ErrorAction SilentlyContinue

# Create the ZIP from the dist folder contents (manifest.json must be at root)
Compress-Archive -Path "dist\*" -DestinationPath "autoflow-chrome-store.zip" -Force
```

The resulting `autoflow-chrome-store.zip` is ready to upload to the Chrome Web Store.

## Step 3: Verify the ZIP

```powershell
# List contents to verify manifest.json is at root level
Expand-Archive -Path "autoflow-chrome-store.zip" -DestinationPath "verify-zip" -Force
Get-ChildItem "verify-zip" -Recurse | Select-Object FullName
Remove-Item -Path "verify-zip" -Recurse -Force
```

You should see:
```
manifest.json      (at root - IMPORTANT!)
background.js
content.js
sidepanel.html
sidepanel.js
sidepanel.css
icons/
  icon16.png
  icon48.png
  icon128.png
```
