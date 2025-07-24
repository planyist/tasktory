# Tasktory

A compact desktop application for managing tasks with always-on-top functionality. Track your tasks efficiently without losing focus on your work.

## Features

- **Always-on-Top**: Stays visible above all other windows like a sticky note
- **Compact Design**: Optimized for corner placement (600x400 window)
- **Task Management**: Add, edit, complete, and delete tasks with ease
- **Time Tracking**: Set start and target times for each task
- **Status Indicators**: Visual status (Pending, Overdue, Done)
- **Comprehensive Logging**: All actions are logged for history tracking
- **Cross-Platform**: Works on Windows, Linux, and macOS
- **Dual Mode**: Runs as Electron app (with always-on-top) or in browser

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

1. **Adding Tasks**: Click the "+ Add Task" button to create new tasks
2. **Editing Tasks**: Click the "Edit" button next to any task to modify it
3. **Completing Tasks**: Click "Done" to mark tasks as completed (removes from list)
4. **Deleting Tasks**: Click "Delete" to remove tasks without completing them
5. **Status Tracking**: Tasks automatically show as Pending or Overdue based on target time

## Keyboard Shortcuts

- `Ctrl/Cmd + N`: Add new task
- `ESC`: Close modal or date picker

## Data Storage

- **Electron Mode**: Data stored in JSON files in the app's data directory
- **Browser Mode**: Data stored in browser's localStorage with export/import functionality

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