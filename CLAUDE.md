# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tasktory is an Electron-based desktop application designed to help users manage their busy schedules by tracking tasks and activities that need to be done or have been completed. The core purpose is to solve the problem of forgetting tasks and activities when overwhelmed with work, providing a reliable way to record and manage both pending and completed tasks.

## Development Commands

- **Start the application**: `npm start` or `electron .`
- **Run tests**: `npm test` (uses Jest)
- **Install dependencies**: `npm install`

## Core Requirements

### 1. Always-on-Top Display
- The application stays on top of all other windows like a sticky note program
- Implemented with `alwaysOnTop: true` in BrowserWindow configuration

### 2. Cross-Platform Compatibility
- Works on Windows, Linux, and macOS
- Current implementation uses Electron (JavaScript), which provides cross-platform support

### 3. Compact Interface
- Displays tasks in a table format with columns:
  - Start Time
  - Target Time
  - Task Content
  - Status
  - Actions (Edit, Done, Delete)
- Designed for small window size (600x400) for corner placement

### 4. Task Management Features
- **Add**: Add Task button to create new tasks
- **Edit**: Modify existing task details
- **Done**: Complete button that removes tasks from active list and logs them
- **Delete**: Remove tasks without completing them

### 5. Comprehensive Logging System
- Logs all user actions (add, complete, edit, delete) to persistent files
- Completed tasks are automatically moved from active list to log file
- Maintains historical record of all task activities

## Architecture

This is a complete Electron application with the following structure:

- **main.js**: Main Electron process with always-on-top window configuration and IPC handlers
- **index.html**: Task management interface with table layout and modal forms
- **renderer.js**: Client-side logic for task management and UI interactions
- **styles.css**: Compact styling optimized for small window size
- **preload.js**: Security bridge between main and renderer processes
- **package.json**: Node.js project configuration with Electron dependency

### Key Features Implemented:
- **Always-on-top window**: BrowserWindow configured with `alwaysOnTop: true`
- **Compact UI**: Table-based interface optimized for 600x400 window
- **Modal forms**: Popup forms for adding/editing tasks
- **IPC communication**: Secure file operations between main and renderer
- **Task persistence**: JSON files for active tasks, structured .log files for history
- **Date/time handling**: Local datetime inputs with Korean timezone support
- **Hybrid mode**: Works both in Electron (with always-on-top) and browser
- **Completion tracking**: Daily completion counter with animations and confetti effects
- **Structured logging**: Fixed-width column format for easy parsing and viewing

## Key Technologies

- **Electron 32.0.1**: Desktop app framework
- **HTML/CSS/JavaScript**: UI implementation
- **IPC (Inter-Process Communication)**: Secure file operations
- **JSON**: Data persistence format

## Development Notes

### Current State
- Fully functional task management application
- Always-on-top window for persistent visibility
- Compact design suitable for corner placement
- Complete CRUD operations for tasks
- Comprehensive logging system

### UI/UX Features
- Modal dialogs for task creation/editing
- Status indicators (Pending, Overdue, Done)
- Action buttons (Edit, Done, Delete)
- Daily completion counter with green highlighting
- Celebration animations (text scaling and confetti effects)
- Responsive design for small screens
- Auto-closing date pickers

### Technical Implementation
- Event delegation for dynamically generated buttons
- Local storage fallback for browser mode
- Export/import functionality in browser mode
- Proper error handling and user feedback
- CSP configured for security