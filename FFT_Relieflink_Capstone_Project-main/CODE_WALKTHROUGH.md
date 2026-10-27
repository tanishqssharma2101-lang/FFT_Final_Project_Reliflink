# Code walkthrough: where to start

This is a guided reading order for the source. The full application has many lines, so learn it in sections rather than trying to memorize it all at once.

## A. Start with `public/index.html`
1. Read the `<head>` section: it contains metadata, the page title, and links to CSS files.
2. Find stylesheet `<link>` elements: they connect the HTML to the design rules.
3. Find the script element for `app.js`: it loads the browser-side JavaScript.
4. Look at element `id` values: JavaScript uses them to locate containers, buttons, and form fields.

## B. Then read `public/styles.css`
1. Find global rules such as `:root`, `body`, and universal selectors.
2. Find layout rules for the sidebar, main content, panels, cards, forms, and tables.
3. Search for `:hover` to see pointer interactions.
4. Search for `transition`, `@keyframes`, and `@media` to learn about motion and responsive layout.

## C. Then read `public/dashboard.css`
This file contains dashboard-oriented styling. Follow the same pattern: selector first, then the properties that control appearance.

## D. Read `public/app.js` in this order
1. **Shared constants:** `CATEGORIES`, `INCIDENT_TYPES`, `ROLES`, `EMPTY_STATE`.
2. **DOM helpers:** `$` and `$$` select HTML elements.
3. **Formatting/safety helpers:** `esc`, `fmtDate`, `fmtDateTime`, `badge`, `showToast`.
4. **API/state functions:** `loadState`, `saveState`, `refreshWorkspace`.
5. **Role and visibility helpers:** `ROLE_PAGES`, `canOpenPage`, `visibleIncidents`, `visibleNeeds` and related functions.
6. **UI rendering:** `renderPage`, `renderOverview`, role dashboards, `renderIncidents`, `renderNeeds`, and other `render...` functions.
7. **Actions and event listeners:** search for `addEventListener`, `data-action`, and form submission handlers.

Useful searches in VS Code: `Ctrl+F` searches the current file; `Ctrl+Shift+F` searches all project files.

## E. Read `server.js` in this order
1. Imports, environment setup, and the required MongoDB connection.
2. State validation, reading, and writing functions.
3. MongoDB storage and synchronization functions.
4. Express API routes: `/api/health`, `/api/sources`, `/api/state`.
5. Static-file hosting and the `listen()` call near the end.

## F. Example: following a saved change
When a form changes the application data, frontend JavaScript handles the form event, updates the local state object, and calls the save routine. The save routine sends the state to Express. The server receives it through the API route and persists it in the configured database. When the interface refreshes, it requests the current state and re-renders the relevant page.

## G. Beginner practice tasks
1. Change a heading in `index.html`, restart/refresh, and observe the result.
2. Change a CSS padding value and observe how spacing changes.
3. Find `showToast()` in `app.js` and trace where it is called.
4. Find `/api/health` in `server.js` and visit `http://localhost:4000/api/health` while the server is running.
5. Add a test incident using demo data and observe how it appears after a refresh.

Do not edit multiple files at once while learning. Make one small change, test it, and keep a known-good backup.
