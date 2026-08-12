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

`npm start` is the human path. To look at the UI from here, the scratchpad holds
throwaway Electron scripts (`shoot.js`, `audit.js`, `themes.js`…) that load
`index.html`, seed `taskManager` over `executeJavaScript`, and `capturePage()`.

**Every one of them must call `app.setPath('userData', …)` before `ready`.**
They run the real renderer, so anything that reaches `saveTasks` writes the
user's actual `tasks.json`. One of these scripts called `saveTask()` against the
live directory; it happened to fail form validation, but had it passed it would
have replaced the task list with test data.

Two other traps: seed *after* `init()` has finished its async `loadTasks`, or the
seed is silently overwritten (~3s is enough); and the first `capturePage()` often
returns an empty buffer, so retry until the PNG has real length.

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
- `alwaysOnTop: true` alone is not enough — Win+D (show desktop) and full-screen apps still bury it. `setAlwaysOnTop(true, 'screen-saver')` raises it to the top level, which survives both. It changes only stacking order, never size or position

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

## Completed tasks

**Completing a one-off removes its row from `tasks.json`.** The row is not kept
with `completed: true`; the TSV log is the history.

The log's `COMPLETE` line already carries `TASK_ID`, `START_TIME`, `TARGET_TIME`,
`TAGS` and `CONTENT` — everything the kept row held. Nothing ever read the kept
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
- **Calendar view** (`viewMode`, persisted): a month grid, Monday-first, alongside the list. A list answers "what is there", a calendar answers "when does it pile up". The toggle sits with the collapse button in the top-right icons — beside the quick filters it read as one more filter chip — and its icon shows what you *get*, not what you have, the same rule collapse follows. **View-only on purpose** — no selection, no editing, nothing clickable inside a cell; the list does all of that.
- **A task sits on its target day only.** Spanning start-to-target smeared one task across the whole month — the start time is usually just when it was noted, so pushing a deadline back painted every day in between and read as old entries piling up. Tasks with no target fall back to their start day, which is all they have. The chip shows the target time and days sort by it.
- **The grid fits the window; only cells scroll.** `grid-auto-rows: 1fr` with `overflow: hidden` on the grid. Letting the grid itself scroll shifted its columns by the scrollbar width and they no longer lined up with the weekday header. Each `.cal-day-body` scrolls vertically with `scrollbar-gutter: stable`, and `.cal-chip` needs `flex-shrink: 0` — without it flex squeezes the chips flat and the text clips, which reads as a shrinking font rather than an overflow.
- **Collapsed calendar is a mini month grid**, not a list with a date on top — at 150px a grid is the only thing that reads as a calendar. Cells are ~19px, so they hold a number and a coloured underline for the day's most severe status (`worstStatus`); the day's actual items go underneath. Today is a filled circle, the day being listed is a ring — they differ whenever today is clear and the strip has rolled forward. **Dates are clickable here**, the one exception to the view-only rule: the strip has no other way to reach another day. Clicking the same date again returns to automatic.
- The strip shows today, or the next day with work if today is clear, or the most recent past day, so it never goes blank while work remains. It once claimed "All tasks completed" when work simply sat on another day.
- **The collapsed window height is measured, never estimated.** `resizeCollapsedWindow` reads `collapsedMiniLayout.scrollHeight` *after* rendering. Counting rows and multiplying needed its constants re-tuned every time the content changed, and the mini grid broke it immediately — the day's list was pushed off the bottom of the window. `collapsedRowCount()` survives only as a fallback for jsdom, which has no layout.
- Cells are built as an HTML string, so `escapeHtml` is not optional
- **One filter for both views**: `filteredActiveTasks()` is shared. Filtering separately meant a search set in one view came out differently in the other
- **Date format**: chosen in settings; the table and the modal share one pattern string, which generates both the output and the parsing regex so they cannot disagree. Storage stays `YYYY-MM-DD HH:mm` whatever the display setting
- **Date/time picker**: our own, because `datetime-local` cannot follow a custom format. It has a confirm button, unlike the native one
- **Reminders**: one `LEAD_MINUTES` list drives both the notifications and the "due soon" badge, so they cannot drift apart. Not user-configurable — the earlier settings and per-task fields were removed as unnecessary
- **Chips in a row are just part of the row** — clicking one selects it like anything else. They used to jump to a search, but the quick filters do that from a fixed place and hold several at once, so the row version only meant brushing a chip while aiming for the row replaced the whole list. (The repeat cadence lost its one-click filter with it; it is still reachable by picking *Repeat* in the search column.)
- **Quick filters are multi-select and independent of the search box.** Several can be on at once — OR within a kind (tag A or B), AND across kinds (overdue *and* tag A). They used to write into the search box, which holds one value, so every second chip undid the first. `All` clears both them and the search. The empty-state message checks the filters too; looking only at `searchQuery` put "All tasks completed!" on a table emptied by a filter.
- **Editing clears the selection; the toggles keep it.** Saving an edit usually changes the status or the date, so the row drops out of whatever filter is on — leaving an invisible row ticked, ready to be swept into the next bulk action. Highlight and notification are the opposite case: undoing one needs a second press, so their selection has to survive.
- **Select-all covers the whole filtered list, not the visible page.** Page-scoped select-all contradicts the word and made deleting 50 rows a five-page chore. The header checkbox reads its state the same way, so paging no longer looks like it cleared the selection.
- **Page size lives beside the pager** (10/20/50/100, remembered) with the total count at the other end of the row. Both belong where the list is, not behind the settings dialog — you change the page size while looking at the list, and "how many are there" is not a question that only matters when paging. All three sit together in the middle of the row — page numbers centred, total count and size select immediately either side. **The row's height must not depend on what is in it.** The pager buttons inherited `--control-height` (34px) while everything else on the row is 24px, so appearing pushed the row from 24px to 34px and took those 10px straight out of the table — every visible row jumped whenever a page count crossed the boundary. The pager is 24px now and the container carries a matching `min-height`. Spread across the full width they read as three unrelated things 880px apart, and with a single page (the usual case) the row was two lone numbers in opposite corners. The pager is `display: none` when there is one page, not `visibility: hidden` — hidden still holds its width and pushed the size select away from the edge.
- **A tag with no `#[COLOR]` gets a colour derived from its name.** They all shared one blue before, so a hand-typed tag and an uncoloured preset were indistinguishable. The hash is over the name, so the same tag is the same colour everywhere and across restarts.
- **`.drag-bar`** is the only element with `-webkit-app-region: drag`. The frame's title bar is thin under `autoHideMenuBar` and nearly unreachable at 150px. Never put `drag` on anything clickable — it hands that element's mouse events to the window manager.
- **Quick filters** sit directly under the search box, in the same column, and stretch to the same width — placed at the far left of their own row they read as an unrelated button. They do the same job as the table's chips from a fixed place, so you need not hunt for a row carrying the chip you want. Only statuses and tags actually present are listed, capped at `QUICK_FILTER_LIMIT` (15, about two lines) with tags ranked by use; the leftover count is shown rather than silently dropped. Tag chips carry the tag's own colour and keep the table's shapes — pill for tags, square for statuses — so what you learn in the table still reads here. `All` clears the search *and* resets the search column; leaving the column narrowed meant the next word typed was quietly searched in that one column
- **Unfocused opacity** lives in `localStorage` and is pushed to main on every start-up. `main.js` keeps it in a plain variable, so without that it reset to 1.0 on every launch — and it was missing from backups for the same reason
- **Tag System**: Colored tag presets with GitHub-style color schemes
- **Daily completion counter**: Animated counter with confetti celebrations
- **Internationalization**: Support for English, Korean, Chinese, Japanese, Spanish
- **Today's completions on hover.** The daily counter answers "how many" but not "which" — hovering it lists what was finished, read from the log because completed tasks leave the active list and repeating ones move on. `readCompleted()` in main.js backs both the count and the list, so the two cannot disagree.
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
rule silently losing to another somewhere else in the file.

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