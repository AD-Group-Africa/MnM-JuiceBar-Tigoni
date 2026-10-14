# Payments & Reconciliation — MnM Tickets

## Provider abstraction

`payments/index.ts` defines `PaymentProvider { initiate(order, msisdn) → {status, providerRequestId?} ; describe() }`. Adapters:

1. **Daraja (Safaricom M-Pesa STK Push)** — `daraja.ts`. Implements OAuth token fetch + cache, STK initiation (`BusinessShortCode`, `Password` from shortcode+passkey+timestamp, `CheckoutRequestID` persisted as the payments.provider_request_id UNIQUE idempotency key), callback handling that validates `MerchantRequestID`, `CheckoutRequestID`, `ResultCode`, exact expected **amount + currency** match before settlement, and stores `MpesaReceiptNumber`. **Live status: BLOCKED** — requires configured MPESA_* credentials, a public callback URL and an approved merchant arrangement; no sandbox account could be created from this build environment, so no live call has been made and none may be simulated as real.
2. **Development simulator** — `dev.ts`, only when `PAYMENT_PROVIDER=dev`; every page/record clearly labels it as simulated. Never displayed as real money movement.

## Integrity rules (tested)

- Settlement happens **only** on a valid provider callback (never from a browser redirect alone).
- Callback amount must exactly equal the order total (minor units) in the order currency; mismatches go to `reconcile_exceptions`, never silently accepted.
- Duplicate/delayed callbacks: the second lookup hits the UNIQUE provider-request id → update the existing row, mark `duplicate` if the outcome is already terminal; **no second ticket issuance, no double commission**.
- Failed/expired payments release expired reservations (expiry scanner runs on order-touch paths) and move the order to `payment_failed` / `expired`; no ticket is issued in those paths (tested).
- New attempt after failure starts row `initiated` again; the order lifecycle machine sets `pending_payment`.
- Reconciliation: dashboards total succeeded payments and flag open exceptions. Actual funds-split to MnM/organisers/AD is an **offline settlement workflow** recorded in the dashboard (nothing in v0.1 claims automated splitting).
