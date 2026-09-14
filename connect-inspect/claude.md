# Connect-Inspect - Claude Code Guide

## Project Overview
Chrome extension for inspecting connectivity and network information.

## Structure
- `manifest.json` - Chrome extension manifest
- `content.js` - Main content script
- `popup.html/js` - Popup UI
- `sidepanel.html` - Side panel UI
- `service_worker.js` - Background worker
- `lib/` - Utility libraries
- `styles.css` - Shared styles
- `docs/` - Documentation
- `features/` - Feature modules
- `icons/` - Extension icons
- `test-fixtures/` - Test data
- `tools/` - Development tools

## How to Load
1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select this folder

## Key Files
- `manifest.json` - Update version before releases
- `popup.js` / `sidepanel.html` - Main UI files
- `content.js` - Injected into pages, handles core logic

## Before Pushing to GitHub
- Run `npm install` to set up dependencies
- Check that no sensitive data is in the code
- Test the extension loads without errors
- Update version in manifest.json if needed
