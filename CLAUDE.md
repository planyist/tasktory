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
>
> **`npx asar list` only reads. `npx asar extract-file` writes into the current directory** — run it on `package.json` from the project root and it silently replaces the real one with the packaged copy, which is whatever version that build was. The symptom is `npm error Missing script: "test"`, several commands after the damage. `git checkout -- package.json` restores it. Use `list`, or extract into a scratch directory.
>
> **The build fails if anything holds `dist/win-unpacked/resources/app.asar`** — `EnsureEmptyDir ... being used by another process`. Usually the installed app is running, but a scanner can hold it with no process visible in `Get-Process`. Build elsewhere rather than hunting the handle: `npx electron-builder --win -c.directories.output=dist-build`.

## Recurring Tasks

**A recurring task is one row, and that row is the rule.** Completing it does not remove it — the row stays and only its two dates are rewritten to the next occurrence (`Object.assign(task, occurrenceTimes(rule, nextKey))`; content, tags and id are untouched).

Status is never stored — it is recomputed from those dates every render. So moving the dates forward is *why* a completed repeat usually shows as Pending again; "advances to the next occurrence" and "goes back to pending" describe the same single change, one as cause and one as effect. Not always Pending, though: a task two occurrences behind is still Overdue after one press, and takes one press per missed occurrence to catch up. Rules live in `<userData>/data/rules.json` via the `load-rules` / `save-rules` IPC pair, deliberately separate from `tasks.json` (whose top level is a bare array); the row carries `ruleId`.

This is the Todoist model, not the calendar model. It was chosen deliberately:

- **The rule must be visible and reachable.** The only entry point to repeat settings is the task's edit modal. If completing hid the row, a monthly rule would be unreachable for a month — you could not edit or stop it. Keeping the row removes that whole class of problem, and with it the need for a rule-management screen.
- **Nothing is generated ahead of time.** There is no catch-up pass, no generation cursor, no cap on missed occurrences. `tasks.json` grows by one row per rule, not one per occurrence.
- **Completing advances exactly one step.** A task overdue by five occurrences takes five presses, and each logs its own `COMPLETE`, so the history is honest. To skip ahead the user edits the date — the app does not decide how many missed occurrences were real work.
- **Deleting the row deletes the rule.** Otherwise an unreachable rule would resurrect the row on next launch.
- **Times are wall-clock, not instants.** A rule stores `startTimeOfDay: '09:00'`, not an absolute datetime, so "every day at 09:00" keeps its meaning across timezones and DST. Dates are assembled in local time, matching how log files are named.
- `ensureRuleRows()` on start-up gives a row back to any enabled rule that has none — old data from the previous per-occurrence model, or an imported backup.
- Month-end is clamped: a "31st of each month" rule fires on 28/29 February and 30 April; a 29 February yearly rule fires on the 28th in common years.
- **`untilDate` ends the repeat** (inclusive). Empty means forever, which stays the default. Past the end `nextOccurrenceAfter` returns null, and the caller reads that as "nothing left to advance to", so the last occurrence completes like an ordinary task and its row leaves the list. The end date need not fall on an occurrence — a Monday rule ending on a Thursday simply stops at the Monday before.

`recurrence.js` is pure date maths and holds no policy: `nextOccurrenceAfter(rule, afterKey)`, `occurrenceTimes(rule, key)`, `localKey(date)`.

## Driving the real app

**Never automate the user's desktop.** Testing whether the window survived Win+D,
I drove `Shell.Application.ToggleDesktop()` from PowerShell in a loop. It toggles;
it does not set. A run that ended between the two calls left Windows stuck in
Show Desktop, so afterwards other applications opened without coming to the
front — which looks exactly like the app bug being investigated, and wasted a
round of diagnosis chasing the wrong thing. `Shell.Application.UndoMinimizeALL()`
restores it. Test window behaviour on windows this process owns, and leave the
desktop alone.



`npm start` is the human path. To look at the UI from here, the scratchpad holds
throwaway Electron scripts (`shoot.js`, `audit.js`, `themes.js`…) that load
`index.html`, seed `taskManager` over `executeJavaScript`, and `capturePage()`.

**`main.js` can be required, and its own window works.** `loadFile` resolves against the app path, not `__dirname`, so while it read `loadFile('index.html')` any script that required `main.js` got a window pointed at *its own* folder — a blank page, no `taskManager`, and `localStorage` throwing `SecurityError` because the origin was a file that did not exist. That looked like "main.js's window blocks localStorage" and sent one investigation down the wrong path entirely. It is `path.join(__dirname, 'index.html')` now.

**Measuring a caret:** `capturePage` does record one, so an all-white strip is real evidence rather than a blind spot — verified against a plain input. But a window without OS focus draws no caret at all, so the probe must call `win.focus()`; and sampling "the darkest pixel near the caret" measures the glyph beside it. Sample a narrow strip at the caret's computed x and look for the blink.

**Every one of them must call `app.setPath('userData', …)` before `ready`.**
They run the real renderer, so anything that reaches `saveTasks` writes the
user's actual `tasks.json`. One of these scripts called `saveTask()` against the
live directory; it happened to fail form validation, but had it passed it would
have replaced the task list with test data.

Two other traps: seed *after* `init()` has finished its async `loadTasks`, or the
seed is silently overwritten (~3s is enough); and the first `capturePage()` often
returns an empty buffer, so retry until the PNG has real length.

## CI

