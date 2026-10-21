# ElajX (علاجك) — Security Model & Authorization Architecture

## 1. Zero-Trust Client Principles

In health-tech systems handling medicine requests, clinical alternatives, and delivery logistics, the client browser must be treated as completely untrusted:
1. **Never Trust Client-Supplied Roles:** User roles (`customer`, `pharmacy_staff`, `courier`, `admin`) are stored in an authoritative backend table (`user_roles`) and verified through trusted database functions. Client-side profile metadata is strictly cosmetic and ignored by security checks.
2. **Never Trust Client-Supplied Prices:** The final price of any order is strictly computed or locked on the server/database based on verified catalog caps and pharmacy-confirmed offer records. Catalog data is never treated as confirmed stock.
3. **No Direct Client Mutation of Order States:** Orders and requests cannot be mutated to arbitrary states (such as `delivered` or `confirmed`) by direct client table updates. State transitions must pass through authorized server-side database functions (`transition_order_status()`, `create_order_from_accepted_request()`, `verify_delivery_otp()`, `assign_courier_to_order()`) that validate transition prerequisites inside a transaction.
4. **Tenant Isolation:** Pharmacy staff can never read requests or orders assigned to another pharmacy. Couriers can only view delivery details for orders assigned directly to them.
5. **Least Privilege & Role Immutability:** Users cannot assign themselves roles or modify protected role assignments.
6. **No Self-Verification via Dedicated BEFORE UPDATE Database Triggers:** Couriers cannot approve their own verification status or mutate national IDs; pharmacy managers cannot self-approve their own pharmacy licenses or alter commercial registers. This column-level protection is enforced authoritatively by PostgreSQL triggers (`trg_pharmacies_protect_verification` and `trg_courier_protect_verification`) comparing `OLD` and `NEW` row values directly, rather than relying on brittle same-table subqueries in RLS.

---

## 2. Comprehensive Row Level Security (RLS) & Trigger Matrix

Every application table in PostgreSQL has `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;` enabled.

| Table | SELECT Policy | INSERT Policy | UPDATE Policy & Trigger Enforcement | DELETE Policy |
| :--- | :--- | :--- | :--- | :--- |
| `profiles` | Own profile (`id = auth.uid()`) OR Admin | User on signup (`id = auth.uid()`) | Own profile (name, phone) | Disallowed (Soft-deactivate) |
| `user_roles` | Own role (`user_id = auth.uid()`) OR Admin | Admin only | Admin only | Admin only |
| `pharmacies` | Verified pharmacies: Public active status; Admin: All | Admin only | Primary Manager OR Admin. **Enforced by `trg_pharmacies_protect_verification`**: Non-admin mutations of `verification_status`, `license_number`, `commercial_register`, `verified_by`, `verified_at` raise an exception. | Disallowed |
| `pharmacy_staff` | Assigned Pharmacy Staff OR Admin | Pharmacy Manager OR Admin | Disallowed | Disallowed |
| `courier_profiles` | Own profile (`user_id = auth.uid()`) OR Admin | User on registration (`WITH CHECK (public.is_admin() OR (user_id = auth.uid() AND verification_status = 'pending'))`). **Enforced by `trg_courier_protect_verification`**: Non-admin setting `verification_status <> 'pending'` or non-null verification metadata on INSERT raises an exception. | Courier OR Admin. **Enforced by `trg_courier_protect_verification`**: Non-admin mutations of `verification_status`, `national_id_number`, `verified_by`, `verified_at` raise an exception. | Disallowed |
| `medicine_catalog` | All authenticated & public users | Admin only | Admin only | Admin only |
| `customer_addresses`| Owner customer only (`customer_id = auth.uid()`) OR Admin | Owner customer only (`WITH CHECK (customer_id = auth.uid())`) | Owner customer only (`WITH CHECK (customer_id = auth.uid())`) | Owner customer only |
| `medicine_requests` | Requesting Customer OR Assigned Pharmacy Staff OR Admin | Authenticated Customer only (`WITH CHECK (customer_id = auth.uid())`) | Customer (cancel only if pre-order) OR RPCs | Disallowed |
| `request_items` | Customer of parent request OR Assigned Pharmacy Staff OR Admin | Customer of parent request (`customer_id = auth.uid()`) | Disallowed | Disallowed |
| `proposed_alternatives` | Requesting Customer OR Proposing Pharmacy Staff OR Admin | Proposing Pharmacy Staff (must belong to assigned pharmacy, and `request_item_id` must belong to parent request) | Disallowed via direct client (Trusted RPC `respond_to_alternative` only) | Disallowed |
| `orders` | Customer (own orders) OR Fulfilling Pharmacy Staff OR Assigned Courier OR Admin | **Disallowed via direct client API** (Trusted RPC `create_order_from_accepted_request` only) | **Disallowed via direct client API** (Trusted RPC `transition_order_status` only) | Disallowed |
| `order_items` | Viewer of parent order (Customer, Fulfilling Pharmacy, Courier, Admin) | **Disallowed via direct client API** (Trusted RPC only) | Disallowed | Disallowed |
| `delivery_events` | Assigned Courier OR Customer (own order) OR Fulfilling Pharmacy OR Admin | Assigned Courier (`event_type <> 'delivered'`; delivered events recorded exclusively by `verify_delivery_otp`) | Disallowed (Append-only) | Disallowed |
| `audit_logs` | Admin only | **Disallowed via direct client API** (System trigger or internal RPC only) | Disallowed (Immutable) | Disallowed (Immutable) |
| `private.order_delivery_secrets` | **Inaccessible to all application roles** (Revoked from `PUBLIC, anon, authenticated`) | **Disallowed via direct client API** | **Disallowed via direct client API** | **Disallowed via direct client API** |

