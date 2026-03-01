# Release Process

This repository includes an automated GitHub Actions workflow for creating releases, including a **Windows installer (.exe)** built with Electron.

## How to Create a Release

### 1. Update Version Number

First, update the version in `package.json`:

```json
{
  "version": "0.4.0"
}
```

Also update the version badge in `README.md` if needed.

### 2. Commit Your Changes

```bash
git add .
git commit -m "Bump version to 0.4.0"
git push origin main
```

### 3. Create and Push a Version Tag

```bash
# Create a tag matching the version
git tag v0.4.0

# Push the tag to GitHub
git push origin v0.4.0
```

### 4. Automated Release Process

Once you push a tag that matches the pattern `v*.*.*`, the GitHub Actions workflow will automatically:

1. ✅ **Run Tests** - Verify the game still works correctly
2. 🖥️ **Build Windows Installer** - Package the game as a Windows .exe using Electron
3. 📦 **Create Browser Bundle** - Package all game files into a downloadable zip
4. 📝 **Generate Release Notes** - Create formatted release notes
5. 🚀 **Publish Release** - Create a GitHub release with both the installer and zip attached

### 5. Monitor the Release

You can monitor the progress of the release:

1. Go to the **Actions** tab in your GitHub repository
2. Click on the running "Release" workflow
3. Watch the progress of each job

### Release Contents

Each release will include two download options:

#### Windows Installer (.exe)
- One-click installer for Windows
- Creates Start Menu and Desktop shortcuts
- Runs the game as a standalone desktop app (no browser needed)
- Built with Electron + electron-builder

#### Browser Bundle (.zip)
- `index.html` - Main game entry point (Vite build output)
- `js/` - Bundled game code and CSS
- `assets/` - All game sprites and tiles
- `data/` - Game configuration and data files
- `editor.html` + editor HTML files - Built-in modding tools
- `README.md` - Documentation

### Local Development with Electron

To test the desktop app locally:

```bash
# Install dependencies (includes Electron)
npm install

# Run the game in Electron
npm run electron

# Build the Windows installer locally
npm run dist
```

### Version Numbering

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** version (v1.0.0 → v2.0.0) - Incompatible changes
- **MINOR** version (v0.3.0 → v0.4.0) - New features, backwards compatible
- **PATCH** version (v0.3.0 → v0.3.1) - Bug fixes, backwards compatible

### Examples

```bash
# Patch release (bug fixes)
git tag v0.3.1
git push origin v0.3.1

# Minor release (new features)
git tag v0.4.0
git push origin v0.4.0

# Major release (breaking changes)
git tag v1.0.0
git push origin v1.0.0
```

### Troubleshooting

**If the workflow fails:**

1. Check the Actions tab for error logs
2. Common issues:
   - Tests failing: Fix the tests before releasing
   - Missing files: Ensure all required files are committed
   - Permission errors: Verify repository settings allow workflow to create releases

**To delete a release:**

```bash
# Delete the tag locally
git tag -d v0.4.0

# Delete the tag on GitHub
git push origin :refs/tags/v0.4.0

# Then manually delete the release from GitHub's Releases page
```

## Pre-release Versions

For beta or release candidate versions, use tags like:
- `v0.4.0-beta.1`
- `v0.4.0-rc.1`

The workflow will automatically mark these as pre-releases.

## Manual Release (Alternative)

If you prefer to create releases manually without the workflow:

1. Go to the **Releases** page on GitHub
2. Click **Draft a new release**
3. Choose or create a tag
4. Fill in the release notes
5. Upload the game files as a zip
6. Click **Publish release**
