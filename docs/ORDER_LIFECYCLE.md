# ElajX (علاجك) — Order Lifecycle & Fulfillment Specification

## 1. Lifecycle Overview

The ElajX order workflow is designed around pharmaceutical safety, price verification, and chain-of-custody tracking. Every order originates as a customer inquiry or request and must be validated by a licensed Egyptian pharmacy before becoming a legally binding order.

---

## 2. Detailed Lifecycle Stages

```
                       +-----------------------+
                       | 1. Customer Request   |
                       +-----------------------+
                                   |
                                   v
                       +-----------------------+
                       | 2. Pharmacy Routing   |
                       +-----------------------+
                                   |
                 +-----------------+-----------------+
                 |                                   |
                 v (Stock Verified)                  v (Out of Stock / Substitution)
    +--------------------------+        +--------------------------+
    | 3A. Direct Availability  |        | 3B. Alternative Proposed |
    |     & Price Lock         |        |     (Generic / Similar)  |
    +--------------------------+        +--------------------------+
                 |                                   |
                 |                     +-------------+-------------+
                 |                     |                           |
                 |                     v (Customer Approves)       v (Customer Declines)
                 |        +--------------------------+   +-------------------+
                 |        | 4. Customer Substitution |   | Request Cancelled |
                 |        |    Approval              |   +-------------------+
                 |        +--------------------------+
                 |                     |
                 +----------+----------+
                            |
                            v
               +--------------------------+
               | 5. Order Confirmed       |
               | (Locked Price & Delivery)|
               +--------------------------+
                            |
                            v
               +--------------------------+
               | 6. Pharmacy Preparation  |
               | (Batch & Tamper Seal)    |
               +--------------------------+
                            |
                            v
               +--------------------------+
               | 7. Courier Dispatched    |
               +--------------------------+
                            |
                            v
               +--------------------------+
               | 8. Pharmacy Pickup Conf. |
               +--------------------------+
                            |
                            v
               +--------------------------+
               | 9. Delivery Verification |
               | (Secure OTP / Signature) |
               +--------------------------+
                            |
                            v
               +--------------------------+
               | 10. Completed & Audited  |
               +--------------------------+
```

---

## 3. Alternative Proposal Requirements (Egyptian Pharmaceutical Regulations)

In Egyptian pharmacy practice, generic substitution is subject to strict professional standards:
1. **Bioequivalence Criterion:** Proposed alternative must share identical:
   - Active Pharmaceutical Ingredient (API) / Generic Name (INN).
   - Dosage Strength (e.g., 500mg, 10mg/ml).
   - Pharmaceutical Form (e.g., Film-Coated Tablet, Extended Release Capsule, Oral Suspension).
2. **Pharmacist Note & Reason:** The pharmacist must record a clinical reason:
   - `ORIGINAL_OUT_OF_STOCK`: Primary brand unavailable in local market or distributor.
   - `LOWER_COST_GENERIC`: Equivalent Egyptian national product at a lower regulated price.
   - `DISCONTINUED_MANUFACTURER`: Specific packaging retired by manufacturer.
3. **Customer Informed Consent:** The customer must receive:
   - Original requested item vs. proposed item details.
   - Price comparison (Original regulated price vs. Alternative regulated price).
   - Explicit buttons: `Accept Alternative` or `Decline & Cancel Request`.
   - **No order can proceed with a substitution without explicit customer approval.**

---

## 4. Cancellation Rules & Exception Matrix

| Current State | Permitted Initiator | Allowed Action | Consequence |
| :--- | :--- | :--- | :--- |
| `submitted` | Customer, System | Cancel without fee | Request marked `cancelled`; no financial charge |
| `under_pharmacy_review`| Customer, Pharmacy | Cancel / Reject | Request marked `rejected` or `cancelled` |
| `alternative_proposed`| Customer | Decline Alternative | Request terminated cleanly |
| `confirmed` | Customer | Cancel within 5 minutes | Allowed before pharmacy marks `in_preparation` |
| `in_preparation` | Pharmacy, Customer | Exception cancellation | Requires customer care approval |
| `in_transit` | Courier, Customer | Delivery Exception | Order marked `failed_delivery` with documented reason |

### Courier Exception Reasons:
- `CUSTOMER_UNREACHABLE`: Customer did not answer phone or door after 3 attempts.
- `INCORRECT_ADDRESS`: Delivery address non-existent or outside service perimeter.
- `DAMAGED_PARCEL`: Tamper seal broken; parcel returned immediately to fulfilling pharmacy.
- `REFUSAL_AT_DOOR`: Customer refused to accept parcel upon arrival.

---

## 5. Audit & Provenance Records

Every transition records:
- `event_id`: UUID
- `order_id`: UUID
- `previous_state`: String
- `next_state`: String
- `triggered_by`: User UUID & Role
- `reason`: Optional text explanation
- `timestamp`: UTC ISO-8601