`.github/workflows/ci.yml` runs `npm test` on every push and pull request to
`main`. It sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1` — the Jest suite never touches
a real Electron binary, because `__mocks__/electron.js` stands in for it, and
downloading ~100MB per run for nothing is wasteful. Verified by moving
`node_modules/electron/dist` aside locally: the whole suite still passes.

Tests must not depend on the machine. One assertion checked the date picker's
label for the string `August`, which really checked the runner's ICU data —
`toLocaleDateString` is the only locale-sensitive call in the app. It asserts on
`pickerMonth.getMonth()` now. Anything reading a formatted month, weekday or
number belongs in the same category.

`npm run check:window` is the second real-window script. `check-ui.js` builds its
own window with no preload, so `isElectron` is false there and nothing reaches
the resize IPC — collapsing in that script changes the page and leaves the window
alone. Anything about the window's own size has to run against the window
`main.js` creates, which is what `check-window.js` does: collapse and expand at
the default size, at a size the user chose, and while maximized.

Both of those last two shipped broken. Expanding restored a hardcoded `900x500`,
so widening the window and collapsing once threw the size away; and a maximized
window cannot be resized with `setBounds` at all, so Ctrl+M drew the strip and
left the window covering the screen. `main.js` remembers the bounds *and* whether
it was maximized, and puts back whichever it was.

`npm run check:ui` is **not** in CI. It needs a real window, which on a Linux
runner means xvfb and a whole class of flakiness that would make the badge
untrustworthy. Run it locally after visual work.

README screenshots live in `docs/screenshots/` and are regenerated by a
scratchpad script. Two traps when capturing: seed the data *after* `init()`'s
async `loadTasks` has finished — and confirm the seed is still there a second
later, because a check that passes immediately can be overwritten right after —
and give the sample tasks times that produce several different statuses, or the
list looks far more monotone than the app really is.

## Testing

**Two suites, because Jest cannot see the whole app.**

`npm test` runs on jsdom, which has **no layout engine** —
`getBoundingClientRect()` always returns 0 — and gets compound-selector
specificity wrong. Measured: jsdom reports the dark-mode add button as
`rgb(45,45,45)`; real Chromium reports `rgb(40,167,69)`, because jsdom skips
`body.dark-mode .btn.add-btn` and applies the weaker `body.dark-mode .btn`.
Asking jsdom about the cascade returns *wrong answers for exactly the bugs worth
catching*, so `tests/styles.test.js` reads the stylesheet as text only —
duplicate selectors, dead classes, column widths summing to 100%.

`npm run check:ui` (`scripts/check-ui.js`) launches a real Electron window and
measures. Everything it asserts is something that once shipped broken while all
of Jest was green:

| check | the bug it would have caught |
|---|---|
| border presence matches across themes | icon buttons bordered in dark only |
| add button green in both themes | `body.dark-mode .btn` eating the green |
| add button green **on hover** too | `body.dark-mode .btn:hover:not(:disabled)` eating it, which the resting check missed |
| every coloured button keeps its colour in dark | `body.dark-mode .btn` turning the tag-preset Add button grey |
| header colour differs by theme | `body.dark-mode thead` declared twice, so the light band never applied in dark |
| column widths equal across pages | `table-layout: auto` recomputing per page |
| table height with and without the pager | pager at 34px stealing 10px from the table |
| panel above the sticky header, not clipped | `z-index: 60` under `thead`'s 1000, inside `overflow: hidden` |
| weekday header aligned to the grid | the grid's 1px border offsetting its columns |

Run it after any visual change. It found the last of those on its first run.



- **Framework**: Jest. Tests live in `tests/`.
- **`__mocks__/electron.js`** is a manual mock that Jest applies automatically to any test requiring `main.js`. It records every `ipcMain.handle()` registration so tests can call handlers directly via `__invoke(channel, ...args)`, and makes `app.getPath('userData')` return the directory named by the `TASKTORY_USERDATA` env var — so main-process tests do real file I/O against a temp dir.
- **The timezone is pinned before Node starts, not inside the run.** `npm test` goes through `scripts/run-tests.js`, which spawns Jest with `TZ=Asia/Seoul` in its environment. `tests/setup-timezone.js` now only *verifies* the offset and throws a pointed error if it is wrong.

  It used to assign `process.env.TZ` from `setupFiles`, which is too late: Node caches the zone the first time it touches a date, and Jest has already done so during start-up. On Linux the assignment is simply ignored. Nobody noticed for months because this machine's system timezone is Asia/Seoul, so the setting changed nothing either way — the first CI run on a UTC runner was what exposed it, by failing exactly the two tests that check log files are named by *local* date. A test that silently runs in the wrong zone is worse than one that fails: the local-vs-UTC assertions still pass in UTC while verifying nothing.
- `renderer.js` is a classic browser script with no exports. Tests evaluate the source with `new Function(src + '; return TaskManager;')` rather than adding an export purely for testing. For unit-level tests, build instances with `Object.create(TaskManager.prototype)` to skip the constructor's async `init()`.
- Test files that need a DOM use the `@jest-environment jsdom` docblock; the default environment is `node`.
- **Definition of done**: a bug fix ships with a test that fails before the change and passes after.
- **`tests/ipc-coverage.test.js` fails when a new IPC method has no stub.** The stub list in `renderer-dom.test.js` is not paperwork: a method missing from it means *no test has ever entered the code path that calls it*, because the call would throw `is not a function` the moment one did.

  This is not hypothetical. Drag-and-drop shipped broken because `pathForFile` was absent from the stub — the seven attachment tests all called `addAttachments` directly and none went through a drop, so nothing noticed that a file landing outside the dashed box made Chromium navigate to it. Filling the stub in afterwards immediately exposed a second one: the export test had been passing through the browser-mode fallback, because `readLogFiles` was undefined and the Electron branch it was meant to cover never ran.

  When a feature adds an IPC call, add a test that goes through the real path — the button, the drop, the click — not one that calls the method underneath it. Reaching for the method directly is what leaves the wiring untested, and the wiring is where these bugs live.

## Core Requirements

### 1. Always-on-Top Display
- The application stays on top of all other windows like a sticky note program
- Two separate settings, for two separate problems:
  - Plain `alwaysOnTop: true` — and **only** that, with the minimize button left alone. It was once raised to `setAlwaysOnTop(true, 'screen-saver')`, the level with nothing above it, to try to beat Win+D. It never could (see below), and meanwhile it outranked *everything*: other applications' windows all appeared to sink behind Tasktory, which reads as the whole machine misbehaving. The default level sits above ordinary windows and yields to dialogs, which is what a sticky note needs.
  - **Win+D minimises it, and that is accepted.** Show Desktop minimises windows and stacking order says nothing about it (measured: `minimized=true, visible=false` even at the screen-saver level). `minimizable: false` does make Windows skip it — but taking minimise away from an always-on-top window leaves no way to put it aside at all: it sits over whatever you switch to from the taskbar and cannot be dismissed. Ctrl+M is for shrinking it, not for getting rid of it. Both attempts to beat Win+D cost more than the problem
- **`setOpacity` on blur is not a z-order feature, but it reads like one.** Unfocused opacity is applied on every `blur`; at 0.6 the window fades so far that it looks as if it dropped behind whatever you clicked. Before it was persisted it reset to 1.0 on every launch, so a value set once in passing never survived; persisting it made an old experiment permanent. If someone reports the window "going behind", read the stored `unfocusedOpacity` before touching anything about stacking

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
- One file per day under `<userData>/logs/`, named `YYYY-MM-DD.tsv` by **local** date. Columns: `TIMESTAMP ACTION STATUS TASK_ID START_TIME TARGET_TIME TAGS CONTENT ATTACHMENTS`.
- `TIMESTAMP` carries the UTC offset (`2026-08-04T14:30:00+09:00`) because a log is a permanent record — without it the zone cannot be recovered later, and in DST regions the same wall-clock time occurs twice. `START_TIME`/`TARGET_TIME` deliberately stay zone-less: they express wall-clock intent, not an instant.
- v0.2.5 and earlier wrote `YYYY-MM-DD.log` in a fixed-width format instead (ACTION at characters 25–40). `get-completed-tasks-count` still reads those as a fallback so the daily counter and the 30-day chart keep pre-upgrade history. Do not drop that fallback.
- `add-log` is serialized through a promise queue: the renderer fires it without awaiting, and the header write would otherwise truncate rows a concurrent call had already appended.

## Attachments

**A file is linked, never copied.** `attachments` is an array of
`{ name, path }` on the task, and nothing else is stored — no copy in
`userData`, no id, no size, no hash.

Copying was rejected on one fact: **completing a one-off deletes its row**
(see below). A copied file would then outlive every reference to it, sitting in
`userData` forever with nothing left to say which task it belonged to — and
pruning it would need the very completed-tasks screen the app deliberately does
not have. Linking has no such tail: the row goes, the two strings go with it,
and the user's file was never touched.

The size argument is secondary but real: `tasks.json` is exported whole as the
backup, so a copied 400MB video would be in every backup.

- **The name is stored apart from the path on purpose.** When the link breaks,
  "이 작업에 견적서.xlsx 가 붙어 있었다" is what survives, and that is most of
  what an attachment was for. Deriving the name from the path would still work,
  but storing it says the name is the part meant to outlive the file.
- **Broken links are shown, not hidden.** `check-attachments` returns a
  `path → boolean` map and `renderAttachmentList` marks the dead ones
  `.missing`. The row stays, struck through, with `fileMissing` as its tooltip.
  Removing it is the user's decision.
- The check runs on every `renderAttachmentList` — open, add, remove — and again
  when an open fails, which is the one path that learns the truth from the OS
  rather than a stat. There is no watcher and no timer.
- **Most tasks carry no `attachments` key at all.** `saveTask` spreads it
  conditionally, so an empty list writes nothing. Old rows stay byte-identical,
  and `task.attachments || []` is the read side.
- Dedup is by path, in `addAttachments`. Dropping the same file twice is a
  no-op; two different files with the same name are both kept.
- **`webUtils.getPathForFile(file)`, not `file.path`.** Electron 32 removed the
  latter, so a drop handler reading `file.path` gets `undefined` and silently
  attaches nothing. It lives in `preload.js` as `pathForFile` because `webUtils`
  is not reachable from the renderer.
- **The whole edit form is the drop target, and the document refuses every
  other drop.** A file dropped where Chromium has not been told otherwise makes
  it navigate to that file: the app is replaced by a download error reading
  "Downloads file not found", which is not our string and gives no clue where it
  came from. `document` cancels `dragover` and `drop` unconditionally, and
  `#taskModal` handles them — the dashed box only shows where the file is going.
  Binding the handlers to that box alone is what made a near-miss fatal.
