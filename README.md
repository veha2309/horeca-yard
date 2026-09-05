# Horeca Yard

A complete wholesale catalogue and operations application, recreated from the supplied Emergent reference and Horeca Yard brand imagery. Built with React, TypeScript and Vite, running on Firebase Hosting with Cloud Firestore. No paid services are needed — it runs entirely on Firebase's free Spark plan.

## Live site

Deployed to Firebase Hosting at **https://horecayard.web.app**, with Cloud Firestore as
the database and Firebase Authentication for staff sign-in. The admin portal is
**https://horecayard.web.app/admin/login**. See [FIREBASE.md](FIREBASE.md) for the
architecture, deployment steps, and the permission trade-offs the serverless design
forces.

```sh
npm ci
npm run deploy      # typecheck, build, deploy hosting + rules + indexes
```

Owner credentials from the initial setup are in `.data/firebase-access.txt`, which is
excluded from Git and Docker. Change the password from **Staff & access** after signing
in. Password recovery sends a real Firebase reset email.

## Run against the emulators

Requires Node.js 22 or newer and a JDK (for the Firestore emulator).

```sh
npm ci
firebase emulators:start --only firestore,auth
npm run test:firestore
```

## The original PostgreSQL server

`server/` still contains the Express + PostgreSQL application this was ported from. It is
no longer what gets deployed, and the browser no longer talks to it, but it remains
runnable (`npm run setup:local && npm run dev`) as the reference for the business rules.
`src/core/domain.ts` is a copy of `server/domain.ts` and should be kept in step with it.

## What is included

- Reference-inspired responsive homepage, exact reference product images, six categories and 12 initial products.
- Self-hosted fonts, smooth hero entrances, staggered scroll reveals, hover transitions, animated dialogs, and reduced-motion support.
- Search, category/brand filters, product details and an anonymous enquiry basket. Customer prices stay private.
- Owner, Sales and Warehouse roles, email/password sessions, recovery emails through SMTP, and staff management.
- Product/image management, brands, categories, enquiry assignment and follow-up, customers and quotes.
- Draft → Sent → Accepted/Declined quotations; accepted quotations convert to one order, reserving stock by earliest expiry.
- Confirmed → Packing → Dispatched → Delivered orders; cancellation is available before dispatch for uninvoiced, unpaid orders.
- Batch receipts, adjustments, reservations, expiry and low-stock alerts, and a stock movement ledger.
- Immutable invoice and quotation PDFs; domestic CGST/SGST or IGST totals; offline payment history and balances.
- Reports, CSV exports, editable homepage/contact details, and audit records.

## Role permissions

| Capability                                 | Owner | Sales | Warehouse          |
| ------------------------------------------ | ----- | ----- | ------------------ |
| Read catalogue                             | Yes   | Yes   | Yes                |
| Edit catalogue / brands / categories       | Yes   | No    | No                 |
| Enquiries / customers / quotations         | Yes   | Yes   | No                 |
| Confirm orders / invoices / payments       | Yes   | Yes   | No                 |
| Read fulfilment orders                     | Yes   | Yes   | Yes, prices hidden |
| Update fulfilment / cancel eligible orders | Yes   | No    | Yes                |
| Stock / adjustments / movement history     | Yes   | No    | Yes                |
| Commercial reports                         | Yes   | Yes   | No                 |
| Staff / settings / audit                   | Yes   | No    | No                 |

`firestore.rules` enforces these restrictions, since there is no longer a server. Hiding
a button is never the access-control mechanism. Two rows are weaker than they look now:
the Warehouse role can reach order prices through the SDK even though the UI hides them,
and Sales can write stock batches because confirming an order reserves stock. Both are
explained in [FIREBASE.md](FIREBASE.md).

## First business setup

1. Set registered business name, address, GSTIN, state code, bank details and terms in **Business settings**. Update the public phone and Instagram link as needed.
2. Review each product's HSN, minimum quantity, pack size, publication and availability. The reference supplies carton counts for some products, but not every ITC carton; verify the minimum sellable unit before quoting those items.
3. Receive actual stock with batch number, expiry and quantity. No prices, stock receipts, GST details or customers are fabricated in the seed data.
4. Add staff with their required roles. Choose Sales for commercial work and Warehouse for fulfilment.
5. For invoicing, complete the customer's billing/delivery address and place-of-supply state **before** creating the quotation. Customer and product details are snapshotted into each quotation and retained in its order and invoice.
6. Receive an enquiry, create its customer, prepare a quotation, download/send it yourself, mark it sent, and record the customer's acceptance. Confirm the order after receiving sufficient stock.
7. Issue the invoice, record offline payment references, and update packing/dispatch/delivery. Issued invoices cannot be edited; credit notes, returns and refund reconciliation are outside this version.

## PostgreSQL setup

