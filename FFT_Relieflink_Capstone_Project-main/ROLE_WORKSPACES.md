# ReliefLink India — role workspaces and what to build next

## What changed in this update
- Different dashboard for Administrator, NGO/Shelter, Donor, Volunteer, and Person in Need.
- Sidebar pages are limited by role.
- Donors see verified open resource needs, their own offers, and their own pledges.
- NGOs see their own requests and deliveries linked to those requests, alongside verified public needs/incidents.
- Volunteers see verified public information only; task assignment is not yet built.
- Individuals see only assistance requests matching their account email/name in the UI.
- Full workspace import/export is visible only to Administrator in the UI.

## Keep these core features
1. Role-specific account onboarding and profile.
2. NGO registration review (registration certificate, legal registration type/number, authorised representative, and optional NGO Darpan reference).
3. Disaster incident report with location, date/time, description, source and evidence.
4. Separate verification for the incident and every exact resource need.
5. Resource need with item, quantity, unit, priority, location, linked verified incident, evidence and review notes.
6. Donor offer, matching, pledge and delivery confirmation.
7. Personal assistance request and private status tracking.
8. Administrator review queue, audit history, backups and basic reporting.
9. Privacy, accessibility, and alternative verification for disaster-affected people without identity documents.

## Features not needed in the first capstone release
- Publicly showing full identity-document numbers or storing Aadhaar/PAN scans in ordinary database fields.
- Automatic AI approval of disaster incidents or NGO legitimacy without a human review.
- Volunteer GPS tracking, live chat, payments, complex gamification, or a native mobile app before core workflows work.
- Importing live government data without official API access and source validation.

## Critical work still required before real use
1. Replace the role selector with real sign-up/sign-in (hashed passwords or a trusted identity provider, verified email/phone, secure sessions and MFA for admins).
2. Enforce role permissions on the Node.js API; hiding a button is not security. Filter each API response by account and role.
3. Add real registration records and a pending/approved/rejected NGO verification queue. Store document files in private object storage, not as data URLs in the general workspace database.
4. Minimise personal data. Do not require PAN for relief applicants. Do not collect Aadhaar unless a lawful, necessary, consent-based verification method is available; support alternatives for people without documents.
5. Add file type/size checks, malware scanning, access logs, retention/deletion rules, rate limiting, backups and recovery tests.
6. Add volunteer assignment/availability only after role permissions and safeguarding rules are ready.
7. Test each role with separate test accounts and verify that private requests, evidence, and exports are not visible to unauthorised users.

## Important limitation
This update makes the **interface and its visible records role-specific**, but it does not turn the prototype into a secure multi-user production system. The API still uses a shared workspace endpoint. Do not use it to store real Aadhaar/PAN information or coordinate live emergency response until server-side authentication and authorisation are implemented.