- `shell.openPath` opens, `shell.showItemInFolder` reveals. Both take the raw
  stored path; neither is given anything the user did not choose.
- **No count limit.** Ten rows of attachments is less than the list already
  holds in a single page.
- **The TSV log carries them, full paths and all.** Completing a one-off deletes
  its row, so the log is the only thing left that can say what was attached —
  the very fact the split name/path was meant to preserve. Paths are not
  redacted: the same file already records the task's content and tags, which is
  freer text than a folder name, and a name with no path will not lead anyone
  back to the file. `ATTACHMENTS` is **last** in the row, because
  `completedFromTsv` reads `columns[7]` by position and anything inserted
  earlier would shift every line already on disk. Files written before the
  upgrade keep their 8-column header and read back unchanged.
- **Adding one has to be visible.** The attachment box sits near the bottom of a
  scrolling modal, so a newly linked file renders below the fold and pressing
  *Choose files* looks like it did nothing. `addAttachments` scrolls the new row
  to `block: 'center'` and flashes it once, and the label carries a count
  (`첨부 (2)`) so the number is readable even when the list is not. `'nearest'`
  is not enough — it parks the row flush against the bottom edge, which measures
  as visible and reads as absent.
- **A path is an opaque string, so there is nothing to branch per platform.**
  The OS hands it over (`getPathForFile`, `showOpenDialog`) and the OS takes it
  back (`openPath`, `showItemInFolder`, `fs.access`); nothing in `renderer.js`
  or `preload.js` splits, joins or normalises one. The only path call in the
  app is `path.basename` in `main.js`, which Node already makes
  platform-correct. Separators are deliberately **not** normalised —
  `C:\docs\a.txt` and `C:/docs/a.txt` are two different attachments, because
  rewriting either would be the app claiming to understand a path it does not.
  The two boundaries where a path could be mangled are covered and both are
  automatic: `JSON.stringify` escapes backslashes, and a backslash needs no
  HTML escaping (`escapeHtml` handles `& < > " '`). A test carries a Windows
  and a POSIX path through save and back out of the tooltip to hold this.
  The real cross-platform limit is not a bug: a backup made on Windows carries
  `C:\…` that Linux cannot resolve, and `.missing` shows that honestly.

Testing the drop end-to-end needs `Input.dispatchDragEvent` over CDP, and the
drop zone must be **scrolled into view first** — the modal scrolls, and a
coordinate below the fold dispatches the drag at nothing at all, which looks
exactly like a broken handler.

## Completed tasks

**Completing a one-off removes its row from `tasks.json`.** The row is not kept
with `completed: true`; the TSV log is the history.

The log's `COMPLETE` line already carries `TASK_ID`, `START_TIME`, `TARGET_TIME`,
`TAGS`, `CONTENT` and `ATTACHMENTS` — everything the kept row held. That last
column exists *because* of this rule: without it, completing a one-off would
erase the only record that anything was attached. Nothing ever read the kept
copy: the daily counter, the 30-day chart and the hover list all read the TSV,
and the only three places that touched `t.completed` were carrying the rows along
while reordering the active ones. So it was pure duplication that grew
`tasks.json` and every backup for years and answered no question.

`loadTasks()` drops any completed rows it finds and writes the file back once, so
old data and old backups clean themselves up. The `!t.completed` filters
scattered through the renderer are now belt-and-braces against an imported old
backup; they are cheap, so they stay.

**Recurring rows are the exception** — the row *is* the rule, so completing
advances it instead (see Recurring Tasks). It never leaves the file.

