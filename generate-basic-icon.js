const fs = require('fs');
const path = require('path');

// This script creates a basic icon setup
// For production use, convert the SVG to proper ICO format using online tools

console.log('Setting up Tasktory icon configuration...');

// Ensure assets directory exists
const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir);
}

// Create a simple favicon-style icon for browsers
const simpleSvg = `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" fill="#2c3e50" rx="4"/>
  <rect x="8" y="8" width="16" height="2" fill="#ffffff" rx="1"/>
  <rect x="8" y="12" width="12" height="2" fill="#ffffff" rx="1"/>
  <rect x="8" y="16" width="14" height="2" fill="#ffffff" rx="1"/>
  <rect x="8" y="20" width="10" height="2" fill="#ffffff" rx="1"/>
  <circle cx="6" cy="9" r="1" fill="#27ae60"/>
  <circle cx="6" cy="13" r="1" fill="#27ae60"/>
  <circle cx="6" cy="17" r="1" fill="#f39c12"/>
  <circle cx="6" cy="21" r="1" fill="#e74c3c"/>
  <rect x="22" y="6" width="4" height="4" fill="#3498db" rx="1"/>
  <rect x="23" y="7" width="2" height="2" fill="#ffffff"/>
</svg>`;

fs.writeFileSync(path.join(assetsDir, 'favicon.svg'), simpleSvg);

// Create a placeholder icon info file
const iconInfo = `# Tasktory Icon Files

## Status: Configuration Ready ✅

The package.json has been configured to use custom icons:
- Windows: assets/icon.ico
- Mac: assets/icon.icns  
- Linux: assets/icon.png

## To complete icon setup:

1. Convert temp-icon.svg to ICO format:
   - Visit: https://convertio.co/svg-ico/
   - Upload: assets/temp-icon.svg
   - Download as: assets/icon.ico

2. Build the application:
   npm run build:win

## Icon Design Theme: ✍️ Writing & Productivity
- Clipboard/checklist style
- Task status indicators
- Time tracking element
- Professional blue color scheme
`;

fs.writeFileSync(path.join(assetsDir, 'icon-status.md'), iconInfo);

console.log('✅ Icon configuration completed!');
console.log('📁 Files created:');
console.log('   - assets/favicon.svg (for web use)');
console.log('   - assets/icon-status.md (status info)');
console.log('');
console.log('📋 Next steps:');
console.log('   1. Convert assets/temp-icon.svg to ICO format online');
console.log('   2. Save as assets/icon.ico');
console.log('   3. Run: npm run build:win');
console.log('');
console.log('🎨 The EXE file will have a custom writing-themed icon!');