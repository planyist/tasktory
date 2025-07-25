# Tasktory

A compact desktop application for managing tasks with always-on-top functionality. Track your tasks efficiently without losing focus on your work.

## Features

### Core Features
- **Always-on-Top**: Stays visible above all other windows like a sticky note
- **Compact Design**: Optimized for corner placement (600x400 window)
- **Ultra-Compact Mode**: Toggle to 80px width for minimal screen space usage
- **Task Management**: Add, edit, complete, delete, highlight, and reorder tasks
- **Time Tracking**: Set start and target times with intelligent status updates
- **Tag System**: Organize tasks with colored tags using GitHub-style color schemes
- **Search & Filter**: Real-time task filtering with pagination support

### UI/UX (v0.2.x)
- **SVG Icon System**: Professional vector icons throughout the interface
- **Dark Mode**: Complete dark theme with automatic system detection
- **Smart Status Indicators**: Pending, In Progress, Due Soon, Overdue, Completed
- **Notification System**: Per-task notification settings with system alerts  
- **Statistics Dashboard**: Visual completion trends over 30 days
- **Completion Celebrations**: Animated counter with confetti effects
- **Internationalization**: Support for English, Korean, Chinese, Japanese, Spanish

### Technical Features
- **Comprehensive Logging**: All actions logged in structured .log format
- **Cross-Platform**: Works on Windows, Linux, and macOS  
- **Dual Mode**: Runs as Electron app (with always-on-top) or in browser
- **Export/Import**: JSON backup and restore functionality
- **Security**: Content Security Policy and IPC isolation

## Installation

### Option 1: Run from Source
```bash
# Clone the repository
git clone https://github.com/planyist/tasktory.git
cd tasktory

# Install dependencies
npm install

# Start the application
npm start
```

### Option 2: Build Executable
```bash
# Install electron-builder (if not already installed)
npm install --save-dev electron-builder

# Build for your platform
npm run build:win   # For Windows (.exe)
npm run build:mac   # For macOS (.dmg)
npm run build:linux # For Linux (.AppImage)
```

### Option 3: Browser Mode
Simply open `tasktory-standalone.html` in your web browser for a version without always-on-top functionality.

## Usage

### Basic Operations
1. **Adding Tasks**: Click the "+" button or press `Ctrl+N` to create new tasks
2. **Editing Tasks**: Click the edit icon (✏️) next to any task to modify it
3. **Completing Tasks**: Click the checkmark (✓) to mark tasks as completed
4. **Deleting Tasks**: Click the delete icon (🗑️) to remove tasks without completing
5. **Highlighting**: Click the lightning bolt (⚡) to highlight important tasks
6. **Reordering**: Use up/down arrows (↑↓) to change task order
7. **Notifications**: Click the bell icon (🔔) to toggle task notifications

### Advanced Features
- **Tag Presets**: Create colored tag presets in Settings for quick tagging
- **Search**: Use the search box to filter tasks by content, tags, or status
- **Statistics**: View completion trends and productivity patterns
- **Dark Mode**: Toggle between light and dark themes in Settings
- **Collapse Mode**: Switch to ultra-compact 80px width for minimal footprint
- **Export/Import**: Backup and restore your tasks via JSON files

### Status System
Tasks automatically show status based on timing:
- **Pending**: Before start time
- **In Progress**: Between start and target time  
- **Due Soon**: Less than 1 hour remaining
- **Overdue**: Past target time
- **Completed**: Task marked as done

### Tag System
Use hashtags with optional colors:
- Basic tags: `#meeting #urgent`
- Colored tags: `#[RED]urgent #[GREEN]completed #[BLUE]research`
- Available colors: RED, GREEN, BLUE, YELLOW, PURPLE, ORANGE, GRAY, PINK

## Keyboard Shortcuts

- `Ctrl/Cmd + N`: Add new task
- `Ctrl/Cmd + M`: Toggle ultra-compact mode (80px width)
- `ESC`: Close modal or date picker

## Data Storage

- **Electron Mode**: Tasks stored in JSON files, logs in structured .log format in the app's data directory
- **Browser Mode**: Data stored in browser's localStorage with export/import functionality
- **Log Format**: Daily log files with fixed-width columns for easy parsing and viewing

## Distribution Protection

This project is licensed under the MIT License, which allows:
- ✅ Commercial use
- ✅ Modification
- ✅ Distribution
- ✅ Private use

However, any distributed copies must include the original license and copyright notice.

## Building for Distribution

To create a standalone executable that doesn't require Node.js or npm:

```bash
# Install dependencies
npm install

# Build executable for Windows
npm run build:win

# The executable will be in the 'dist' folder
```

This creates a `.exe` file that users can run without any additional setup.

## Development

### Project Structure
```
Tasktory/
├── main.js          # Main Electron process
├── preload.js       # Security bridge
├── renderer.js      # Client-side logic
├── index.html       # UI structure
├── styles.css       # Styling
├── package.json     # Project configuration
├── LICENSE          # MIT License
└── README.md        # This file
```

### Technology Stack
- **Electron**: Desktop app framework
- **HTML/CSS/JavaScript**: UI implementation
- **IPC**: Secure communication between processes
- **JSON**: Data persistence

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

If you encounter any issues, please report them at the [GitHub Issues](https://github.com/planyist/tasktory/issues) page.