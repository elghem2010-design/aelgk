# ElajX (علاجك) — PostgreSQL RLS, Trigger & RPC Integration Test Plan

This document details the reproducible database test plan to be executed against a local Supabase CLI instance (`supabase start` / PostgreSQL 15+) using `pgTAP` before any staging or production deployment.

---

## 1. Prerequisites (For Future Local Database Execution)
- Supabase CLI installed locally (`supabase start`).
- Test runner: `pgTAP` (PostgreSQL test framework extension).
- Execution command: `supabase test db`.

---

## 2. Test Suite Specifications (pgTAP)

### Suite 0: Migration Syntax & Schema Creation
1. **Test 0.1: Clean migration execution**
   - Apply `supabase/migrations/20261019000001_initial_schema.sql` to a fresh database.
   - Assert: Zero syntax errors, zero fatal type-casting errors.
2. **Test 0.2: Extension and schema isolation**
   - Assert: Extensions `uuid-ossp` and `pgcrypto` installed.
   - Assert: Schema `private` created; table `private.order_delivery_secrets` created.
   - Assert: Schema `private` revoked from `PUBLIC`, `anon`, `authenticated`.

### Suite A: Privilege Escalation, RLS & Trigger Enforcement
1. **Test A.1: Anonymous user denied access to private data**
   - Connect as `anon`.
   - `SELECT count(*) FROM public.profiles;` -> 0 rows.
   - `SELECT count(*) FROM public.orders;` -> 0 rows.
   - `SELECT count(*) FROM private.order_delivery_secrets;` -> Permission denied (schema revoked).
2. **Test A.2: Trigger and RLS block courier from self-approving on INSERT**
   - Connect as authenticated courier applicant.
   - `INSERT INTO public.courier_profiles (user_id, vehicle_type, national_id_number, verification_status) VALUES (auth.uid(), 'motorcycle', '29010101234567', 'verified');`
   - Assert: Aborted with trigger exception: `"Couriers cannot self-verify on registration. Initial status must be pending."` and rejected by RLS `WITH CHECK`.
   - `INSERT INTO public.courier_profiles (user_id, vehicle_type, national_id_number, verification_status, verified_by) VALUES (auth.uid(), 'motorcycle', '29010101234567', 'pending', auth.uid());`
   - Assert: Aborted with trigger exception: `"Only platform administrators can set courier verification metadata"`.
3. **Test A.3: Trigger blocks courier from mutating status or national ID on UPDATE**
   - Connect as authenticated courier.
   - `UPDATE public.courier_profiles SET verification_status = 'verified' WHERE user_id = auth.uid();`
   - Assert: Aborted with trigger exception: `"Only platform administrators can modify courier verification status..."`.
   - `UPDATE public.courier_profiles SET national_id_number = '99999999999999' WHERE user_id = auth.uid();`
   - Assert: Aborted with trigger exception: `"Only platform administrators can modify courier national ID..."`.
4. **Test A.4: Trigger blocks pharmacy manager from self-approving or mutating license**
   - Connect as authenticated pharmacy manager.
   - `UPDATE public.pharmacies SET verification_status = 'verified' WHERE id = my_pharmacy_id;`
   - Assert: Aborted with trigger exception: `"Only platform administrators can modify pharmacy verification status..."`.
   - `UPDATE public.pharmacies SET license_number = 'LIC-MUTATED' WHERE id = my_pharmacy_id;`
   - Assert: Aborted with trigger exception: `"Only platform administrators can modify pharmacy license..."`.
5. **Test A.5: Administrator authorized to modify protected fields**
   - Connect as administrator (`user_roles.role = 'admin'` or `service_role`).
   - `UPDATE public.pharmacies SET verification_status = 'verified' WHERE id = test_pharmacy_id;`
   - Assert: Successfully updates row.

### Suite B: Secret Isolation, OTP Concurrency & Rejection Sampling
1. **Test B.1: Courier cannot read delivery OTP hash or salt**
   - Connect as assigned courier.
   - `SELECT * FROM public.orders WHERE id = assigned_order_id;`
   - Assert: Columns `otp_hash` and `otp_salt` do not exist on `public.orders`.
   - `SELECT * FROM private.order_delivery_secrets;`
   - Assert: Permission denied (error 42501).
2. **Test B.2: Cryptographic OTP generation syntax & range**
   - Execute `public.create_order_from_accepted_request(request_id)`.
   - Inspect generated secret in `private.order_delivery_secrets`.
   - Assert: Secret generated without SQL error, salt is 32-char hex, hash is 64-char sha256.
