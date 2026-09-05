# Firebase deployment and Firestore migration guidance

This is guidance for a possible future move. The working app still uses PostgreSQL (PGlite for local development). No Firebase backend, project, billing, or deployment has been configured. Uploading the frontend to Firebase does not convert the database. Keep using the current README setup locally.

## Proposed deployment

Use Firebase Hosting for the Vite `dist` frontend, an Express API on Cloud Functions or Cloud Run, Cloud Firestore for business records, and Cloud Storage for product images. This is a proposed architecture requiring implementation and testing. Firebase supports routing Hosting requests to an Express function through rewrites; `/api/**` must resolve to the API before the SPA fallback to `/index.html`. See [Hosting with Cloud Functions](https://firebase.google.com/docs/hosting/functions).

The API should remain the single authority for permissions, prices, stock, invoices, and payments. Preserve the existing public catalogue/enquiry and protected admin API contracts so the interface can stay largely unchanged. Do not expose commercial collections directly to anonymous clients.

Hosting can also be adopted while retaining PostgreSQL on a separate managed service. That avoids a database migration, but still requires the API deployment, cookie adaptation, production storage, and integration tests below.

## Authentication and configuration

The current opaque session cookie is named `hy_session`. Firebase Hosting forwards only the specially named `__session` cookie to Cloud Functions/Cloud Run. Before using those rewrites, adapt both cookie creation and parsing, then test login, logout, recovery, expiry, and staff permissions behind Hosting. Keep HttpOnly, Secure, SameSite and origin validation. Serve admin responses with `Cache-Control: private, no-store`. See [Firebase cookie and cache behavior](https://firebase.google.com/docs/hosting/manage-cache).

Either port the existing server-side authentication/session records to Firestore or implement Firebase Authentication email/password and verified server sessions. This choice must be implemented explicitly; Firebase Authentication is not currently wired into this app. For a new production account, use secure owner setup or a password reset rather than uploading `.data/local-access.txt`, local sessions, or local password hashes.

Configure the final HTTPS origin, chosen region, server identity/IAM, image bucket, SMTP or selected recovery service, and business tax settings. Store secrets in the hosting secret manager. Do not put service-account credentials or SMTP passwords in `VITE_*` variables. Never bundle `.env`, `.data`, `tmp`, or local uploads into Hosting assets.

## Suggested Firestore model

Use individual documents, not a single document containing the whole database. Keep the existing UUIDs when migrating records.

| Current data               | Proposed collection                                                       |
| -------------------------- | ------------------------------------------------------------------------- |
| Catalogue                  | `products`, `categories`, `brands`                                        |
| Commercial records         | `enquiries`, `customers`, `quotes`, `orders`, `invoices`                  |
| Stock and movement records | `batches`, plus a collection for each existing stock movement record kind |
| Staff/session state        | `users`, `sessions`, `passwordResets` if retaining current auth           |
| Numbering and retry keys   | `counters`, `requestKeys`                                                 |
| Configuration and history  | `settings`, `audit`                                                       |
| Live notifications         | `events`, `notificationReads`                                             |

Preserve integer paise, quantities, status transitions, immutable order/invoice snapshots, financial-year invoice sequences, and Asia/Kolkata business dates. Map all existing `app_records` kinds and SQL tables before export, including payment records; reconcile counts and totals rather than relying only on this outline. Add indexes for the actual category/publication, customer/status, product/batch/expiry, and event audience/cursor queries. Keep pagination and document limits in mind when replacing SQL reports and list endpoints.

## Transactions are the critical migration work

The current SQL adapter and global database lock cannot run against Firestore. Rewrite repository operations and business transaction boundaries; setting `DATABASE_URL` to Firebase will not work. Firestore transactions require reads before writes and may retry the transaction function. Keep external side effects outside retries. See [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions).

For each operation, read all records it depends on first, validate the state, then commit every related write together:

- Quote conversion: accepted quote, conversion marker, eligible batches and sequence; create one order, reserve quantities, link the quote, and record the idempotency result and event.
- Dispatch: order and every reserved batch; reject expired batches, deduct stock, clear reservations, and write the status/history together.
- Cancellation: order and affected batches; release reservations exactly once and keep invoice/payment guards.
- Invoice issue: settings, order snapshot, existing invoice marker and financial-year counter; issue one number and one immutable invoice.
- Payment: current invoice/order balance and request key; reject overpayment and record the payment and updated balance atomically.

Use a per-product inventory coordination document or an equally tested strategy so a concurrent receipt/reservation cannot evade allocation conflict detection. Generate stable operation IDs before a retry. Include audit and notification events in the business commit; failed or repeated requests must not produce false alerts. Do not perform email, file uploads, or PDF delivery from a transaction retry callback.

## Permissions, images, and live updates

Use server-only writes for business records and default-deny direct client access unless a narrowly scoped client feature is deliberately added. Admin SDK access bypasses Firestore Security Rules, so the Express API must still enforce Owner, Sales and Warehouse roles, active accounts, and input validation. Server IAM must also be restricted. See [Firestore rules and server access](https://firebase.google.com/docs/firestore/security/rules-conditions).

Replace the S3 storage adapter with a Cloud Storage implementation while retaining decoded-image validation, size limits, generated filenames, and owner-only uploads. Only catalogue artwork should be publicly readable; keep private documents separate.

The current notifications use authenticated polling every five seconds while the admin tab is visible, with focus/reconnection checks and persistent per-user read state. Keep that API working during migration. A future Firestore listener implementation must filter events by authorized audience and handle reconnects, read markers and duplicate events. Public catalogue polling refreshes every fifteen seconds. These are in-app updates; closed-browser push notifications are not implemented.

## Migration and release sequence

1. Choose a Firebase project, region, runtime and authentication approach. Review current service pricing/billing requirements in that account before provisioning resources.
2. Implement the Firestore/storage adapters, session changes, backend entrypoint, Hosting rewrites, rules and indexes in a separate development environment.
3. Run the existing workflow tests against Firebase emulators with added concurrency, rules, expiry, retry, notification and session tests. Test PDFs/CSV against migrated snapshots.
4. Back up PostgreSQL and images. Build a repeatable exporter/importer preserving IDs and references, and rehearse on a copy. Compare every record count, stock/reservation quantity, payment balance and invoice counter.
5. During a planned cutover, pause writes, take the final export, import and reconcile it, provision the production owner securely, and test through the final Hosting domain.
6. Verify restarts, two simultaneous staff sessions, anonymous enquiry submission, denied access, quote-to-payment workflow and notification recovery. Only then switch traffic. Keep the original database backup for rollback; avoid dual writes without a tested reconciliation strategy.

No steps above have deployed or migrated the current application. The remaining work is implementation plus verification using your selected Firebase services.
