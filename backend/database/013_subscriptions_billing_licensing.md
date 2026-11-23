# Subscription and billing migration 013

After migration 012, take a normal PostgreSQL backup and apply 013 before starting the updated backend:

```powershell
psql -v ON_ERROR_STOP=1 -d sna_fleet -f backend/database/013_subscriptions_billing_licensing.sql
```

The migration adds billing tables, views, constraints and history triggers. It does not backfill subscriptions or write to GPS, SIM, vehicle or Traccar records. The migration transaction rolls back on failure. If an application rollback is necessary after success, deploy the previous application and preserve the new tables and their history. Back up financial history before any separately approved schema removal.

## Billing conventions

- Billing dates are UTC calendar dates. Period ends are exclusive. Monthly, quarterly, annual and custom whole-month intervals retain the original day-of-month anchor and clamp short months. A trial establishes the anchor at its first billable day. Manual and automatic generation both create drafts only. Administrators can run the bounded automatic batch to process the next due period of each eligible subscription. Optionally set `BILLING_AUTO_DRAFT_ACTOR_ID` to an active platform administrator ID on the backend to run that batch at startup and every 15 minutes. Leave it unset to disable unattended drafts. The audit records the configured actor and scheduler source. Install the migration before enabling the scheduler.
- Decimal inputs are sent as strings and stored as exact PostgreSQL numeric values. The API accepts currency codes supported by the runtime, with two ledger decimal places for PKR and the runtime currency precision for other codes. Reports group currencies separately. Collections are net recorded payments by payment date and reversals by reversal date. Outstanding balances and overdue counts reflect current balances for invoices issued in the selected date range.
- A tenant has one current hosted subscription, including while suspended. Published plan versions and approved price terms are retained. New terms take effect at the next unbilled boundary. Existing subscriptions retain their terms until a new version or negotiated rate is approved. Tenant-specific override reasons and approving actors are platform-only.
- Only same-tenant installed trackers present at draft generation are counted. Reserved devices are excluded. The draft keeps its device claims and prices when a tracker later moves. An overlapping device claim blocks a second charge for the same tracker until its coverage ends or its invoice is voided. Late drafts capture the installation state when generated, without reconstructing historical assignments or prorating. Manual connectivity and hardware charges are separate line items. Carrier plan costs are never used as billing rates.
- Invoices must be finalized explicitly. Enter tax and discounts as explicit line items. There is no default tax rate, jurisdiction-specific tax engine, or certification. Issued invoices are immutable. Void an unpaid invoice and use a linked one-time correction if needed. Reverse any recorded payments first. Invoice numbers are unique and may have gaps.
- Record payments manually with a stable request key for retries. References are unique per tenant when supplied. Reversals preserve the original ledger and release the balance for a separately recorded correction. Keep payment credentials and card data out of notes and references.
- Entitlements and limits provide billing warnings only. Nothing in billing suspends tracking, changes ingestion, or prevents authorized access to historical invoices. Enterprise license metadata distinguishes hosted and self-hosted deployments. It does not enforce licenses or provide offline activation.

## First use

Open **Manage billing** in the platform dashboard. Create a plan, publish a price, and create and activate a subscription. Generate a draft and review device claims, currency, tax treatment, and payment terms before issue. Verify issued-invoice visibility with a tenant administrator. Managers and viewers retain fleet access and receive no billing access. Online payments, unattended charging, automatic notifications outside the app, and tax compliance integrations are outside Step 39.
