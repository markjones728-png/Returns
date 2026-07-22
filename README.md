# Roger Technology Returns Portal

A self-contained web app for logging, tracking, and managing customer equipment returns (RMAs).

## What it does

- **Customers** (no login needed) submit a return at `/submit`: company name, contact
  name, phone, email, equipment type, make, model, serial number, fault description,
  plus optional photos/videos. They get a reference number and a confirmation email.
- Customers can check progress any time at `/track` using their reference + email.
- **Staff** log in at `/login` and see a live dashboard of open returns and an archive
  of closed ones, with search by reference/company/serial number.
- Each return has a detail page where staff can:
  - move it through the workflow: Return Submitted → Authorised for Collection →
    In Transit → At Returns Dept → Awaiting RT Italy → Awaiting Inspection by Returns →
    Inspected → To Be Returned to Customer / Warranty Replacement Authorised → Return Closed
  - optionally email the customer automatically on each status change
  - add internal staff notes
  - upload additional photos/videos
  - download a PDF report of the whole return (details + status history)
- An **admin** role can add more staff logins from `/users`.

## Running it locally

Requires **Node.js 22.5 or newer** (uses the built-in `node:sqlite` module, so there's
nothing extra to install/compile - no native build tools needed).

```bash
cd returns-app
npm install
cp .env.example .env     # then edit .env - see below
npm start
```

Open http://localhost:3000

On first run it creates `data/returns.db` (SQLite) and seeds one admin login:

- username: `admin`
- password: `ChangeMe123!` (from `.env` - change it, and log in and add your own
  staff accounts via `/users` once you're up and running)

Uploaded photos/videos are stored under `uploads/<reference>/`.

## Email setup

Open `.env` and fill in `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` with a
mailbox or transactional email provider (e.g. your Office 365/Google Workspace
mailbox, or a service like SendGrid/Mailgun/Brevo - these tend to be more reliable
for automated mail than a normal inbox). Until you do, emails aren't lost - they're
just printed to the server console instead of sent, so you can test the whole flow
before wiring up real email.

## Making it reachable "over the internet" for your team

This app needs to run continuously on a server with a public address - it can't be
hosted from this chat. The easiest options, roughly in order of effort:

1. **A small VPS you already have, or a low-cost one** (e.g. a £4-5/month box):
   install Node 22+, copy this folder up, `npm install --omit=dev`, set up `.env`,
   and run it with a process manager so it restarts automatically:
   ```bash
   npm install -g pm2
   pm2 start server.js --name returns-portal
   pm2 save && pm2 startup
   ```
   Put it behind Nginx (or Caddy, which gets you free HTTPS automatically) so staff
   can reach it at a proper domain like `returns.yourcompany.co.uk` over HTTPS.

2. **A platform-as-a-service** (Render, Railway, Fly.io, etc.) - point it at this
   folder, set the environment variables from `.env` in their dashboard, and it'll
   build and host it for you with a public URL and free/cheap tiers. Note: on most
   of these the filesystem isn't permanent between deploys, so the SQLite database
   and uploaded files would need to live on an attached persistent volume/disk
   (most of these platforms offer one) rather than the default ephemeral disk.

3. Once it's on a real domain, set `COOKIE_SECURE=true` in `.env` so session
   cookies only travel over HTTPS.

If you'd like, I can prepare a specific deployment (e.g. a Dockerfile, or
step-by-step for a particular host) - just let me know which route you'd rather take.

## Project structure

```
returns-app/
  server.js              - app entry point
  db.js                  - SQLite schema + seed admin user
  routes/
    public.js             - customer submission + tracking (no login)
    auth.js               - staff login/logout
    returns.js             - staff dashboard, return detail, status/notes/files, admin users
  views/                  - EJS templates
  public/css/style.css    - styling
  utils/
    constants.js          - the status workflow list
    email.js              - email sending (falls back to console log if unconfigured)
    pdf.js                - PDF report generation
    upload.js / files.js  - photo/video upload handling
  data/returns.db         - SQLite database (created on first run)
  uploads/                - stored photos/videos, organised by reference number
```
