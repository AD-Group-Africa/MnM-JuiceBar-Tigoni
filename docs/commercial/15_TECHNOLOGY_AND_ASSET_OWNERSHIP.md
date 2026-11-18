# Technology and Asset Ownership — Working Position

**Status:** proposal for owner review, **not an executed agreement**. Nothing here
creates or transfers rights. See `08_IP_DATA_OWNERSHIP_AND_RETENTION.md` and the
draft agreements in this folder; every `[TO BE AGREED]` field still requires the
parties' written agreement.

---

## 1. Why this document exists

Two kinds of assets are mixed in this project:

- **Reusable technology** built once and usable for other clients (the ticketing
  engine, storefront patterns, QR/scan flow, design system).
- **MnM-specific business assets** that only make sense for MnM Juice Bar Tigoni
  (brand, menu, prices, photography, customer records, event relationships).

Without an explicit split, both parties can later assume different ownership of
the same repository. This page records the position assumed by the code and
documents; it does not override a signed agreement.

## 2. Proposed classification

| Asset | Nature | Proposed holder (to be agreed) |
|---|---|---|
| Application source code in this repository | Reusable technology | AD Group / Afrika Digitalis, with a perpetual licence to MnM to operate its instance |
| Ticketing engine, QR issuance/verification, scanning, order/reservation model | Reusable technology | AD Group |
| Storefront architecture, shared UI components, deployment/backup tooling | Reusable technology | AD Group |
| "MnM Juice Bar" / "M&M Juice Bar" name, logo, brand copy, tagline | Business-specific brand | MnM |
| Menu, product names, descriptions, prices, sizes and add-ons | Business data/content | MnM |
| Product photography and owner-supplied artwork | Business content | MnM (licence to AD Group to host/display for this site) |
| Generated placeholder illustrations in `public/menu/` | Project asset created for MnM | MnM may use; generator remains reusable technology |
| Customer accounts, order history, phone numbers, delivery addresses | Personal data | MnM as data controller; AD Group as processor only while operating the service |
| Event listings, organiser contacts, authorisation records | Business data | MnM |
| Audit logs, payment/reconciliation records | Operational records | MnM; retention per `08_…` |
| Domain names and DNS | Business identity | MnM (registered/held by MnM) |
| Render/hosting account, database disk, backup storage | Infrastructure | MnM pays and owns the account; AD Group operates with delegated access |
| API keys and secrets (Daraja, SMS, email) | Credentials | MnM's accounts; stored only in hosting secrets, never in the repo |
| This documentation set | Mixed | Commercial/legal drafts for review; operational runbooks for MnM's use |

## 3. What the repository currently evidences

- The code is a private repository under the `AD-Group-Africa` GitHub
  organisation (`MnM-JuiceBar-Tigoni`).
- Business copy, contact details and settings are stored in the database
  (`business_settings`), not hard-coded, so MnM can change them without a code
  change. Some fallback copy and the phone/address defaults live in the templates.
- No third-party customer data is committed. Local databases and `.env` files are
  gitignored.
- Product images are generated placeholders; owner photography is not in the
  repository.
- No licence file exists. Absent an agreement, default copyright applies and the
  parties should not assume reuse rights either way.

## 4. Open questions requiring written agreement

1. Does MnM receive a perpetual, non-exclusive licence to run this instance if the
   operating relationship ends? Does it include source access for a successor
   developer?
2. May AD Group reuse the ticketing engine for other clients, and must MnM branding
   and data be removed first?
3. Who owns improvements made for MnM — e.g. a new fulfilment screen — and may
   they be reused?
4. On termination: what data export is provided, in what format, within what
   period, and is the production database then deleted?
5. Who pays for hosting, disks, backups, SMS and M-Pesa fees, and what happens if
   payment lapses (site suspension, data retention)?
6. Domain ownership and transfer procedure.
7. Trademark registration for "MnM Juice Bar" — not evidenced in this repository;
   do not state that it is registered.

## 5. Practical controls already in place

- Secrets live in Render environment variables, not in git.
- Staff and customer data stay in the database; exports are staff-only and
  generated on demand.
- Audit logging records staff actions without passwords or full contact details.
- Backups are owner-controlled files (`npm run db:backup`) and must be stored
  off-host.

## 6. What must not be claimed

- That any assignment, licence or revenue split is agreed.
- That a trademark, business registration or tax status exists.
- That customer traction, revenue or partnership exists.
- That live payments are active — they are deliberately disabled.

Those are owner-supplied facts, not software behaviour.