---

## 3. Trusted Database Functions (RPC Architecture)

Direct client table mutations on sensitive workflows are blocked by RLS. The following operations **MUST ONLY** be executed via PostgreSQL `SECURITY DEFINER` functions with `SET search_path = public, pg_temp;` and strict authorization checks:

### 3.1 `start_pharmacy_review(p_request_id UUID, p_pharmacy_id UUID)`
- **Caller:** Verified pharmacy staff of `p_pharmacy_id`.
- **Precondition:** Request is in `'submitted'` state.
- **Action:** Assigns pharmacy and advances status to `'under_pharmacy_review'`.

### 3.2 `confirm_pharmacy_availability(p_request_id UUID, p_items_pricing JSONB, p_delivery_fee_egp NUMERIC)`
- **Caller:** Verified pharmacy staff of the assigned pharmacy.
- **Precondition:** Request is `'under_pharmacy_review'`.
- **Action:** Confirms real-time shelf stock and actual selling prices for original medicine items, records pharmacy delivery fee, and transitions status to `'availability_confirmed'`. Never fabricates prices.

### 3.3 `respond_to_alternative(p_alternative_id UUID, p_accept BOOLEAN)`
- **Caller:** Customer owning the request.
- **Precondition:** Request is `'alternative_proposed'`, alternative is `'pending_customer'`, and offer is not expired.
- **Action:** If accept $\rightarrow$ `'accepted'`. Request advances to `'availability_confirmed'` when all proposals are resolved. If decline $\rightarrow$ `'declined'`, request transitions to `'cancelled'`.

### 3.4 `create_order_from_accepted_request(p_request_id UUID)`
- **Caller:** Customer owning the request.
- **Preconditions:**
  - Status is `'availability_confirmed'`.
  - Delivery fee explicitly confirmed by pharmacy.
  - Multi-item matching: each line item is matched specifically to its corresponding accepted alternative via `request_item_id = v_item.id`; non-alternative items must have pharmacy-confirmed unit prices.
  - Partial unique index `idx_unique_accepted_alternative_per_item` guarantees at most one accepted alternative per line item.
  - Single order guard: `orders.request_id UNIQUE` enforced.
- **Action:** Inserts order and order items atomically, generates uniform 6-digit OTP via rejection sampling, stores salt/hash in `private.order_delivery_secrets`, transitions request to `'converted_to_order'`, logs audit.

### 3.5 `assign_courier_to_order(p_order_id UUID, p_courier_id UUID)`
- **Caller:** Fulfilling pharmacy staff or admin.
- **Preconditions:** Order status is `'ready_for_pickup'`, courier is verified.
- **Action:** Sets `orders.courier_id = p_courier_id` and status `'assigned_to_courier'`. Records `'assigned'` delivery event.

### 3.6 `transition_order_status(p_order_id UUID, p_next_status order_status_type, p_notes TEXT)`
- **Caller:** Strict role-based transition matrix (Pharmacy for preparation/pickup; assigned courier for in-transit/failure).
- **Action:** Validates lifecycle prerequisites and advances order state inside row lock (`FOR UPDATE`).

### 3.7 `verify_delivery_otp(p_order_id UUID, p_plaintext_otp TEXT)`
- **Caller:** Assigned courier.
- **Preconditions:**
  - Order status is `'in_transit'`.
  - Secrets read from `private.order_delivery_secrets` (courier cannot access this table directly).
  - Secret is not consumed, attempts $< 5$, timestamp $< expires\_at$.
- **Action:**
  - If match: marks order `'delivered'`, marks secret `is_consumed = true` and `otp_hash = 'CONSUMED'`, records `'delivered'` event in `delivery_events`.
  - If mismatch: increments `attempts_count` in private table.

