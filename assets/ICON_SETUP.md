# Tasktory Custom Icon Setup

## Overview
The Tasktory application now includes a custom writing-themed icon configuration. The icon design features a clipboard/checklist style that represents task management and productivity.

## Current Status
✅ SVG icon design created (`temp-icon.svg`)
✅ Package.json configured for custom icons
✅ Setup script available (`setup-icons.js`)
⏳ Icon files need to be converted to required formats

## Icon Design
The current design includes:
- **Background**: Dark blue (#2c3e50) representing professionalism
- **Task lines**: White horizontal lines representing tasks
- **Status indicators**: Colored circles (green ✅, orange ⏳, red ❌)
- **Clock element**: Blue square with white center representing time tracking

## Quick Setup Steps

### 1. Convert SVG to Required Formats
```bash
# Run the setup script to see current status
node setup-icons.js
```

### 2. Manual Conversion (Recommended)
1. **For Windows (.ico)**:
   - Visit: https://convertio.co/svg-ico/
   - Upload: `assets/temp-icon.svg`
   - Set size: 256x256px
   - Download and save as: `assets/icon.ico`

2. **For Mac (.icns)** (Optional):
   - Visit: https://cloudconvert.com/svg-to-icns
   - Upload: `assets/temp-icon.svg`
   - Download and save as: `assets/icon.icns`

3. **For Linux (.png)** (Optional):
   - Visit: https://convertio.co/svg-png/
   - Upload: `assets/temp-icon.svg`
   - Set size: 512x512px
   - Download and save as: `assets/icon.png`

### 3. Build with Custom Icon
```bash
# Build Windows executable with custom icon
npm run build:win

# Build for all platforms
npm run build
```

## Verification
After building, verify the custom icon appears on:
- Windows: Tasktory.exe in the `dist/` folder
- Application shortcuts
- Windows taskbar when running

## Troubleshooting
- Ensure icon files are exactly in the `assets/` directory
- Icon files should be properly formatted (ICO for Windows)
- Clear build cache if icons don't appear: delete `dist/` folder and rebuild

## Design Modifications
To customize the icon further, edit `temp-icon.svg` and regenerate the icon files:
- Change colors in the SVG
- Modify shapes or layout
- Re-convert to required formats
- Rebuild the application

The icon configuration is now complete and ready for use with a custom writing/productivity themed design.