There is deliberately **no un-complete and no pruning job**. Completing already
goes through a confirmation dialog that shows the content, the notes field and
the completion time, so mis-clicks are rare — unlike the one-tap checkbox in
Todoist or Reminders, where undo is essential. Building an undo would mean a
completed-tasks screen, a restore action and an `UNCOMPLETE` log entry for
something that seldom happens and already has a workable fallback (add it again).

## Architecture

This is a complete Electron application with the following structure:

- **main.js**: Main Electron process with always-on-top window configuration and IPC handlers
- **index.html**: Task management interface with table layout and modal forms
- **renderer.js**: Client-side logic for task management and UI interactions (single `TaskManager` class)
- **styles.css**: Compact styling optimized for small window size
- **preload.js**: Security bridge between main and renderer processes
- **package.json**: Node.js project configuration with Electron dependency
- **i18n.js**: every user-facing string, as a top-level `TRANSLATIONS` constant, loaded via `<script>` before `renderer.js`. It used to be a 1,000-line object literal *inside* `getLocalizedText`, rebuilt from scratch on every one of its 170 call sites — 40ms per 10,000 calls, now 1.6ms. Add new strings to all five languages; a missing key falls through to English, then to the key itself
- **recurrence.js**: Pure recurring-task engine, loaded via `<script>` before `renderer.js` (see Recurring Tasks below)
- **manifest.json**, **service-worker.js**, **register-sw.js**: PWA support, so the app installs to a phone home screen and opens offline. Registration is skipped under `file://`, where Electron runs. **`SHELL` in service-worker.js must list every script `index.html` loads** — `i18n.js` was missing after the extraction, which would have left an offline launch with no UI text at all. Bump `CACHE` whenever that list changes, or the old cache survives and serves a shell without the new file
- **There is no separate browser build.** `index.html` *is* the browser build: `isElectron` is false without the preload bridge, and the class falls back to `localStorage`. A `tasktory-standalone.html` used to hold a second, simpler copy of `TaskManager`; it was frozen at v0.1.0 because changes never propagated to it — no calendar, no quick filters, no repeat rules. Verified by loading `index.html` with no preload: adding a task, reloading and finding it still there
- **docs/sync-architecture.md**: design proposal for multi-device sync. Not implemented
- **tests/**, **`__mocks__/`**: Jest suite and the manual `electron` mock (see Testing below)
- **create-icons.js**, **generate-basic-icon.js**, **setup-icons.js**: one-off scripts for generating the app icons in `assets/`
- **assets/**: app icons and icon-generation notes
- **data/**: runtime task/log data written by the app (gitignored)

### Key Features Implemented:
- **Always-on-top window**: BrowserWindow configured with `alwaysOnTop: true`
- **Compact UI**: Table-based interface optimized for a small window (900x900 by default, clamped to the work area so it never opens taller than the screen)
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
- **Calendar view** (`viewMode`, persisted): a month grid, Monday-first, alongside the list. A list answers "what is there", a calendar answers "when does it pile up". The toggle sits with the collapse button in the top-right icons — beside the quick filters it read as one more filter chip — and its icon shows what you *get*, not what you have, the same rule collapse follows. **View-only on purpose** — no selection, no editing, nothing clickable inside a cell; the list does all of that.
- **A task sits on its target day only.** Spanning start-to-target smeared one task across the whole month — the start time is usually just when it was noted, so pushing a deadline back painted every day in between and read as old entries piling up. Tasks with no target fall back to their start day, which is all they have. The chip shows the target time and days sort by it.
- **The grid fits the window; only cells scroll.** `grid-auto-rows: 1fr` with `overflow: hidden` on the grid. Letting the grid itself scroll shifted its columns by the scrollbar width and they no longer lined up with the weekday header. Each `.cal-day-body` scrolls vertically with `scrollbar-gutter: stable`, and `.cal-chip` needs `flex-shrink: 0` — without it flex squeezes the chips flat and the text clips, which reads as a shrinking font rather than an overflow.
- **Collapsed calendar is a mini month grid**, not a list with a date on top — at 150px a grid is the only thing that reads as a calendar. Cells are ~19px, so they hold a number and a coloured underline for the day's most severe status (`worstStatus`); the day's actual items go underneath. Today is a filled circle, the day being listed is a ring — they differ whenever today is clear and the strip has rolled forward. **Dates are clickable here**, the one exception to the view-only rule: the strip has no other way to reach another day. Clicking the same date again returns to automatic.
- The strip shows today, or the next day with work if today is clear, or the most recent past day, so it never goes blank while work remains. It once claimed "All tasks completed" when work simply sat on another day.
- **The collapsed window height is measured, never estimated.** `resizeCollapsedWindow` reads `collapsedMiniLayout.scrollHeight` *after* rendering. Counting rows and multiplying needed its constants re-tuned every time the content changed, and the mini grid broke it immediately — the day's list was pushed off the bottom of the window. `collapsedRowCount()` survives only as a fallback for jsdom, which has no layout.
- Cells are built as an HTML string, so `escapeHtml` is not optional
- **One filter for both expanded views**: `filteredActiveTasks()` is shared by the table and the calendar. Filtering separately meant a search set in one came out differently in the other.
- **The collapsed strip deliberately ignores filters.** All three collapsed paths (`collapsedCalendarDay`, `renderCollapsedMiniGrid`, `renderMiniCollapsedTasks`) read every active task, not `filteredActiveTasks()`. It looks like an oversight and gets reported as one — collapse with a quick filter on and the filtered-out rows reappear. It stays that way on purpose: collapsed there is no way to see that a filter is on, and no way to clear it, so a filter left running would quietly hide work from the one surface whose whole job is to not let you forget. The cost is accepted: the two sizes show different lists
- **Date format**: chosen in settings; the table and the modal share one pattern string, which generates both the output and the parsing regex so they cannot disagree. Storage stays `YYYY-MM-DD HH:mm` whatever the display setting
- **Date/time picker**: our own, because `datetime-local` cannot follow a custom format. It has a confirm button, unlike the native one. **The time sits beside the calendar, not under it** — underneath, the list had to be capped at 104px to stop the popover growing into a column, so it never showed more than four rows at once. Alongside, it gets the calendar's full height. A narrow screen stacks them again.
- **The date field wears its format as a mask.** Empty, it shows `YYYY-MM-DD HH:mm`; each digit overwrites one placeholder character from the left and the separators are stepped over, so `20260821` lands as `2026-08-21 HH:mm` with the caret at the next slot. `maskParts` reads the same `DATE_TOKENS` table that builds the output and the parsing regex — the mask is the third thing generated from one format string, so a new format cannot be supported by two of the three.

  **Typing writes into the slot under the caret; it does not append.** The first version appended to a digit buffer, so a field already holding a full date had nowhere to put the next digit and the key did nothing at all. Selecting the value on focus hid that in testing and not in use — the browser moves the caret after `focus` fires, so clicking into the field with a mouse undoes any `select()`, which is how everyone actually gets there. `maskWrite` and `maskErase` work on slot positions instead, and Backspace, Delete and a full overwrite all fall out of that.

  Every key is taken in `keydown` and cancelled. Left to the browser, a character is *inserted* rather than written and everything after it shifts. The `input` listener stays for paste, where re-deriving from the digits in order is the right answer.

  Blur clears a field nobody typed into, because a target time is allowed to be empty and a bare template cannot be told apart from a value.

  **The unfilled slots are dimmed, which takes a second layer.** An `<input>` cannot colour part of its own value, so `.dtf-ghost` draws the same string at the same place and the input's text goes transparent with `caret-color` keeping the caret. Two things this layer will get wrong if you touch it:

  - **It must not be a flex container.** The gap between two dimmed runs is a text node of one space, and a run of whitespace between flex items is not rendered — `DD HH` prints as `DDHH`. It is `display: block` with `line-height` set to the control height.
  - **Every write to a date field goes through `setDateValue`.** Assigning `.value` fires no event, so the overlay cannot hear it, and a stale overlay over transparent text reads as "the value did not go in". That produced three separate bug reports — fields filled on open, then the dialogs, then the picker — because each was patched where it was found. There is one writer now, and it repaints.
  - **The transparency is applied by the paint, not by the stylesheet.** `color: transparent` in CSS meant any field the overlay had not been painted onto showed nothing at all — and every field whose value is set by code rather than typed was in exactly that state, because assigning `.value` fires no event. Setting it on the last line of `paintGhost` makes the failure mode "not dimmed" instead of "not there".
  - **The slot under the caret is filled, because the caret itself is not enough.** It is drawn — measured at its computed x, the pixels alternate with the blink — but it is one pixel between a dark digit and a grey placeholder. CSS cannot widen a caret, so `.dtf-active` marks the slot the next digit lands in, the way a native date input marks its segment. It repaints on `click`, `keyup` and `select` as well as typing, since all of those move the caret.
  - **Its font is copied from the input at paint time**, property by property, not through the `font` shorthand — the shorthand carries `line-height` and would undo that centring. Declaring the font twice in CSS drifts the moment one side changes, and `font: inherit` was already wrong: it follows the parent, which is 15px against the input's 13px.

- **A rejected date says which part is wrong.** Repeating the format tells nobody anything — it is already in the field, in grey. `describeDateProblem` reports the first real fault: a slot still blank, a value outside its range (with the range), or a day the month does not have. The ranges come from `TOKEN_RANGE`, beside the token table that builds everything else, so a new token cannot get a message that disagrees with its parser.
- **Typing a date can skip the separators.** `parseWithPattern` falls through to `fromDigits`, which strips every non-digit and accepts 8 or 12 of them: `20250821`, `202508210930`, and anything pasted from another format. The chosen pattern is how dates are *shown*, not a contract the typist has to honour — the stored form is `YYYY-MM-DD HH:mm` either way. Nonsense and impossible dates are still refused, and a test that used to demand strict separators now demands the opposite, on purpose
- **The lead time is a judgement, and it belongs to the task.** One number drives both the notification and the "due soon" badge, so they cannot drift apart — but that number now comes from the task, falling back to a default in Settings (`leadFor()`). "One hour before the deadline" is a fact the target column already states; **"start now or you will be late" is something only the person doing the work knows**, and a three-hour report has no business turning red at the same moment as a two-minute email.
- **A task saved already inside its lead window notifies immediately.** `saveTask` calls `checkUpcomingTasks()` after the write; the 30-second sweep alone makes a just-registered task look like notifications are broken.
- **Start at login is owned by the OS, so it is read, never stored.** `localStorage` would drift the moment someone turns it off in Task Manager's startup list, and the dialog would then lie. `refreshStartupToggle()` asks on every open, and `changeOpenAtLogin` draws whatever `setLoginItemSettings` actually accepted rather than what was requested. Electron does not implement this on Linux, so the group hides itself there instead of offering a switch that does nothing.
- **Windows needs `app.setAppUserModelId`.** Without it the OS cannot attribute the toast to an application and drops it silently, so the symptom is "notifications do not work" with nothing in any log. It must match `build.appId` in package.json, which is what the installer's Start Menu shortcut carries.
- **One notification, not two.** It used to fire at 60 and again at 15. Once the moment is the user's to choose, ringing a second time second-guesses that choice — and the badge stays red the whole time anyway, with the overdue notification as the backstop.
- **`0` is a real lead**, meaning "no advance warning", so it must never be filtered out as falsy. Two places nearly broke on this: `leadFor()` uses `Number.isFinite`, and `loadDefaultLead()` checks for a missing key *before* converting, because `Number(null)` is `0` — a plain conversion would have left everyone who never opened Settings with no notifications at all. The suite caught the second one.
- The notification message reports the gap **measured when it fires**, not the window it tripped: a task added with 40 minutes left is already inside a 60-minute window and would otherwise announce "1 hour"
- **Always-on-top applies only while collapsed, and the pin lives in the strip.** It is a state you flip, not a value you configure — opening a dialog to get the window out of your way is backwards.

  **The expanded window is never held on top.** It was, and it read as a fault: expanded there is no pin, so there is no way to see the state or change it, and a 900px window standing over everything with nothing on screen to explain it looks broken rather than configured. `pushAlwaysOnTop()` sends `alwaysOnTop && isCollapsed`, and `toggleCollapse` calls it — so the rule holds without anyone remembering to. What needs to sit over other work is the 150px strip, which is the whole point of the strip.

  **The icon never changes** — that breaks the "show what you get" rule collapse and the view toggle follow, and breaks it deliberately: with those two the question is *what will this do*, but with a pin the question is *is it pinned right now*, so the state has to be the visible thing. It says so by standing up and filling in: pinned is upright and solid blue, unpinned is tipped 45° and hollow. A background tint was tried first and does not work — it only reads next to a button in the other state, which is exactly what you never have on screen.

  The window is created with it on and the renderer pushes the stored value at start-up, the same shape as unfocused opacity — `main.js` keeps neither across launches
- **The Backup and History labels carry their extension** — `백업 (.json)`,
  `이력 (.tsv)`. `setText` already takes a suffix, so this needs no translation:
  a file extension reads the same in every language.
- **Backup lives in Settings, with words on the buttons.** As two unlabelled icons next to Add, people pressed them without knowing what they did — and import cannot be undone. It is used rarely enough that a dialog is the right home
- **Backup and history are separate, and history does not come back in.** Backup is one JSON: export writes it, import replaces everything from it. History is the TSV: export writes the daily logs out as one sheet, and that is all it does.

  They used to share a button — one press dropped a JSON *and* a TSV — and one import that switched behaviour on the file extension, silently doing something completely different for each. A button whose effect you can only learn by reading the filenames afterwards is not a button anyone can use.

  **There is no history import.** A log is what the app writes and a person reads; no program takes one back in. Moving to another machine is a matter of copying `<userData>/logs/`, and the History group has the button that opens it. `parseHistoryTsv` and `importHistoryTsv` are gone with the feature; `buildHistoryTsv` stays for the export.

  `LOG_HEADER` in `renderer.js` must match the header `main.js` writes. It did not after `ATTACHMENTS` was added, and nothing noticed until the export test compared them
- **Double-click a row to edit, and it does nothing to the selection.** The toggle waits `DOUBLE_CLICK_MS` (130ms) to see whether a second click arrives; `dblclick` cancels it. Two earlier attempts were both wrong in ways worth not repeating: letting both clicks toggle relies on an even number cancelling out, but the select-then-deselect is visible; skipping the second click via `e.detail` alone means the first toggle has already happened. Only holding the first click gives "either select, or edit — not both".

  **The wait must not be shorter than the user's own double-click.** 130ms was tried and reported straight back: the toggle fires, the second click undoes it, and although the end state is right, the flash in between is exactly the thing being complained about. Undoing is a safety net for anything slower than the window, not a licence to shrink it. 200ms.

  **The second click is read from `e.detail`, not from the `dblclick` event.** `dblclick` only fires when both clicks land on the *same element*, so anything that re-renders a row between them silently kills it — a real hazard here, since the first toggle can run before the second click arrives. `e.detail` is the browser's own count of consecutive clicks and does not care what happened to the DOM. There is no `dblclick` listener on the table at all. Measured at 30, 120, 190 and 350ms gaps: selection untouched, editor opened once
- **Chips in a row are just part of the row** — clicking one selects it like anything else. They used to jump to a search, but the quick filters do that from a fixed place and hold several at once, so the row version only meant brushing a chip while aiming for the row replaced the whole list. (The repeat cadence lost its one-click filter with it; it is still reachable by picking *Repeat* in the search column.)
- **The `#` column is the order the user arranged**, not a row count — the up/down buttons and the position field write it. Sorting is therefore a *way of looking*, never a change: `sortForDisplay()` runs on the way to the screen, `this.tasks` is untouched, nothing is saved, and a restart comes back unsorted.

  **A column that can be sorted has to say so before it is pressed.** The two time headers carry a stacked pair of hollow triangles at all times, and the whole header — label and glyph — turns blue when a sort is on. An indicator that only appears *after* sorting teaches nobody that sorting exists; a header that changes colour is visible while you are reading the rows underneath it, which is when you want to know what is driving the order.

  **The triangles are drawn with CSS borders, not typed as characters.** `▵▿` and friends are glyphs, so the font decides their shape and weight — they come out neither equilateral nor matched to each other, and no `font-size` fixes that. Two `<i>` elements with `border-left/right: 4px transparent` and a 5px coloured edge are exactly the same isosceles triangle every time.

  That needs real elements in the markup, which means the header label moved into its own `<span>`: `setText('thStartTime', …)` would have wiped the arrows, so it writes to `thStartTimeLabel` instead. Anything that sets a sortable header's text has to keep that split.

  **Sorted shows one triangle, not two, and it sits on the text's centre line.** The earlier version dimmed the unused one, which meant reading the direction off a contrast difference — fine side by side, ambiguous alone. The idle pair says "sortable"; a single triangle says which way.

  Hiding the other with `visibility: hidden` keeps the box but leaves the survivor parked in its own half, riding high or low against the label. `.sort-arrows` carries a fixed `height` instead, so `display: none` costs nothing in layout and `justify-content: center` brings the single triangle to the middle. Measured against the label's centre: 0px in both the idle and sorted states, and the box stays 12px throughout so no column shifts.
- **Sorted rows keep the number they had.** Renumbering 1,2,3 would look like the manual order had been rewritten; numbers reading 2,1,3 are what tell you this is temporary. Clicking a header cycles original → ascending → descending → original, and **reordering is disabled while sorted** — under a sort the neighbour on screen is not the neighbour in the list, so "move up" would send the row somewhere invisible. Tasks with no target time stay at the end in both directions rather than swapping ends, which would read as vanishing.
- **Quick filters are multi-select and independent of the search box.** Several can be on at once — OR within a kind (tag A or B), AND across kinds (overdue *and* tag A). They used to write into the search box, which holds one value, so every second chip undid the first. `All` clears both them and the search. The empty-state message checks the filters too; looking only at `searchQuery` put "All tasks completed!" on a table emptied by a filter.
- **Editing clears the selection; the toggles keep it.** Saving an edit usually changes the status or the date, so the row drops out of whatever filter is on — leaving an invisible row ticked, ready to be swept into the next bulk action. Highlight and notification are the opposite case: undoing one needs a second press, so their selection has to survive.
- **Select-all covers the whole filtered list, not the visible page.** Page-scoped select-all contradicts the word and made deleting 50 rows a five-page chore. The header checkbox reads its state the same way, so paging no longer looks like it cleared the selection.
- **Page size lives beside the pager** (10/20/50/100, remembered) with the total count at the other end of the row. Both belong where the list is, not behind the settings dialog — you change the page size while looking at the list, and "how many are there" is not a question that only matters when paging. All three sit together in the middle of the row — page numbers centred, total count and size select immediately either side. **The row's height must not depend on what is in it.** The pager buttons inherited `--control-height` (34px) while everything else on the row is 24px, so appearing pushed the row from 24px to 34px and took those 10px straight out of the table — every visible row jumped whenever a page count crossed the boundary. The pager is 24px now and the container carries a matching `min-height`. Spread across the full width they read as three unrelated things 880px apart, and with a single page (the usual case) the row was two lone numbers in opposite corners. The pager is `display: none` when there is one page, not `visibility: hidden` — hidden still holds its width and pushed the size select away from the edge.
- **A tag with no `#[COLOR]` gets a colour derived from its name.** They all shared one blue before, so a hand-typed tag and an uncoloured preset were indistinguishable. The hash is over the name, so the same tag is the same colour everywhere and across restarts.
- **Window position is snapshotted before the screen locks, not tracked continuously.** `moved` and `resized` fire for OS-driven moves exactly as they do for user ones, so watching them meant the displaced position immediately became the new "where the user put it" — the restore then had nothing to restore to, and a collapsed window ended up parked in the middle of the screen. `powerMonitor`'s `lock-screen` / `suspend` take the snapshot and set a flag that ignores movement until the restore finishes. `boundsToRestore()` holds the decision and is exported so it can be tested without an Electron runtime.
- **`.drag-bar`** is the only element with `-webkit-app-region: drag`. The frame's title bar is thin under `autoHideMenuBar` and nearly unreachable at 150px. Never put `drag` on anything clickable — it hands that element's mouse events to the window manager.
- **Quick filters** sit directly under the search box, in the same column, and stretch to the same width — placed at the far left of their own row they read as an unrelated button. They do the same job as the table's chips from a fixed place, so you need not hunt for a row carrying the chip you want. Only statuses and tags actually present are listed, capped at `QUICK_FILTER_LIMIT` (15, about two lines) with tags ranked by use; the leftover count is shown rather than silently dropped. Tag chips carry the tag's own colour and keep the table's shapes — pill for tags, square for statuses — so what you learn in the table still reads here. `All` clears the search *and* resets the search column; leaving the column narrowed meant the next word typed was quietly searched in that one column
- **Unfocused opacity** lives in `localStorage` and is pushed to main on every start-up. `main.js` keeps it in a plain variable, so without that it reset to 1.0 on every launch — and it was missing from backups for the same reason
- **Tag System**: Colored tag presets with GitHub-style color schemes
- **Daily completion counter**: Animated counter with confetti celebrations
- **Internationalization**: Support for English, Korean, Chinese, Japanese, Spanish
- **Today's completions on hover.** The daily counter answers "how many" but not "which" — hovering it lists what was finished, read from the log because completed tasks leave the active list and repeating ones move on. `readCompleted()` in main.js backs both the count and the list, so the two cannot disagree.
- **The About dialog carries the notification troubleshooting**, because the app cannot do it. Once `Notification.show()` returns, a banner Windows suppressed is indistinguishable from one it displayed — no error, no callback. Measured on this machine: the registry recorded a toast under `com.tasktory.app` while nothing appeared on screen. So the four places to look (the task's own bell and target time, the notification centre, the per-app banner setting, focus assist) are written down where someone can find them.
- **The About dialog is the manual.** Every feature has to be reachable from it — views, search and filters, repeat rules, statuses, shortcuts. It went stale once (it still described the Actions column and a bell button in the row long after both were removed), which is worse than no help at all. Everything in it is localised — new sections were added in English only at first, which is the same failure in a different disguise. Register new ids in the `aboutText` / `aboutHeadings` maps in `updateUIText`. The version there reads from `app.getVersion()` over the `get-app-version` IPC; it used to be typed into the HTML by hand and sat at 0.6.4 for three releases
- **Search functionality**: real-time filtering, optionally scoped to one column
- **Pagination**: Smart pagination for large task lists

### Wiring lives in one method per screen area

`setupEventListeners` was 329 lines — every listener in the app in one run, so
finding where a control was bound meant reading the whole thing. It is now a list
of `wireToolbar()`, `wireSearchBox()`, `wireModals()`, `wireSelection()`,
`wireListControls()`, `wireDateTimePicker()`, `wireTaskTable()`,
`wireCalendar()`, `wireQuickFilters()`, `wireConfirmDialog()`, `wireSettings()`,
called in the original order. Order matters only where two listeners share an
element and an event, and splitting on verified statement boundaries preserved
it exactly.

Splitting it surfaced a dead delegation: a `click` handler on `#tasksTable`
looking for `.action-btn`, which has not existed in a row since the actions moved
to the bar in 0.6.0.

`updateUIText` was 285 lines of `getElementById` / `if (el)` / assign, repeated
about 80 times. `setText(id, key, suffix)`, `setTitle`, `setPlaceholder` fold each
of those to one line — 161 lines gone, and a new label is now one line instead of
three. They keep silently skipping absent elements, which matters because the
collapsed strip and the modals are not always in the DOM.

### One rule, one place

`styles.css` had `.btn` declared twice, and the later block quietly won. That
single duplication produced two separate bugs: `.icon-btn` and
`.clear-search-btn` both lost the borders they declared, which then reappeared
in dark mode only, where `body.dark-mode .btn` filled the slot back in. Merged
into one block carrying the values that were actually applying.

The same sweep found `.status.completed` declared a second time inside the
dark-mode section **without** `body.dark-mode` — the identical mistake as the
`tbody tr:hover` one, painting the light theme with dark-green badges. Plus a
`body.dark-mode .status.standing` holding light colours and immediately
overridden, and a `li.standing` pair copy-pasted verbatim.

Duplicate selectors in this file are not stylistic untidiness; every one is a
rule silently losing to another somewhere else in the file. A second sweep found
eleven more, and among them the same failure again: `body.dark-mode thead` was
declared twice, so the lighter header from 0.8.6 had never once applied in dark
mode. `.color-example`'s eight colours were shadowed by a later block, and every
`.action-btn` / `.edit-btn` / `.highlight-btn` rule was styling classes that
stopped existing when the row buttons moved to the bar. The file is down to zero
duplicate selectors and zero unreferenced classes; keep it there.

The same audit is worth re-running after any sweep, because "I removed the dead
code" has been wrong here more than once:

```
중복 선택자        styles.css 안에서 같은 선택자가 두 번 이상 (미디어쿼리 제외)
죽은 CSS 클래스    index.html / renderer.js 어디에도 없는 클래스
죽은 번역 키       TRANSLATIONS 에 있으나 아무데서도 안 불리는 키
번역 키 일치       다섯 언어의 키 집합이 동일한가
HTML id 참조       renderer 가 찾는 id 가 실제로 있는가
패키지 내용물      npx asar list — build.files 는 allowlist다
```

CSS escapes do not survive the heredoc: `content: '\2191'` arrived as a single
backslash and Python read `` as an octal escape, printing a control character
in the header. Write the character itself (`↑`).

Beware false positives when writing these: classes built by template string
(`quick-${kind}`), keys looked up through a variable (`optionKeys[freq]`), and
ids that only appear as bare object keys in the `aboutText` maps all look dead
to a naive grep.

### The completed-today panel opens on movement, not on arrival

Hovering is what was asked for and hovering is what it does — but it waits for a
`mousemove` inside the counter, not merely a `mouseenter`.

That one distinction is the whole bug. Leaving the strip recentres the window and
restoring un-minimises it, both while the pointer sits still; the counter slides
under the cursor and the browser raises `mouseenter`. `mousemove` needs actual
movement, so it separates "I pointed at this" from "it slid under my hand". The
panel used to open by itself in both cases, and since `mouseenter` had fired
without a fresh fetch it showed the previous contents.

Closing waits ~220ms after `mouseleave`, cancelled by a re-entry: the panel sits
6px below the counter and that gap belongs to neither element, so closing on the
spot made the list impossible to reach and scroll. The open state is the
`.is-open` class; the stylesheet only reacts to it. It also closes on
`toggleCollapse`, `toggleViewMode`, `window` blur and `visibilitychange` —
minimising never moves the pointer, so `mouseleave` would not fire on its own.

### A popover has to leave the table's world

The completed-today list hangs off the counter, which lives inside `main` — and
`main` is `overflow: hidden` so the table can scroll inside it. An absolutely
positioned popover there is clipped at the table's edge, and the table's sticky
`thead` carries `z-index: 1000`, so even the unclipped part paints underneath.

It is `position: fixed` with `z-index: 1200`, and `placeCompletedList()` sets its
coordinates from the counter's rect when the pointer arrives — before the async
fill, so it never flashes at the previous position.

### The table must not resize as you page

Two independent causes made the header and cells shift every time you turned a
page, and both are fixed in place:

- **`table-layout: fixed`.** The `th` percentages are only a suggestion under the
  default `auto`, which recomputes every column from the text actually in it. A
  page of long task names produced different columns than a page of short ones.
  The declared widths must keep summing to exactly 100%, and `td` carries
  `overflow-wrap: break-word` because a fixed column no longer stretches for an
  unbreakable string.
- **`scrollbar-gutter: stable` on `.table-container`.** A full page has a
  vertical scrollbar and the last page usually does not, so the table grew by the
  scrollbar's 19px and dragged every column with it.

Measured before: page 1 `[33,41,124,124,107,297,99]` at 825px wide, page 2
`[34,42,126,126,109,303,101]` at 842px. Both are identical now.

### Visual weight

A pass in 0.8.6 took weight off everything that is not the task list, because
several elements were competing with it:

- **The table header** was a dark navy slab (`#2c3e50`) with white text — the
  heaviest thing on screen, above the content you actually read. It is a light
  band with a hairline rule now.
- **Vertical cell dividers** are gone. Zebra striping already separates rows, so
  a line between every column only built a cage around the text.
- **Status badges** carry `white-space: nowrap`. "In Progress" wrapped to two
  lines, and that one row grew taller than the rest, so the table looked ragged.
- **The completion counter** was a large bordered pill with a shadow, making
  "how many did I finish" the loudest element on the page. It is a quiet chip on
  the same baseline as the search row.
- **The action bar** dropped its grey panel. Nothing is selected most of the
  time, so an empty box sat above the table doing nothing; it keeps its height
  so the table still does not shift when a selection appears.

Anything hardcoded here needs a matching `body.dark-mode` rule. The counter used
`var(--bg-tertiary)` and followed the theme for free; replacing that with a
literal left a white box sitting on the dark background.

### Buttons take the background they sit on

Icon buttons and the pager paint no background of their own; the tint appears on
hover. `.icon-btn` used `#f8f9fa` against a `#f5f5f5` page — three units apart,
which is not a colour difference so much as a visible seam around each square.
The pager was worse: white boxes on grey. The only exceptions are the **add
button**, which stays solid green in both themes because it is the one primary
action, and the **current page number**, which fills so you can see where you are.

Text fields keep their chrome (`.search-input`, both selects) — the split is
fields have a border, buttons do not.

Watch the cascade here. `.btn.icon-btn` outranks `.add-btn`, so the transparent
background silently swallowed the green until `.btn.icon-btn.add-btn` restated
it; in dark, `body.dark-mode .btn` had already been doing the same thing for
some time, leaving the add button indistinguishable from the icons beside it.

The same thing happened again on **hover**, and it took a bug report because
`check:ui` only measured the resting state. `body.dark-mode .btn:hover:not(:disabled)`
sits far below the add-button exception and ties it on specificity — `:not()`
contributes its argument, so both are (0,4,1) — so source order decided, and in
dark the green turned grey the moment the pointer arrived. The fix is a fourth
class (`body.dark-mode .btn.icon-btn.add-btn:hover`), which wins on specificity
and no longer depends on where in the file it sits.

**A coloured button loses its colour in dark unless it out-ranks `body.dark-mode .btn`.** This has now happened three times — the add button's background, the add button's hover, and the tag-preset Add button, which `.tag-preset-add button` (0,1,1) could not defend against `body.dark-mode .btn` (0,2,1). The check no longer tests one button: `COLOURED` in `check-ui.js` lists them and compares both themes. Add to that list whenever a button gets a colour of its own.

**Never write a concrete `display` from JavaScript to show something.** Hiding
is a decision the code makes, so `display: none` is fine; showing is the
stylesheet's business, and `''` is how you hand it back. `showAboutModal` set
`display: inline-flex` on the log-folder button, from when that button lived
inside About. The button moved to Settings and the line stayed, so opening the
help once turned it into a flex container and its label rode 9px higher than
the button beside it — for the rest of the session, on a screen the help does
not own. It looked like a dark-mode bug because that is what the person happened
to be in at the time.

**`check:ui` needs `show: true`.** A hidden window never applies `:hover`, and
`CSS.forcePseudoState` over CDP did not reach `getComputedStyle` either — both
were tried, and both silently reported the resting colour, which looks exactly
like a passing test.

### Light and dark must not diverge structurally

Colours differ between the themes; **whether a border exists must not**. Three
places had drifted, and all three came from the same root:

- `.btn` is declared **twice** (once around line 1089, again around 2027). The
  second wins for anything it sets, including `border: 1px solid transparent`,
  which quietly overrode `.icon-btn`'s own border. In light that left no visible
  edge; in dark `body.dark-mode .btn` filled the same slot with `#555`, so the
  identical button had a box in one theme and not the other.
- `.clear-search-btn` said `border: none`, lost to that same duplicate `.btn`,
  and got `none` back only under `body.dark-mode`.
- `.task-action-bar` lost its panel in the light pass but kept
  `body.dark-mode .task-action-bar`, so dark still drew a grey box.

Fixes use `.btn.icon-btn` / `.btn.clear-search-btn` to outrank the duplicate
rather than merging the two `.btn` blocks, which many other buttons depend on.

**When you change a themed rule, change both sides.** The trap is one-sided
edits: removing a light panel, or replacing a `var(--…)` with a literal, works
on screen while silently stranding the other theme. `scratchpad/audit.js` walks
a list of selectors in both themes and reports any element whose border presence
differs — cheap to re-run after visual work.

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