#!/bin/bash

# Lord of the Realms - Run Script for Linux and macOS

echo "----------------------------------------"
echo "   Lord of the Realms - Dev Server"
echo "----------------------------------------"
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null
then
    echo "Error: npm is not installed. Please install Node.js and npm first."
    exit 1
fi

echo "Starting server on http://localhost:8081..."
echo "Press Ctrl+C to stop the server"
echo ""

# Run http-server using npx
npx -y http-server . -p 8081 -c-1 --cors
