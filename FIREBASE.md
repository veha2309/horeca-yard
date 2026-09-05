# Firebase deployment

The application runs as a static frontend on Firebase Hosting with Cloud Firestore as
its database and Firebase Authentication for staff sign-in. There is no application
server: the browser talks to Firestore directly, and `firestore.rules` is the only
enforcement of the role permissions in README.md.

- **Live site:** https://horecayard.web.app
- **Project:** horecaYard (`horecayard`)
- **Console:** https://console.firebase.google.com/project/horecayard/overview

## Deploying

```sh
npm run deploy          # typecheck, build, then deploy hosting + rules + indexes
```

Individually:

```sh
npx vite build
firebase deploy --only hosting
firebase deploy --only firestore:rules,firestore:indexes
```

## First-time setup

Already done for this project; documented for rebuilding it elsewhere.

1. Create the project and a web app, then paste the SDK config into `src/core/firebase.ts`.
2. Enable **Email/Password** under Authentication → Sign-in method.
3. Add the temporary bootstrap clause to `firestore.rules` under `/users/{uid}`, keyed to
   the first owner's email address, and deploy the rules.
4. `OWNER_EMAIL=you@example.com npm run bootstrap` — creates the owner sign-in, records
   the Owner role, seeds the catalogue, and writes the password to
   `.data/firebase-access.txt` (git-ignored).
5. Remove the bootstrap clause and deploy the rules again.

## How the port works

The Express server was replaced without rewriting the business logic or the UI.

| Layer | What happened |
| ----- | ------------- |
| `src/core/domain.ts` | Unchanged from the server, apart from allowing `data:` image URLs. All pricing, GST, stock and order-state logic. |
| `src/core/db.ts` | Firestore adapter exposing the original `get/list/save/number/audit` surface, so `domain.ts` compiles against it untouched. |
| `src/core/routes.ts` | The former Express router, running in the browser. `src/api.ts` dispatches to it instead of `fetch`. |
| `src/core/pdf.ts` | The same pdfkit document, emitted as a Blob instead of an HTTP response. |
| `src/core/notifications.ts` | The `app_events` feed, re-expressed as a Firestore collection ordered by a counter. |

Each SQL table became a collection. `app_records(kind, data)` was already document-shaped,
so `kind` became the collection name and `data` the document body.

### Transactions

The Firestore web SDK forbids reads after writes inside a transaction, but the domain
logic interleaves them. `transaction()` in `src/core/db.ts` buffers every write and
flushes it after the callback returns, so all reads still precede all writes. Reads
consult the buffer first, so a caller sees its own pending writes. `save()` enlists each
document it is about to write in the transaction's read set, which is what gives
concurrent edits to the same record real conflict detection.

The one gap: the web SDK cannot run *queries* inside a transaction, so `list()` reads
outside the transaction snapshot. A record created by someone else mid-transaction is
therefore not seen. This is marked with a `ponytail:` comment in `db.ts`.

## What the no-server design gives up

These were enforced by the API and cannot be enforced by security rules, which grant
access per document and cannot filter fields:

- **The Warehouse role can read order prices.** The UI hides them and the API used to
  strip them, but Warehouse must read and update `orders` to move fulfilment along, so
  the values are reachable through the SDK. Everything else in the permission table is
  enforced by the rules.
- **Sales can write `batches`.** Confirming an order reserves stock, so Sales needs write
  access to the collection the UI only lets the warehouse edit.
- **Staff can read `settings`,** including bank details, because quotations embed the
  seller block. Anonymous visitors cannot — the public homepage reads `public/site`,
  which carries only the five fields the old catalogue endpoint returned.
- **No rate limiting.** The Express limiter is gone. Anyone can submit enquiries as fast
  as they can post them. The rules constrain *what* an anonymous visitor may write —
  enquiry documents only, one enquiry-counter increment at a time, and a notification
  whose text must start with `New wholesale enquiry` — but not how often.
  **Firebase App Check is the free replacement and is not yet enabled.**
- **Password changes for other staff.** An Owner can no longer set someone else's
  password; that needed the Admin SDK. Staff use "Forgot password", which now sends a
  real Firebase reset email. Creating and deactivating staff still works.
- **Image uploads are stored inline.** Cloud Storage requires the Blaze plan, so uploads
  are resized in the browser and written into the product document as a WebP data URL,
  capped at 700 KB to stay under Firestore's 1 MB document limit.

## Verifying

`npm run test:firestore` runs the workflow against the local emulators with the
production rules loaded — anonymous enquiry, quotation, stock reservation, invoicing,
payment, and the role boundaries.

```sh
firebase emulators:start --only firestore,auth   # in one terminal
npm run test:firestore                            # in another
```
