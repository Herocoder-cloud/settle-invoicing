# Settle — Freelance Invoice & Payment Tracker

Track clients, create invoices, watch payments move from Draft -> Sent ->
Paid, and see exactly how much money is outstanding -- all converted to a
single home currency so multi-currency freelance work doesn't turn into a
spreadsheet mess.

**Live demo:** _add your Netlify URL here after deploying_

## The problem this solves

Freelancers working with international clients deal with invoices in
different currencies, unclear payment status, and no simple way to answer
"how much money am I actually owed right now, in rupees?" Existing tools
(Bonsai, HoneyBook, FreshBooks) are built for the US/EU market, expensive,
and often overkill for a solo freelancer with a handful of clients. This
is a lean version of exactly that, and a genuinely usable one -- built to
actually run a small freelance practice on, not just a portfolio demo.

## What it demonstrates technically

**Multi-currency logic.** Invoices are stored in whatever currency the
client pays in. The dashboard fetches live exchange rates once per
session and converts every outstanding invoice to INR to produce one
meaningful "how much am I owed" number. If the live rate fetch fails
(offline, API down), it falls back to a static rate table so the app
never fully breaks.

**Computed status.** An invoice's status in the database is only ever
`draft`, `sent`, or `paid` -- `overdue` is never written to Firestore. It's
computed on read (`effectiveStatus()`) by comparing the due date to
today. This avoids needing a background job to "sweep" invoices and mark
them overdue; the status is always correct the moment you look at it.

**PDF generation client-side.** The "Download PDF" button uses jsPDF to
lay out a real invoice document entirely in the browser -- no server, no
PDF-generation API. Useful to understand for any project that needs to
produce a downloadable report, certificate, or receipt.

**Same Firebase pattern as the Boarding project**, applied to a second,
different data shape (clients + invoices instead of job applications) --
good evidence that the auth/Firestore pattern was actually learned, not
just copy-pasted once.

## Tech stack

- Vanilla HTML/CSS/JS, ES modules, no build step
- Firebase Authentication (email/password) + Firestore (2 collections:
  `clients`, `invoices`)
- jsPDF (CDN) for client-side PDF generation
- exchangerate-api.com (free, no key) for live currency conversion

## Firestore security rules

Same principle as the Boarding project — each user only ever sees their
own data:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /clients/{clientId} {
      allow read, update, delete: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
    match /invoices/{invoiceId} {
      allow read, update, delete: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
  }
}
```

## Deploying this yourself

1. Create a Firebase project (same steps as the Boarding project --
   Authentication with Email/Password enabled, Firestore in production
   mode with the rules above).
2. Fill in `firebase-config.js` with your project's config.
3. Push this folder to a GitHub repository.
4. Netlify -> Add new site -> import the repo -> deploy. No environment
   variables needed.

## If this became a real product

- Recurring invoices for retainer clients
- Automated payment reminder emails a few days before/after due date
- Stripe or Razorpay integration to accept payment directly from the
  invoice link
- Multi-user support for a small agency, not just a solo freelancer
