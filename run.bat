@echo off
echo Starting Lord of the Realms development server...
echo.
echo Server will be available at: http://localhost:8081
echo Press Ctrl+C to stop the server
echo.
npx -y http-server . -p 8081 -c-1 --cors
