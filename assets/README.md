# Assets

This folder should contain application icons for different platforms:

- `icon.ico` - Windows icon (256x256 or multiple sizes)
- `icon.icns` - macOS icon (512x512)
- `icon.png` - Linux icon (512x512)

## Icon Requirements

### Windows (.ico)
- Format: ICO
- Recommended sizes: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256
- Use online converters or tools like GIMP to create .ico files

### macOS (.icns)
- Format: ICNS
- Size: 512x512 (will be scaled automatically)
- Use `iconutil` command or online converters

### Linux (.png)
- Format: PNG
- Size: 512x512
- Transparent background recommended

## Creating Icons

1. Design a 512x512 PNG image
2. Convert to required formats:
   - PNG → ICO: Use online converters
   - PNG → ICNS: Use online converters or `png2icns` tool

Without these icons, electron-builder will use default icons for the built applications.