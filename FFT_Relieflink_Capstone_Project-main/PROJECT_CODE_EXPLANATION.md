# ReliefLink India — Code and Project Explanation

This guide explains the project in beginner-friendly language. Keep it open beside VS Code while studying the source files.

## 1. What the project does

ReliefLink India is an educational disaster-relief coordination web application. It brings together disaster incident reports, resource needs, donor offers, donation pledges, beneficiary requests, NGO profiles, and user profiles in one interface. It supports demo workspaces for Administrator, NGO partner, Shelter manager, Donor, Volunteer, and Person in need.

This is a demonstration project, not a production emergency-response system. The role selector is not secure authentication and must not be used to protect real personal or emergency data without adding server-side authentication, authorization, validation, and security controls.

## 2. Technologies used

- **HTML (`public/index.html`)**: the page structure and UI containers.
- **CSS (`public/styles.css`, `public/dashboard.css`)**: layout, colors, responsive behavior, cards, buttons, animation and hover effects.
- **Browser JavaScript (`public/app.js`)**: handles page navigation, rendering, forms, filters, role-specific views, and requests to the backend.
- **Node.js (`server.js`)**: runs JavaScript on the server.
- **Express (`server.js`)**: serves the frontend and exposes HTTP API endpoints.
- **MongoDB driver (`mongodb`)**: required database connection, configured with `MONGODB_URI` in `.env`.

## 3. Folder and file guide

### `public/index.html`
The main HTML page. It loads the stylesheets and frontend script and provides the root containers that JavaScript fills with screens and dashboards. HTML tags describe the content; `id` attributes let JavaScript find elements; `class` attributes let CSS style groups of elements.

### `public/styles.css`
The main visual design. CSS rules use a selector followed by declarations. For example, `.card { padding: 16px; }` means elements with class `card` receive 16 pixels of inner spacing. `:hover` rules apply when the pointer is over an element; `transition` makes changes animate smoothly; media queries adjust the layout for smaller screens.

### `public/dashboard.css`
Additional styles used by dashboard components. It is separated from the main stylesheet so dashboard-specific rules are easier to find and update.

### `public/app.js`
The frontend logic. Main areas:
- Constants such as `CATEGORIES`, `INCIDENT_TYPES`, `ROLES`, and `EMPTY_STATE` hold shared lists and the initial empty data structure.
- Helper functions such as `$()` and `$$()` find one or multiple HTML elements; `esc()` escapes special HTML characters before user-provided text is inserted into markup; `fmtDate()` formats dates; `showToast()` displays a temporary message.
- `loadState()` retrieves saved workspace data from the API.
- `saveState()` sends updated data to the backend.
- `refreshWorkspace()` refreshes data used by the interface.
- `ROLE_PAGES` and related helpers decide which navigation items and records a demo role sees. These frontend checks are for the demonstration only, not real security.
- `renderPage()` and functions such as `renderOverview()`, `renderIncidents()`, and `renderNeeds()` build the screen shown to the user.
- Event handlers respond to clicks, form submissions, filters, verification actions, and other interactions.

### `server.js`
The backend entry point. Main areas:
- Imports Express, MongoDB, and Node.js file/path utilities.
- Reads environment configuration, requires `MONGODB_URI`, and connects to MongoDB before starting the server.
- `cleanState()` validates the application workspace; MongoDB functions read and store it.
- `GET /api/health` reports that MongoDB is the active storage backend.
- `GET /api/sources` returns information about the listed sources; it does not mean live government feeds are connected.
- `GET /api/state` returns the current application data.
- `PUT /api/state` accepts updated application data and saves it.
- The final server setup serves files from `public` and listens on the configured port.

### `.env.example`
Example MongoDB environment configuration. Copy it to `.env` and use the local MongoDB URI or set an Atlas connection string. Keep real connection strings private and never commit them to source control.

### `package.json` and `package-lock.json`
`package.json` lists dependencies and scripts. `npm start` starts the server; `npm run dev` starts it in Node's watch mode. `package-lock.json` pins dependency versions for more repeatable installation.

### `.gitignore`
Lists files Git should normally not track, such as environment secrets and generated/runtime files.

## 4. How data moves through the application

1. A user fills out a form or clicks an action in the browser.
2. `app.js` handles the event and updates the in-memory workspace state.
3. The frontend sends an HTTP request to the Express API, usually `PUT /api/state` when saving.
4. `server.js` receives the request and writes the data to MongoDB.
5. When data is needed again, the frontend calls `GET /api/state` and renders the returned records.

In short: **HTML displays the page → CSS styles it → frontend JavaScript handles interaction → Express/Node.js processes API requests → MongoDB stores data.**

## 5. Run it on Windows

1. Install Node.js **22.5 or newer**.
2. Extract the ZIP and open the project folder in VS Code.
3. Open **Terminal → New Terminal**.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:4000` in your browser.
7. Keep the terminal running while you use the site. Stop the server with `Ctrl+C`.

If port 4000 is busy, set a different `PORT` in `.env` and use that port in the browser.

## 6. Understand common JavaScript syntax

```js
const message = 'Hello';
```
`const` declares a variable that should not be reassigned.

```js
function add(a, b) {
    return a + b;
}
```
A function groups reusable instructions. `return` sends a result back to the caller.

```js
if (currentUser) {
    console.log('A demo user is selected');
}
```
`if` runs its block only when its condition is true.

```js
const response = await fetch('/api/state');
const data = await response.json();
```
`fetch()` sends an HTTP request. `await` waits for an asynchronous result. `.json()` reads a JSON response body.

```js
app.get('/api/health', (req, res) => {
    res.json({ ok: true });
});
```
This Express route responds to a GET request with JSON. `req` represents the incoming request and `res` is used to send the response.

## 7. Viva explanation (short answer)

“ReliefLink India is a disaster-relief coordination web application. I used HTML to structure the interface, CSS for styling and responsive design, and JavaScript for interactive dashboards and forms. Node.js and Express provide the backend API, and MongoDB stores incidents, resource needs, donor offers, pledges and profiles. The frontend sends API requests to the backend to retrieve and save that data. This version is an educational prototype; production use would require secure login, server-side role permissions, stronger validation and operational verification.”

## 8. Important limitations to know

- Demo role selection is not equivalent to secure login.
- UI role checks do not replace backend authorization.
- A list of official sources does not mean the app has a live data integration with those sources.
- Do not put real passwords, personal identity documents, or sensitive emergency details into this demo.
- Before making changes, keep a backup of the project folder and database.
