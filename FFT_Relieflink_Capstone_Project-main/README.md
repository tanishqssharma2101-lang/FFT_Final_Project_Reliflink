# ReliefLink India — HTML, CSS, JavaScript + Node.js

This version is rewritten without React, TypeScript, Vite or JSX. The frontend uses plain HTML, CSS and browser JavaScript. The backend uses Node.js and Express.

## Features
- Separate workspace entry screen with administrator, NGO partner, shelter manager, donor, volunteer and beneficiary dashboards/workflows
- Dedicated role-specific profile dashboards for administrators and NGO/shelter accounts, with their own workspace metrics and relevant shortcuts
- Editable personal profiles save phone and location details, plus an optional organisation/shelter name, in the active workspace database
- Disaster incident reports with evidence attachment and administrator review
- Resource requests linked to verified incidents, with separate evidence and review
- Donor offers and matching against verified open needs
- Pledges and delivery status tracking
- Individual assistance requests
- Proof & verification portal with NDMA, NRSC/ISRO NDEM, IMD, SACHET, NGO Darpan and data.gov.in reference portals
- Separate disaster and item-specific evidence, official source URLs, reviewer notes and review dates
- Google Maps location-search links for incident and aid locations (the embedded needs map continues to use OpenStreetMap)
- Needs map using Leaflet and OpenStreetMap tiles (internet required)
- JSON workspace backup import/export and CSV exports for Excel/Power BI
- Node.js API persists records in MongoDB
- Email/password account registration and sign-in, with salted password hashes and server-managed sessions
- Every role collects a verification ID at registration and saves it in the shared `userProfiles` collection
- Submitted incidents, resource needs, donor offers, pledges and individual requests retain the submitting account's verification ID; administrator review decisions retain the reviewer's ID
- Each submission appears in the shared dashboard and all active sessions refresh from the API every five seconds
- New record changes are synchronized by ID so concurrent NGO and donor submissions do not replace another user's newer records
- The database starts empty; dashboard records come from actual form/API submissions rather than fabricated emergency examples

