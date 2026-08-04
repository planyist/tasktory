# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tasktory is an Electron-based desktop application designed to help users manage their busy schedules by tracking tasks and activities that need to be done or have been completed. The core purpose is to solve the problem of forgetting tasks and activities when overwhelmed with work, providing a reliable way to record and manage both pending and completed tasks.

## Development Commands

- **Install dependencies**: `npm install`
- **Start the application**: `npm start` (= `electron .`)
- **Run tests**: `npm test` (Jest)
- **Package the app**: `npm run build` (electron-builder), or `build:win` / `build:mac` / `build:linux` for a single target. Output goes to `dist/`.

## Recurring Tasks

A recurring item is stored as a **rule**, never as a task. Only the instances a rule produces appear in the list. Rules live in `<userData>/data/rules.json` via the `load-rules` / `save-rules` IPC pair, deliberately separate from `tasks.json` (whose top level is a bare array).

- **Generation happens on app start, not on a timer.** Tasktory is not always running, so `Recurrence.catchUp(rules, tasks, now)` is called from `init()` to catch up on whatever came due while the app was closed. `rule.lastGeneratedKey` makes it idempotent — opening the app repeatedly produces nothing new.
- **Times are wall-clock, not instants.** A rule stores `startTimeOfDay: '09:00'`, not an absolute datetime, so "every day at 09:00" keeps its meaning across timezones and DST. Instances are assembled in local time, matching how log files are named.
- **Missed occurrences are capped.** After a long gap only the most recent occurrence is created; the number dropped comes back as `result.skipped`. Do not silently discard it.
- **Carry-over is accumulate**: a new occurrence is added even when the previous one is still pending. That policy lives entirely in `shouldCreate()` — switch it there to get replace-in-place behaviour instead.
- Instances carry `ruleId` and `occurrenceKey`; the pair is a second line of defence against duplicates and drives the repeat badge in the table.
- Repeat settings appear only when **adding** a task. Editing an instance changes that occurrence alone, so the repeat section is hidden in edit mode.
- Month-end is clamped: a "31st of each month" rule fires on 28/29 February and 30 April.

## Testing

- **Framework**: Jest. Tests live in `tests/`.
- **`__mocks__/electron.js`** is a manual mock that Jest applies automatically to any test requiring `main.js`. It records every `ipcMain.handle()` registration so tests can call handlers directly via `__invoke(channel, ...args)`, and makes `app.getPath('userData')` return the directory named by the `TASKTORY_USERDATA` env var — so main-process tests do real file I/O against a temp dir.
- **`tests/setup-timezone.js`** pins `TZ=Asia/Seoul` for the whole run, so tests covering the local-date vs UTC-date distinction behave identically on every machine.
- `renderer.js` and the inline script in `tasktory-standalone.html` are classic browser scripts with no exports. Tests evaluate the source with `new Function(src + '; return TaskManager;')` rather than adding an export purely for testing. For unit-level tests, build instances with `Object.create(TaskManager.prototype)` to skip the constructor's async `init()`.
- Test files that need a DOM use the `@jest-environment jsdom` docblock; the default environment is `node`.
- **Definition of done**: a bug fix ships with a test that fails before the change and passes after.

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
- One file per day under `<userData>/logs/`, named `YYYY-MM-DD.tsv` by **local** date. Columns: `TIMESTAMP ACTION STATUS TASK_ID START_TIME TARGET_TIME TAGS CONTENT`.
- `TIMESTAMP` carries the UTC offset (`2026-08-04T14:30:00+09:00`) because a log is a permanent record — without it the zone cannot be recovered later, and in DST regions the same wall-clock time occurs twice. `START_TIME`/`TARGET_TIME` deliberately stay zone-less: they express wall-clock intent, not an instant.
- v0.2.5 and earlier wrote `YYYY-MM-DD.log` in a fixed-width format instead (ACTION at characters 25–40). `get-completed-tasks-count` still reads those as a fallback so the daily counter and the 30-day chart keep pre-upgrade history. Do not drop that fallback.
- `add-log` is serialized through a promise queue: the renderer fires it without awaiting, and the header write would otherwise truncate rows a concurrent call had already appended.

## Architecture

This is a complete Electron application with the following structure:

- **main.js**: Main Electron process with always-on-top window configuration and IPC handlers
- **index.html**: Task management interface with table layout and modal forms
- **renderer.js**: Client-side logic for task management and UI interactions (single `TaskManager` class)
- **styles.css**: Compact styling optimized for small window size
- **preload.js**: Security bridge between main and renderer processes
- **package.json**: Node.js project configuration with Electron dependency
- **recurrence.js**: Pure recurring-task engine, loaded via `<script>` before `renderer.js` (see Recurring Tasks below)
- **tasktory-standalone.html**: Self-contained single-file browser build with its own, simpler copy of `TaskManager` (localStorage only, no IPC). Independent of `renderer.js` — changes do not propagate between the two.
- **tests/**, **`__mocks__/`**: Jest suite and the manual `electron` mock (see Testing below)
- **create-icons.js**, **generate-basic-icon.js**, **setup-icons.js**: one-off scripts for generating the app icons in `assets/`
- **assets/**: app icons and icon-generation notes
- **data/**: runtime task/log data written by the app (gitignored)

### Key Features Implemented:
- **Always-on-top window**: BrowserWindow configured with `alwaysOnTop: true`
- **Compact UI**: Table-based interface optimized for 600x400 window
- **Modal forms**: Popup forms for adding/editing tasks
- **IPC communication**: Secure file operations between main and renderer
- **Task persistence**: JSON file for active tasks, one dated TSV log per day for history
- **Date/time handling**: Local datetime inputs with Korean timezone support
- **Hybrid mode**: Works both in Electron (with always-on-top) and browser
- **Completion tracking**: Daily completion counter with animations and confetti effects
- **Structured logging**: Tab-separated (TSV) format for easy parsing and viewing

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

### UI/UX Features (v0.2.x)
- **SVG Icon System**: Consistent vector icons replacing emojis for professional appearance
- **Dark Mode Support**: Comprehensive dark theme with proper color variables
- **Modal dialogs**: Task creation/editing with inline help text
- **Status indicators**: Pending, In Progress, Due Soon, Overdue, Completed
- **Action buttons**: Edit, Complete, Delete, Highlight, Move Up/Down, Notifications
- **Collapse Mode**: Ultra-compact 80px width view with dynamic height
- **Tag System**: Colored tag presets with GitHub-style color schemes
- **Daily completion counter**: Animated counter with confetti celebrations
- **Internationalization**: Support for English, Korean, Chinese, Japanese, Spanish
- **Search functionality**: Real-time task filtering
- **Pagination**: Smart pagination for large task lists

### Technical Implementation
- **SVG Icons**: Scalable vector graphics with currentColor for theme compatibility
- **CSS Variables**: Centralized color management for light/dark themes
- **Event delegation**: Efficient handling of dynamically generated buttons  
- **IPC Security**: Secure communication between main and renderer processes
- **Local storage fallback**: Browser mode compatibility with export/import
- **Internationalization**: Auto-detection of system locale with fallback
- **Tag Color System**: #[COLOR]content format for colored tags
- **Notification System**: Per-task notification settings with system alerts
- **Statistics**: Visual charts showing completion trends over 30 days
- **CSP Security**: Content Security Policy configured for secure execution