3. **Test B.3: OTP verification consumes secret and blocks replay**
   - Execute `public.verify_delivery_otp(order_id, correct_otp);` -> Returns `true`.
   - `SELECT status FROM public.orders WHERE id = order_id;` -> `'delivered'`.
   - `SELECT is_consumed, otp_hash FROM private.order_delivery_secrets WHERE order_id = order_id;` -> `true, 'CONSUMED'`.
   - Execute `public.verify_delivery_otp(order_id, correct_otp);` second time -> Fails with `"Delivery OTP has already been consumed (Replay blocked)"`.
4. **Test B.4: Anti-Brute-Force lockout**
   - Submit wrong OTP 5 consecutive times.
   - Assert: 5th failure locks secret. Subsequent calls fail with `"Max OTP attempts exceeded. Locked out."`.
5. **Test B.5: Expired OTP rejection**
   - Update `expires_at = now() - interval '1 minute'` in `private.order_delivery_secrets`.
   - Call `public.verify_delivery_otp(order_id, correct_otp);`
   - Assert: Fails with `"Delivery OTP has expired"`.

### Suite C: Multi-Item Alternative Mapping & Price Integrity
1. **Test C.1: Multi-item alternative price isolation using request_item_id**
   - Create request with Item A and Item B.
   - Insert proposed alternative with `request_item_id = item_A_id`, customer accepts.
   - Call `public.confirm_pharmacy_availability` confirming Item B unit price.
   - Call `public.create_order_from_accepted_request(request_id)`.
   - Assert: `order_items` for Item A has alternative catalog ID and price; Item B preserves original medicine and confirmed price.
2. **Test C.2: Identical catalog items isolation**
   - Create request with two line items having identical catalog ID.
   - Bind alternative specifically to Item 1 via `request_item_id`.
   - Convert to order.
   - Assert: Item 1 converted to alternative; Item 2 preserves original item identity.
3. **Test C.3: Partial unique index blocks duplicate accepted alternatives**
   - Attempt to insert second accepted alternative for same `request_item_id`.
   - Assert: Aborted with unique constraint violation on `idx_unique_accepted_alternative_per_item`.
4. **Test C.4: Missing pharmacy confirmation blocks order creation**
   - Create request where pharmacy has not confirmed unit price.
   - Call `public.create_order_from_accepted_request(request_id)`.
   - Assert: Fails with exception `"Pharmacy-confirmed price missing"`.
5. **Test C.5: Unconfirmed delivery fee blocks conversion**
   - Create request with null `confirmed_delivery_fee_egp`.
   - Assert: Fails with exception `"Fulfilling pharmacy has not confirmed delivery fee"`.

### Suite D: Lifecycle Operations, Courier Assignment & Audit Trail
1. **Test D.1: Courier assignment by pharmacy staff**
   - Call `public.assign_courier_to_order(order_id, verified_courier_id);`
   - Assert: `orders.courier_id` updated, status is `'assigned_to_courier'`.
   - Assert: Event `'assigned'` recorded in `public.delivery_events`.
2. **Test D.2: Unassigned courier cannot move order to in_transit**
   - Connect as Courier X on order assigned to Courier Y.
   - Call `public.transition_order_status(order_id, 'in_transit');`
   - Assert: Fails with unauthorized exception.
3. **Test D.3: Courier cannot forge 'delivered' event directly**
   - Connect as assigned courier.
   - `INSERT INTO public.delivery_events (order_id, courier_id, event_type) VALUES (order_id, courier_id, 'delivered');`
   - Assert: Rejected with RLS `WITH CHECK` violation (`event_type <> 'delivered'`).
4. **Test D.4: Direct client mutations to orders blocked**
   - Attempt `INSERT INTO public.orders (...)` as authenticated client.
   - Assert: Rejected with `WITH CHECK (false)`.
   - Attempt `UPDATE public.orders SET status = 'delivered' WHERE id = order_id;`
   - Assert: Rejected with `USING (false)`.

---

## 3. Current Execution Status
- **PostgreSQL Database Status:** PENDING DATABASE PROVISIONING.
- **Database Migrations Run:** 0 (No remote or local database has been contacted).
- **In-Memory TypeScript Unit Tests:** 86 passing assertions (`scripts/verify-integrity.ts`).
- **Confirmation:** The above integration suites represent specifications for future pgTAP execution once a local PostgreSQL test runner is provisioned. They must NOT be claimed as passed until executed against PostgreSQL.

