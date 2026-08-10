# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tasktory is an Electron-based desktop application designed to help users manage their busy schedules by tracking tasks and activities that need to be done or have been completed. The core purpose is to solve the problem of forgetting tasks and activities when overwhelmed with work, providing a reliable way to record and manage both pending and completed tasks.

## Development Commands

- **Install dependencies**: `npm install`
- **Start the application**: `npm start` (= `electron .`)
- **Run tests**: `npm test` (Jest)
- **Package the app**: `npm run build` (electron-builder), or `build:win` / `build:mac` / `build:linux` for a single target. Output goes to `dist/`.

> **Adding a source file? Add it to `build.files` in package.json.** That list is an allowlist, not a filter. `recurrence.js` was missing from it for two releases: the packaged app 404'd on the script tag, `Recurrence` stayed undefined, and every guard fell through silently, so repeat rules did nothing once installed. Running from source hides this entirely. After a build, check the packaged contents:
> `npx asar list dist/win-unpacked/resources/app.asar`

## Recurring Tasks

**A recurring task is one row, and that row is the rule.** Completing it does not remove it — the dates advance to the next occurrence and the row stays. Rules live in `<userData>/data/rules.json` via the `load-rules` / `save-rules` IPC pair, deliberately separate from `tasks.json` (whose top level is a bare array); the row carries `ruleId`.

This is the Todoist model, not the calendar model. It was chosen deliberately:

- **The rule must be visible and reachable.** The only entry point to repeat settings is the task's edit modal. If completing hid the row, a monthly rule would be unreachable for a month — you could not edit or stop it. Keeping the row removes that whole class of problem, and with it the need for a rule-management screen.
- **Nothing is generated ahead of time.** There is no catch-up pass, no generation cursor, no cap on missed occurrences. `tasks.json` grows by one row per rule, not one per occurrence.
- **Completing advances exactly one step.** A task overdue by five occurrences takes five presses, and each logs its own `COMPLETE`, so the history is honest. To skip ahead the user edits the date — the app does not decide how many missed occurrences were real work.
- **Deleting the row deletes the rule.** Otherwise an unreachable rule would resurrect the row on next launch.
- **Times are wall-clock, not instants.** A rule stores `startTimeOfDay: '09:00'`, not an absolute datetime, so "every day at 09:00" keeps its meaning across timezones and DST. Dates are assembled in local time, matching how log files are named.
- `ensureRuleRows()` on start-up gives a row back to any enabled rule that has none — old data from the previous per-occurrence model, or an imported backup.
- Month-end is clamped: a "31st of each month" rule fires on 28/29 February and 30 April; a 29 February yearly rule fires on the 28th in common years.

`recurrence.js` is pure date maths and holds no policy: `nextOccurrenceAfter(rule, afterKey)`, `occurrenceTimes(rule, key)`, `localKey(date)`.

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
- Displays tasks in a table format with columns: select, #, Start Time, Target Time, Tags, Task Content, Status
- **Rows carry no action buttons.** They used to, and the column cost 16% of the table for buttons repeated on every row. Actions live in a permanent bar above the table and apply to whatever is ticked. The bar never appears or disappears - buttons dim instead - so the table does not shift when a selection changes.
- Designed for a small window, corner placement

### 4. Task Management Features
- **Add**: Add Task button to create new tasks
- **Edit**: Select one row and use the bar. Clicking anywhere in a row toggles its selection; chips are the exception and filter instead
- **Done**: Completing a one-off hides it; completing a repeating task advances it to the next occurrence (see Recurring Tasks)
- **Delete**: Removes without completing. Deleting a repeating row deletes its rule too
- **Bulk**: Edit and reorder need exactly one selection; the rest apply to all selected
- **Bulk toggles gather onto the marked state.** Highlight and notification never flip each task independently — a mixed selection would then land somewhere nobody could predict before pressing. If any selected task is *not* marked, all become marked; only when every one is already marked does the press undo it. Marked means highlighted for one and muted for the other, so the two look opposite but follow the same rule: go to whichever state the user deliberately sets. The selection survives a toggle (unlike complete and delete, whose rows leave the list) — otherwise undoing would need the rows picked again, and the second press looked like a no-op. Neither toggle is throttled: with row buttons gone there are no duplicate events to absorb, and a throttle only swallows the deliberate press-and-undo
- **Complete and delete ask first, once for the whole selection.** `showConfirmModal(action, taskIds)` takes an array — asking per row would open ten modals to delete ten rows. Moving the actions to the bar once cut the modal off entirely: `runBulkAction` called `doCompleteTask` directly and nothing ever asked. The completion time is editable and defaults to now, because yesterday's work gets ticked off today; it lands in `completedAt` and in the log body, never in the log `TIMESTAMP`, which records when the action was taken
- **Target time is optional.** A task saved without one is *ongoing*: never overdue or due soon, raises no notifications, and cannot carry a repeat rule

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
- **manifest.json**, **service-worker.js**, **register-sw.js**: PWA support, so the app installs to a phone home screen and opens offline. Registration is skipped under `file://`, where Electron runs
- **docs/sync-architecture.md**: design proposal for multi-device sync. Not implemented
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

### UI/UX Features
- **SVG Icon System**: Consistent vector icons replacing emojis for professional appearance
- **Dark Mode Support**: Comprehensive dark theme with proper color variables
- **Modal dialogs**: Task creation/editing with inline help text
- **Status indicators**: Pending, In Progress, Due Soon, Overdue, Completed
- **Action bar**: Notification, Edit, Complete, Delete, Highlight, Move Up/Down - applied to the current selection
- **Collapse Mode**: 150px side strip, read-only, dynamic height. 80px could not fit four Korean characters
- **Calendar view** (`viewMode`, persisted): a month grid, Monday-first, alongside the list. A list answers "what is there", a calendar answers "when does it pile up". **View-only on purpose** — no selection, no editing, nothing clickable inside a cell; the list does all of that. A task appears on *every* day it spans, because work started Monday and due Wednesday is in hand on Tuesday too. Tasks with no target time have no length to draw, so they sit at the top of their start day with no time, where an all-day entry goes. Collapsed calendar narrows to today in one column — 150px cannot hold seven — and `collapsedRowCount()` sizes the window to what is actually drawn, not to every active task. Cells are built as an HTML string, so `escapeHtml` is not optional
- **One filter for both views**: `filteredActiveTasks()` is shared. Filtering separately meant a search set in one view came out differently in the other
- **Date format**: chosen in settings; the table and the modal share one pattern string, which generates both the output and the parsing regex so they cannot disagree. Storage stays `YYYY-MM-DD HH:mm` whatever the display setting
- **Date/time picker**: our own, because `datetime-local` cannot follow a custom format. It has a confirm button, unlike the native one
- **Reminders**: one `LEAD_MINUTES` list drives both the notifications and the "due soon" badge, so they cannot drift apart. Not user-configurable — the earlier settings and per-task fields were removed as unnecessary
- **Chips filter on click**: tags, status and repeat cadence. No hidden keyword to guess, and it works in any UI language
- **Quick filters** sit under the search box and do the same job from a fixed place, so you need not hunt for a row carrying the chip you want. Only statuses and tags actually present are listed — a filter that matches nothing is a button that empties the table. `All` clears the search *and* resets the search column; leaving the column narrowed meant the next word typed was quietly searched in that one column
- **Unfocused opacity** lives in `localStorage` and is pushed to main on every start-up. `main.js` keeps it in a plain variable, so without that it reset to 1.0 on every launch — and it was missing from backups for the same reason
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