Provide `DATABASE_URL` in a local `.env` or the hosting environment. An example local value is `postgresql://USER:PASSWORD@localhost:5432/horeca`; do not commit a real connection string.

An optional `compose.yaml` starts PostgreSQL bound to localhost. Set `POSTGRES_PASSWORD` first, start Docker Desktop, then run `docker compose up -d`. Set a matching `DATABASE_URL` before owner setup. Docker was not running in the supplied workstation, so the delivered preview uses PGlite.

```sh
npm run migrate
# Set OWNER_EMAIL and OWNER_PASSWORD securely in your environment (12+ characters).
npm run setup
# Remove OWNER_PASSWORD from the environment after setup.
npm run dev
```

Migrations are versioned under `migrations/` and applied transactionally. Startup also applies pending migrations; run a single migration job before starting multiple production instances. Application records use indexed JSONB, with Zod validation at every write boundary. A database row lock serializes commercial and stock mutations; database transactions roll back incomplete allocations. This favors correctness for a small wholesale operation over maximum write throughput.

## Deployment

Considering Firebase? See [Firebase deployment and Firestore migration guidance](FIREBASE.md). It is guidance only; the current backend remains PostgreSQL.

Live deployment is not performed. The source, build, Dockerfile and environment example are ready for your own accounts.

1. Provision PostgreSQL with backups and TLS, and an HTTPS application domain. Configure `DATABASE_URL`, `APP_URL` and `NODE_ENV=production`.
2. Provision an S3-compatible bucket. Set the `S3_*` variables in `.env.example`. `S3_PUBLIC_URL` must be the HTTPS URL of the product-image bucket/CDN. Grant the application write access only to this bucket. Public images must not share storage with private documents.
3. Configure SMTP and `MAIL_FROM` to enable password recovery. Without SMTP, the app explicitly reports recovery as unavailable; it never returns reset tokens to browsers or writes them to logs.
4. Run migration and owner setup using the source checkout and the production environment. Keep secrets in the hosting secret manager, not Docker build arguments or image layers.
5. Run `npm run build`, then `npm start`; or build and run the provided Dockerfile with the same environment. Terminate HTTPS at the reverse proxy. Exactly one trusted reverse proxy is assumed; review `trust proxy` if your architecture differs.
6. Route traffic to port 3000 and check `/api/health`. Serve uploads from configured object storage; local uploads are disabled in production.
7. Back up PostgreSQL and the image bucket, test restore, and monitor application errors and health. Never deploy `.data/`, `tmp/`, `.env`, or local credentials.

`APP_URL` must match the browser origin exactly (no trailing slash). HTTPS production is required for secure cookies. Production refuses to start without PostgreSQL and an HTTPS origin.

## Validation

Admin notifications appear in the bell and as pop-up messages for new enquiries and authorized team updates. Visible admin tabs check every five seconds and on focus; unread state is saved per account. Lists refresh in the background and open drafts are preserved. Public catalogue changes refresh within fifteen seconds. Routine profile edits keep sessions active; expiry, deactivation and security changes can still require sign-in. These are in-app notifications, not closed-browser push messages.

For an owner-authorized local password change, stop the preview with `npm run stop`, supply `OWNER_PASSWORD` through the process environment, run `npm run password:local`, clear that environment variable, then run `npm run dev`. This development-only utility preserves local sessions and updates the ignored `.data/local-access.txt`; production password recovery remains separate.

```sh
npm test
npm run build
```

The integration suite exercises real HTTP handlers against a separate PostgreSQL engine: access restrictions, enquiry retries, customer conversion, money calculations, accepted-quote conversion, stock rollback, concurrency, expiry, cancellation, invoice prerequisites, immutable snapshots, partial payments, duplicate prevention, CSV escaping, PDF generation, image rejection, last-owner protection, reset token expiry/reuse, and disk persistence. Test records are isolated from the preview. PDF fixtures go to ignored `tmp/pdfs/`.

The same database adapter supports standard PostgreSQL, but external PostgreSQL, real SMTP delivery, and S3 uploads require your services and credentials for deployment verification. No claim is made that those external services have been provisioned.

## Boundaries and source references

This is a domestic, quote-led wholesale workflow. There is no online checkout, customer account, automated WhatsApp sending, carrier API, multi-warehouse transfer, tax filing, e-invoice/IRN submission, credit-note/refund workflow, or live publication.

GST rates and HSN codes are entered by staff, not inferred by the app. Review the business tax configuration before using documents commercially. Invoice fields follow the [CBIC invoice particulars](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001); applicable signature and government submission obligations remain with the business. PDFs do not obtain an IRN or a digital signature.

Reference: the user-supplied Emergent site and six Instagram screenshots. Product images were copied from the reference site's visible public catalogue; source URLs are recorded in `public/images/SOURCES.md`. Fonts are downloaded from Google Fonts and served locally.
