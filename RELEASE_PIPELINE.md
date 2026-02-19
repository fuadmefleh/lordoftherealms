# Release Pipeline Documentation

## Overview

This repository has an automated release pipeline that creates both web bundles and Windows desktop installers when a version tag is pushed.

## How to Create a Release

1. Update the version in `package.json`:
   ```json
   "version": "0.4.0"
   ```

2. Commit the version change:
   ```bash
   git add package.json
   git commit -m "Bump version to 0.4.0"
   ```

3. Create and push a git tag:
   ```bash
   git tag v0.4.0
   git push origin v0.4.0
   ```

4. The GitHub Actions workflow will automatically:
   - Run tests
   - Build the web bundle (ZIP file)
   - Build the Windows installer (EXE)
   - Create a GitHub Release with both artifacts
   - Generate release notes

## Release Artifacts

Each release includes:

1. **Web Bundle** (`lord-of-the-realms-vX.X.X.zip`)
   - Contains all game files ready to play in a browser
   - Can be hosted on any web server
   - Can be opened locally by opening `index.html`

2. **Windows Installer** (`Lord-of-the-Realms-Setup-X.X.X.exe`)
   - NSIS installer for Windows
   - Installs the game as a desktop application using Electron
   - Creates Start Menu and Desktop shortcuts
   - User-level installation (no admin rights required)

## Pre-release Versions

To create a pre-release (alpha, beta, or release candidate), include the stage in the version tag:

```bash
git tag v0.4.0-alpha.1
git tag v0.4.0-beta.2
git tag v0.4.0-rc.1
```

The release will automatically be marked as a pre-release on GitHub.

## Desktop Application

The desktop version is built using Electron and electron-builder:

- **Electron Main Process**: `electron-main.js`
  - Creates a 1280x800 window
  - Loads the game's `index.html`
  - Implements security best practices

- **Build Configuration**: `electron-builder.json`
  - Configures NSIS installer for Windows
  - Includes future support for macOS (DMG) and Linux (AppImage/deb)
  - Packages only necessary game files

## Local Development

### Running the desktop app locally:

```bash
npm install
npm run electron
```

### Running in development mode (with DevTools):

```bash
npm run electron:dev
```

### Building installers locally:

**Windows:**
```bash
npm run build:win
```

**macOS:**
```bash
npm run build:mac
```

**Linux:**
```bash
npm run build:linux
```

**All platforms:**
```bash
npm run build:all
```

Note: Building for a platform requires running on that platform (or using additional tools like wine/darling).

## GitHub Actions Workflow

The release workflow (`.github/workflows/release.yml`) consists of three jobs:

1. **test** - Runs on Ubuntu
   - Installs dependencies
   - Starts test server
   - Validates that test page loads

2. **build-and-release** - Runs on Ubuntu
   - Creates web bundle ZIP
   - Uploads as artifact

3. **build-windows-installer** - Runs on Windows
   - Builds Windows EXE installer
   - Uploads as artifact

4. **create-release** - Runs on Ubuntu
   - Downloads both artifacts
   - Creates GitHub Release
   - Publishes both web bundle and Windows installer

## Troubleshooting

### Installer build fails

- Check that `electron-builder.json` is valid JSON
- Verify all game files are included in the `files` array
- Check Windows runner logs for specific errors

### Web bundle is missing files

- Update the file copy commands in the workflow
- Check `.gitignore` to ensure files aren't excluded

### Release doesn't trigger

- Verify the tag matches the pattern `v*.*.*`
- Check that you pushed the tag: `git push origin v0.4.0`
- Review GitHub Actions workflow permissions

## Security

- Electron app uses security best practices:
  - No Node.js integration in renderer
  - Context isolation enabled
  - Remote module disabled
- Dependencies are automatically checked for vulnerabilities
- CodeQL scanning runs on all code changes
