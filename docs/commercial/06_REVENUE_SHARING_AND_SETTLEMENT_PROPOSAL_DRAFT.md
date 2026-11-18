# DRAFT — Revenue-Sharing and Settlement Proposal

**Status:** Discussion draft. Not an offer, not a binding revenue share, no settlement account agreed.  
**Date:** 18 November 2026

## 1. Purpose

This paper sets out how ticket revenue could be split and settled. It separates the **current technical configuration** from the **commercial terms the parties must agree**.

## 2. Current technical configuration (not a contractual entitlement)

The order engine currently uses a launch configuration:

- Customer selling price = original organiser price + **35% markup**.
- Of the original price, **25%** is attributed to MnM and **10%** to AD Group.
- The identity `selling = original + MnM + AD` is enforced in integer minor units.

This configuration is visible in `src/money.ts` and tested in `tests/money.test.ts`. It is labelled in the code/docs as a proposed launch configuration pending owner confirmation. **It must not be treated as an agreed commercial term until both parties sign a schedule.**

## 3. Decisions required

| Decision | Options | Status |
|---|---|---|
| Who bears the 35% markup | Customer / organiser / shared | `[TO BE AGREED]` |
| Split basis | Original price / selling price / net of fees | `[TO BE AGREED]` |
| Payment provider fees | Deducted before split / borne by one party | `[TO BE AGREED]` |
| Refund funding | MnM / organiser / pro-rata | `[TO BE AGREED]` |
| Chargeback funding | MnM / organiser / platform | `[TO BE AGREED]` |
| Settlement account | MnM account / escrow / split payouts | `[TO BE AGREED]` |
| Payout timing | Per event / weekly / monthly | `[TO BE AGREED]` |
| Minimum payout | `[TO BE AGREED]` | `[TO BE AGREED]` |
| Tax/eTIMS treatment | `[TO BE AGREED]` | `[TO BE AGREED]` |
| Reporting format | CSV / dashboard / statement | `[TO BE AGREED]` |

## 4. Proposed settlement mechanics (for discussion)

1. Customer pays into the approved collection account.
2. The platform records order-level original, MnM, AD and selling amounts at the time of sale.
3. Refunds, chargebacks and provider fees are posted as separate adjustments, not silently netted.
4. A settlement statement is produced per event or period, showing gross, refunds, fees, net and each party's share.
5. Both parties reconcile the statement against the provider/bank statement.
6. Payout is made only after the reconciliation is accepted.
7. Discrepancies are logged and resolved before the next payout.

## 5. Controls

- No manual editing of settled orders to change commission.
- Refunds require staff action and are audited.
- Event cancellation queues refunds; it does not pretend money has moved.
- Settlement reports must be reproducible from order/payment records.
- Access to settlement data is restricted to authorised roles.

## 6. Open questions

- Is the 35% markup acceptable to organisers and customers?
- Does the organiser receive the original price, or a different share?
- Who funds refunds if an event is cancelled after payout?
- Are provider fees shared or deducted from gross?
- Which legal entity collects and remits taxes?
- What happens to unclaimed refunds or unclaimed payouts?

## 7. Recommendation

Do not activate live collection until the parties have signed:
1. a revenue-share schedule;
2. a refund/chargeback funding rule;
3. a settlement and reconciliation procedure;
4. the collection account and signatory arrangement.

Until then, keep `PAYMENT_PROVIDER=dev` and label all simulated payments clearly.