---

## 4. Secure Delivery OTP Architecture

1. **Isolation from Courier:**
   - OTP hash and salt are stored in `private.order_delivery_secrets`.
   - The table is revoked from `anon, authenticated, PUBLIC`.
   - Couriers querying `public.orders` receive zero cryptographic material, preventing offline dictionary attacks.
2. **Entropy Generation & Rejection Sampling (Zero Modulo Bias):**
   - Generated using 32-bit cryptographically secure random integers from `gen_random_bytes(4)` and `get_byte()`:
     ```sql
     LOOP
       v_raw_bytes := gen_random_bytes(4);
       v_random_int := (get_byte(v_raw_bytes, 0)::bigint * 16777216) +
                       (get_byte(v_raw_bytes, 1)::bigint * 65536) +
                       (get_byte(v_raw_bytes, 2)::bigint * 256) +
                       (get_byte(v_raw_bytes, 3)::bigint);
       IF v_random_int < 4294800000 THEN
         v_otp_code := (100000 + (v_random_int % 900000))::text;
         EXIT;
       END IF;
     END LOOP;
     ```
### 3.8 Administrator Authorization Function: `public.is_admin()`
- **Security Mode:** `SECURITY DEFINER` with `SET search_path = public, pg_temp;`.
- **Purpose:** Centralized, safe administrator authorization check used across RLS policies, column-protection triggers, and privileged RPC functions.
- **Authorization Branches:**
  1. **Direct Administrative Database Sessions:** Evaluates `session_user IN ('postgres', 'supabase_admin')`.
     * *PostgreSQL Semantics Rationale:* Must check `session_user` rather than `current_user`. Inside a `SECURITY DEFINER` function, PostgreSQL temporarily switches `current_user` to the function owner (`postgres`). Checking `current_user` would cause every caller to evaluate to `TRUE`. `session_user` preserves the physical connection initiator (which is `authenticator` for PostgREST web traffic and `postgres` for direct DBA sessions).
  2. **Verified Backend Service-Role Requests:** Evaluates `coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'`.
     * *Trust Boundary:* PostgREST sets this GUC configuration variable strictly from cryptographically verified JWT signatures against the platform secret. Clients cannot forge or inject this setting over HTTP.
  3. **Application Platform Administrators:** Evaluates `(auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))`.
     * *Recursion Protection:* `SECURITY DEFINER` enables safely reading `public.user_roles` without triggering infinite recursive RLS policy evaluations.

---

## 4. Delivery Proof (OTP Handshake Architecture)

1. **Cryptographic Entropy & Zero Modulo Bias:**
   - 32-bit CSPRNG from `gen_random_bytes(4)` rejection-sampled at 4,294,800,000 (largest multiple of 900,000 $\le 2^{32}$).
   - Spans all 900,000 combinations in range $[100000, 999999]$ uniformly with zero modulo bias.
2. **Salted Hash Isolation:**
   - Plaintext OTP is hashed with high-entropy salt: $\text{SHA-256}(\text{OTP} \parallel \text{salt})$ and stored strictly in the private table `private.order_delivery_secrets`.
3. **Single-Use Consumption & Replay Prevention:**
   - Hash is overwritten with `'CONSUMED'` immediately upon delivery.
4. **Delivery Pending:**
   - Plaintext OTP delivery to customer is documented as pending SMS provider configuration.

---

## 5. Unresolved Owner Business Decisions (Explicitly Blocked in Schema)

The following parameters must be formally decided before production deployment:
1. **Delivery Fee Policy:** Whether delivery fees are determined by individual pharmacies, distance-based, or fixed by platform policy. (The schema requires explicit pharmacy confirmation per request; no arbitrary 25 EGP default is enforced).
2. **Offer Expiry Duration:** Whether alternative offers expire after a fixed duration (e.g. 12h, 24h, 48h) or based on pharmacy business hours.
3. **SMS Gateway for Egypt (`+20`):** Which certified SMS gateway will deliver the delivery OTP to patient mobile devices.

---

## 6. Testing Boundaries & Verification Scope

- **In-Memory TypeScript Unit Tests (`scripts/verify-integrity.ts`):** 86 assertions passing in Node.js memory. Validates state transition graphs, mathematical totals, OTP validation algorithms, multi-item request-to-order mapping, courier INSERT/UPDATE protection simulation, PostgreSQL `SECURITY DEFINER` vs. `session_user` authorization contracts, and static database schema invariants.
- **PostgreSQL Database Verification:** Real PostgreSQL execution (triggers, RLS policies, SQL functions, and extension resolution) requires running the pgTAP test suite against a local database instance (`supabase test db`). Database execution is pending and has not been executed.

