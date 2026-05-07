@echo off
echo Building AutoFlow extension...
call npm run build

echo.
echo Removing source maps...
if exist "dist\*.map" del "dist\*.map"

echo.
echo Creating ZIP file...
if exist "autoflow-chrome-store.zip" del "autoflow-chrome-store.zip"
powershell.exe -nologo -noprofile -command "Compress-Archive -Path 'dist\*' -DestinationPath 'autoflow-chrome-store.zip' -Force"

echo.
echo ==============================================
echo ZIP file created: autoflow-chrome-store.zip
echo ==============================================
pause
