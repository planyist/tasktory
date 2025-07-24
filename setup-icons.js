const fs = require('fs');
const path = require('path');

console.log('='.repeat(60));
console.log('Tasktory Icon Setup Instructions');
console.log('='.repeat(60));

// Check if icon files exist
const iconFiles = {
    ico: path.join(__dirname, 'assets', 'icon.ico'),
    icns: path.join(__dirname, 'assets', 'icon.icns'),
    png: path.join(__dirname, 'assets', 'icon.png')
};

console.log('\n1. Current icon status:');
for (const [format, filePath] of Object.entries(iconFiles)) {
    const exists = fs.existsSync(filePath);
    console.log(`   ${format.toUpperCase()}: ${exists ? '✅ Found' : '❌ Missing'}`);
}

if (!fs.existsSync(iconFiles.ico)) {
    console.log('\n2. To create icon files:');
    console.log('   a) Visit: https://convertio.co/svg-ico/');
    console.log('   b) Upload: assets/temp-icon.svg');
    console.log('   c) Convert to ICO format (256x256px)');
    console.log('   d) Download and save as: assets/icon.ico');
    console.log('');
    console.log('   For Mac support (optional):');
    console.log('   - Convert SVG to ICNS: https://cloudconvert.com/svg-to-icns');
    console.log('   - Save as: assets/icon.icns');
    console.log('');
    console.log('   For Linux support (optional):');
    console.log('   - Convert SVG to PNG (512x512px): https://convertio.co/svg-png/');
    console.log('   - Save as: assets/icon.png');
} else {
    console.log('\n2. ✅ Icon files are ready!');
    
    // Update package.json to include icon configuration
    const packagePath = path.join(__dirname, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    
    // Update build configuration
    if (!packageJson.build.win) {
        packageJson.build.win = {};
    }
    if (!packageJson.build.mac) {
        packageJson.build.mac = {};
    }
    if (!packageJson.build.linux) {
        packageJson.build.linux = {};
    }
    
    packageJson.build.win.icon = "assets/icon.ico";
    if (fs.existsSync(iconFiles.icns)) {
        packageJson.build.mac.icon = "assets/icon.icns";
    }
    if (fs.existsSync(iconFiles.png)) {
        packageJson.build.linux.icon = "assets/icon.png";
    }
    
    // Write updated package.json
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
    console.log('   📦 package.json updated with icon configuration');
}

console.log('\n3. After creating icon files, run:');
console.log('   npm run build:win    # For Windows executable');
console.log('   npm run build        # For all platforms');

console.log('\n4. The custom Tasktory icon will be applied to the EXE file.');
console.log('='.repeat(60));