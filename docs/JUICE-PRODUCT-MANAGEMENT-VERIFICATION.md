# Juice — Product Management Verification (Sprint 2)

Date: 2026-10-17 · Scope: staff product form (create/edit), server-side validation, product list, authorisation, persistence.

## What was implemented

1. **Real `ProductForm` component** (`src/routes/juice-staff.tsx`) replacing the "to be implemented" stub.
   Fields: name, category (select), price (KES), SKU (optional), description, ingredient/allergen note,
   sizes JSON, add-ons JSON, sort order, available/featured/bestseller checkboxes.
   Editing prefills every field from the stored product; sizes/add-ons are re-serialised to the DB
   format (`[{label, price_minor}]` / `[{name, price_minor}]`).
2. **`GET /staff/juice/products` list route** — this route did not exist even though every nav link and
   the save-redirect target pointed at it (it returned 404). Now renders the catalogue with search,
   a `?saved=1` success banner, and per-row Edit actions.
3. **Server-side validation on `POST /staff/juice/products`** (shared handler registered for both
   `/staff/juice/products` and `/staff/juice/products/:id`):
   - name required (≤120 chars); category must exist (`categoryById`);
   - price required, `^\d{1,7}(\.\d{1,2})?$`, stored as integer minor units, must be > 0;
   - SKU optional but pattern-checked (`[A-Za-z0-9_-]{1,40}`), auto-generated otherwise;
   - sort order must be a 0–99999 integer;
   - sizes/add-ons JSON validated (array of objects, non-empty label/name, integer
     `price_minor` 0–1,000,000, max 20 entries) and normalised before storage;
   - updating a non-existent product returns 400, not success;
   - failures re-render the form (HTTP 400) with the error list and the submitted values preserved.
4. **Duplicate/DB-error handling** — the UNIQUE-SKU violation is caught and shown as a clear 400
   message; any other DB error returns a generic 500 page. No false success is possible.
5. **Metadata preservation on edit** — `created_by` and `currency` are never touched by the UPDATE;
   blank sizes/add-ons fields preserve existing values via `COALESCE(?, sizes/addons)`.

## Defects found and fixed along the way

- The product **INSERT statement was syntactically broken** (`VALUES (?,?,...,?` — missing closing
  parenthesis and one placeholder short of the 15 columns): every product creation failed at the DB.
- The edit form posted to `/staff/juice/products/:id` but **no POST route existed there** (404).
  The save handler is now registered for both URLs.
- Receipt pages linked back with a literal `href="/staff/juice/orders/{order.id}"` (broken link).
- Unchecking "available" previously had no effect (`body.available !== "off"` default-true); the form
  and handler now use explicit `available === "on"` semantics.

## Tests (tests/juice-storefront.test.ts, isolated temp SQLite DB, owner + scanner sessions)

Command: `node --import tsx --test tests/juice-storefront.test.ts` — **37/37 pass** (whole file;
product subset listed below).

| Coverage | Result |
|---|---|
| Create persists with minor-unit pricing (120.50 → 12050), audit row written | pass |
| Invalid/missing name, category, price, sort order → 400 with messages, nothing persisted | pass |
| Zero and negative prices rejected | pass |
| Malformed sizes/add-ons JSON rejected (non-JSON, missing label, negative price) | pass |
| Valid sizes/add-ons JSON normalised (trimmed label, integer prices) | pass |
| Edit updates fields, preserves `created_by` and `currency` | pass |
| Edit with blank sizes/add-ons preserves existing JSON | pass |
| Update of missing product → clear 400 | pass |
| Duplicate SKU → 400 "SKU is already used", exactly one row, first intact (DB-error path) | pass |
| Unauthenticated create → 403, nothing persisted | pass |
| Scanner (authenticated, no `manage` capability) → 403, nothing persisted | pass |
| List renders saved products; `?saved=1` banner; `?q=` search filters | pass |
| New/edit forms render all fields; edit form prefilled (`value="17.50"` etc.) | pass |

Role model used: the project's actual `Role` union (`owner`, `manager`, `sales_staff`, `scanner`,
`ad_admin`) and `ROLE_CLEARANCE` — no roles were invented.

## Known limitations

- Product **image upload** is not implemented (the `product_images` table exists; no UI/route yet).
- Sizes/add-ons are edited as JSON text; a friendlier row-editor UI is future work.
- Price is capped at 7 integer digits by the validation regex (KSh 9,999,999).