## Requirements
- Node.js 22.5 or newer (uses Node's built-in `.env` loader)
- npm
- Internet connection for Google Fonts and map tiles (core UI/API runs locally)

## Run locally on Windows / VS Code
1. Extract the ZIP.
2. Open the extracted `relieflink-html-node` folder in VS Code.
3. Open Terminal → New Terminal.
4. Run `npm install`.
5. Copy `.env.example` to `.env` beside `server.js`. The example file is only a template and is never loaded automatically. Set `MONGODB_URI` to your local MongoDB or Atlas connection string and set a private `ADMIN_SIGNUP_CODE` if administrator registration is needed. Keep `.env` private; do not commit it or paste credentials into chat.
6. Run `npm start` (or `npm run dev`). The server requires MongoDB and will not start if the connection URL is missing or MongoDB is unreachable. The terminal confirms the database name after a successful connection.
7. Open `http://localhost:4000` in your browser.

The login and dashboards are served by the same Node.js process. There is no separate Vite server. API health check: `http://localhost:4000/api/health`; current workspace data: `http://localhost:4000/api/state`; official source catalog: `http://localhost:4000/api/sources`. The health endpoint reports MongoDB as the active database. The web app refreshes workspace records every five seconds. `PATCH /api/state` synchronizes changes by record; `PUT /api/state` intentionally replaces the whole workspace for backup restore.

If the dashboard cannot load, verify the MongoDB connection message in the terminal and open `http://localhost:4000` (not the HTML file or a separate Live Server port). An empty requests panel means no NGO requests have been submitted to the database; official portal links are references and do not import live records.

## Deploy to Netlify
This project includes a Netlify Functions adapter for the Express API. Netlify serves the static files from `public/` and rewrites `/api/*` requests to the function. MongoDB must be reachable by the deployed function.

1. Push this project to a GitHub repository. Do not add `.env`, MongoDB credentials, or invitation codes to Git.
2. In Netlify, choose **Add new site → Import an existing project**, select the repository, and deploy using the included `netlify.toml` settings.
3. In the Netlify site's **Environment variables**, add `MONGODB_URI` (your MongoDB Atlas connection string), `MONGODB_DB_NAME` (for example, `relieflink`), and a private `ADMIN_SIGNUP_CODE` of your choice. Set them for the deploy contexts you use, then trigger a new deploy. Do not use the example value as an invitation code.
4. Set MongoDB Atlas Network Access so Netlify Functions can connect. Netlify Functions do not have a fixed outbound IP on standard plans; allowing `0.0.0.0/0` makes the cluster reachable from any IP and is not recommended for sensitive/production data. Prefer a hosting/network setup with restricted egress, and always use a dedicated database user with a strong password and least-privilege access.
5. Open the Netlify site. Create a regular account using **Create account**. Administrator registration additionally requires the exact `ADMIN_SIGNUP_CODE` configured in Netlify. A code entered into `.env.example` is not used by either local Node.js or Netlify.

The Netlify API health check is `<your-site-url>/api/health`. If environment variables are changed, redeploy so new function instances receive them. Netlify Functions have execution and payload limits; this prototype's workspace API accepts uploads up to 12 MB at the Express JSON parser, so large evidence/backup uploads may exceed hosting limits.

## Important workflow
1. Create an account with an available role and sign in using its email and password. Administrator registration requires the invitation code configured by the system owner.
2. Create a disaster report and attach evidence; it starts as Pending review.
3. Review it and add a reason before marking Verified or Rejected.
4. Sign in as NGO partner (or Shelter manager), using the same email address on each device/session for that organisation's dashboard, and submit a resource request linked to a verified incident with separate evidence of the exact need.
5. Administrator reviews that resource request separately.
6. Sign in as Donor and publish an offer. Match it only to verified open needs.
7. Record a pledge and update delivery status after confirming the handover.
8. Keep the NGO dashboard open to see new requests, pledges and received quantities synchronize from the shared MongoDB database.

Each form submission is saved to the shared MongoDB database; the administrator's incoming-request panel and the submitting NGO's dashboard refresh automatically while open. No public sample emergencies are seeded. New submissions made directly by an administrator appear in the review queues like other records.

## Data
Workspace records are stored in MongoDB only. JSON import in the UI replaces the active workspace. JSON export is a portable backup; CSV exports are for analysis and cannot restore the workspace. Existing local SQLite files are no longer read or written.

Every account requires an email address, a password of at least 12 characters, and a verification ID at registration. IDs are saved in `userProfiles`; NGO IDs are also retained in the legacy-compatible `ngoProfiles` collection and copied onto resource requests for administrator review. IDs remain user-provided and unverified; they are not proof of registration.

## Prototype and safety limitations
- Passwords are salted and hashed on the server; browser sessions use HTTP-only cookies. Administrator signup requires the private `ADMIN_SIGNUP_CODE`. Verification IDs are user-provided and are not checked against NGO Darpan or any other registry.
- The API requires a signed-in session, but role-specific access controls and per-record API filtering are not implemented; signed-in users can still access shared workspace records. Do not use this prototype for sensitive personal data or actual relief distribution. A public deployment also requires server-side authorization, database transactions, audit logs, private evidence storage, file scanning, rate limiting, backups and validation.
- Evidence upload is limited to 1 MB per file in the browser demo and stores evidence as a data URL in MongoDB. Avoid sensitive personal information.
- The source directory links to official portals but does not scrape or query government/NGO systems. data.gov.in API use requires a registered API key and selected dataset; Google Maps search links need no key, but map tiles are not Google Maps.
- NGO Darpan IDs and uploaded/source-linked evidence are not automatically authenticated. Administrators must verify the NGO registration and incident directly with the official source and record their decision and review note.
- A file upload does not prove a disaster occurred. Verify with official disaster-management authorities, district/state updates, IMD, police/fire services, and trusted local organisations. Review every exact resource need separately.
- Sample/illustrative data must not be represented as a real verified emergency.


## Role-specific workspaces (updated)
The left navigation and overview dashboard now change by demo role. The underlying relief coordination records remain in one shared database on purpose, but the UI displays role-relevant records:
- **Administrator:** all queues, verification decisions, all pledges/requests, and data import/export.
- **NGO partner:** its own submitted needs/incidents and pledges linked to its needs, plus verified public needs and verified public incidents.
- **Shelter manager:** NGO workflow plus approved/fulfilled individual requests for fulfilment.
- **Donor:** its own offers and pledges; only verified open resource needs are available for matching.
- **Volunteer:** verified public incidents and verified open needs; volunteer assignment/scheduling is not implemented.
- **Person in need:** only their own assistance requests and status; no other applicants' request list.

These are **front-end role filters**, not complete authorization boundaries. `/api/state` requires a signed-in account but exposes shared records to all signed-in users. Do not use real identity documents or victim information until server-side role authorization, per-record API filtering, and secure evidence storage are implemented.

## Complete project package

This folder includes the full ReliefLink India Node.js/Express project, role-specific demo workspaces, and readable CSS with animations, hover effects, and transitions.

### Run on Windows
1. Install Node.js 22.5 or newer.
2. Open this folder in VS Code.
3. Open Terminal > New Terminal.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:4000` in your browser.

The role-specific workspace filters are currently a frontend demo. Do not use this version with real personal or sensitive data until server-side role authorization and secure evidence storage are implemented.
