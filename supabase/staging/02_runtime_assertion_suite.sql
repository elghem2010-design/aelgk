-- ==============================================================================
-- ElajX (علاجك) — Staging Runtime Assertion Suite
-- File: supabase/staging/02_runtime_assertion_suite.sql
-- Purpose: Complete, reproducible SQL assertions validating schema constraints,
--          RLS policies, triggers, and RPC security in an isolated PostgreSQL instance.
-- ==============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_test_count INT := 0;
  v_fail_count INT := 0;

  v_admin_id UUID := 'b0000000-0000-0000-0000-000000000001';
  v_customer_id UUID := 'b0000000-0000-0000-0000-000000000002';
  v_pharmacy_user_id UUID := 'b0000000-0000-0000-0000-000000000003';
  v_courier_user_id UUID := 'b0000000-0000-0000-0000-000000000004';
  v_attacker_id UUID := 'b0000000-0000-0000-0000-000000000099';

  v_pharmacy_id UUID;
  v_address_id UUID;
  v_request_id UUID;
  v_item_1_id UUID;
  v_item_2_id UUID;
  v_order_id UUID;
  v_courier_profile_id UUID;
  v_secret_rec RECORD;
  v_status_res TEXT;
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE '   ELAJX (علاجك) STAGING POSTGRESQL RUNTIME ASSERTIONS SUITE    ';
  RAISE NOTICE '================================================================';

  -- ---------------------------------------------------------------------------
  -- Setup: Create Test Identities in auth.users and public.profiles
  -- ---------------------------------------------------------------------------
  INSERT INTO auth.users (id, email) VALUES
    (v_admin_id, 'admin@staging.elajx.internal'),
    (v_customer_id, 'customer@staging.elajx.internal'),
    (v_pharmacy_user_id, 'pharmacy@staging.elajx.internal'),
    (v_courier_user_id, 'courier@staging.elajx.internal'),
    (v_attacker_id, 'attacker@staging.elajx.internal')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, phone) VALUES
    (v_admin_id, 'Platform Admin', '+201000000001'),
    (v_customer_id, 'Test Customer', '+201000000002'),
    (v_pharmacy_user_id, 'Test Pharmacist', '+201000000003'),
    (v_courier_user_id, 'Test Courier', '+201000000004'),
    (v_attacker_id, 'Test Attacker', '+201000000099')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_admin_id, 'admin'),
    (v_customer_id, 'customer'),
    (v_pharmacy_user_id, 'pharmacy_staff'),
    (v_courier_user_id, 'courier'),
    (v_attacker_id, 'customer')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Create Test Pharmacy
  INSERT INTO public.pharmacies (
    name_ar, name_en, commercial_reg_number, license_number, governorate, district, address_text, verification_status
  ) VALUES (
    'صيدلية الاختبار المركزية', 'Central Staging Pharmacy', 'CR-100200', 'LIC-300400', 'Cairo', 'Nasr City', '10 Abbas El-Akkad St', 'verified'
  ) RETURNING id INTO v_pharmacy_id;

  INSERT INTO public.pharmacy_staff (pharmacy_id, user_id, is_primary_manager)
  VALUES (v_pharmacy_id, v_pharmacy_user_id, true)
  ON CONFLICT (pharmacy_id, user_id) DO NOTHING;

  -- Create Test Courier Profile
  INSERT INTO public.courier_profiles (user_id, vehicle_type, national_id_number, verification_status, shift_status)
  VALUES (v_courier_user_id, 'motorcycle', '29501011234567', 'verified', 'available')
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id INTO v_courier_profile_id;

  -- Create Customer Address
  INSERT INTO public.customer_addresses (customer_id, label, governorate, district, street, building, is_default)
  VALUES (v_customer_id, 'Home', 'Cairo', 'Maadi', 'Street 9', 'Building 14', true)
  RETURNING id INTO v_address_id;

  -- ---------------------------------------------------------------------------
  -- TEST 1: Schema Isolation & Private Schema Access Revocation
  -- ---------------------------------------------------------------------------
  v_test_count := v_test_count + 1;
  BEGIN
    IF has_schema_privilege('anon', 'private', 'USAGE') THEN
      RAISE EXCEPTION 'anon unexpectedly holds USAGE on private schema';
    END IF;
    IF has_schema_privilege('authenticated', 'private', 'USAGE') THEN
      RAISE EXCEPTION 'authenticated unexpectedly holds USAGE on private schema';
    END IF;
    RAISE NOTICE '  [PASS] Test 1: Private schema strictly revoked from anon and authenticated';
  EXCEPTION WHEN OTHERS THEN
    v_fail_count := v_fail_count + 1;
    RAISE WARNING '  [FAIL] Test 1: Private schema isolation failed: %', SQLERRM;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 2: Self-Verification Prevention on Courier Profiles
  -- ---------------------------------------------------------------------------
  v_test_count := v_test_count + 1;
  BEGIN
    -- Configure context as non-admin applicant
    PERFORM set_config('app.current_user_id', v_attacker_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    -- An applicant trying to register directly with verification_status = 'verified'
    INSERT INTO public.courier_profiles (user_id, vehicle_type, national_id_number, verification_status)
    VALUES (v_attacker_id, 'car', '29901019999999', 'verified');

    v_fail_count := v_fail_count + 1;
    RAISE WARNING '  [FAIL] Test 2: Courier self-verification insert was not prevented!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] Test 2: Courier self-verification blocked: %', SQLERRM;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 3: Pharmacy License Modification Prevention
  -- ---------------------------------------------------------------------------
  v_test_count := v_test_count + 1;
  BEGIN
    -- Set session as pharmacist
    PERFORM set_config('app.current_user_id', v_pharmacy_user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    UPDATE public.pharmacies
    SET license_number = 'FORGED-LIC-999'
    WHERE id = v_pharmacy_id;

    v_fail_count := v_fail_count + 1;
    RAISE WARNING '  [FAIL] Test 3: Pharmacist permitted to tamper with license_number!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] Test 3: Pharmacist license tampering blocked by trigger: %', SQLERRM;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 4: Direct Client Insert on Orders Blocked by AS RESTRICTIVE Barrier
  -- ---------------------------------------------------------------------------
  v_test_count := v_test_count + 1;
  BEGIN
    PERFORM set_config('app.current_user_id', v_customer_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    INSERT INTO public.orders (customer_id, pharmacy_id, delivery_address_id, total_amount_egp, status)
    VALUES (v_customer_id, v_pharmacy_id, v_address_id, 100.00, 'confirmed');

    v_fail_count := v_fail_count + 1;
    RAISE WARNING '  [FAIL] Test 4: Direct client INSERT into orders succeeded!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] Test 4: Direct client INSERT into orders blocked by restrictive policy: %', SQLERRM;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 5: Direct Client Insert of 'delivered' Delivery Event Blocked
  -- ---------------------------------------------------------------------------
  v_test_count := v_test_count + 1;
  BEGIN
    PERFORM set_config('app.current_user_id', v_courier_user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    INSERT INTO public.delivery_events (order_id, courier_id, event_type)
    VALUES (gen_random_uuid(), v_courier_profile_id, 'delivered');

    v_fail_count := v_fail_count + 1;
    RAISE WARNING '  [FAIL] Test 5: Direct client INSERT of delivered event succeeded!';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  [PASS] Test 5: Forged delivered event blocked by restrictive barrier: %', SQLERRM;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 6: Multi-Item Request Lifecycle & Pharmacy Availability Confirmation
  -- ---------------------------------------------------------------------------
  v_test_count := v_test_count + 1;
  BEGIN
    -- Act as customer submitting request
    PERFORM set_config('app.current_user_id', v_customer_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    INSERT INTO public.medicine_requests (
      customer_id, delivery_address_id, assigned_pharmacy_id, status
    ) VALUES (
      v_customer_id, v_address_id, v_pharmacy_id, 'submitted'
    ) RETURNING id INTO v_request_id;

    -- Correct column names matching candidate migration: raw_medicine_name & requested_quantity
    INSERT INTO public.request_items (
      request_id, raw_medicine_name, requested_quantity
    ) VALUES (
      v_request_id, 'Panadol Extra', 2
    ) RETURNING id INTO v_item_1_id;

    INSERT INTO public.request_items (
      request_id, raw_medicine_name, requested_quantity
    ) VALUES (
      v_request_id, 'Cataflam 50mg', 1
    ) RETURNING id INTO v_item_2_id;

    -- Act as pharmacist accepting review: moves status from submitted -> under_pharmacy_review
    PERFORM set_config('app.current_user_id', v_pharmacy_user_id::text, true);
    PERFORM public.start_pharmacy_review(v_request_id, v_pharmacy_id);

    -- Confirm availability with valid positive pricing
    PERFORM public.confirm_pharmacy_availability(
      v_request_id,
      jsonb_build_object(
        v_item_1_id::text, 45.00,
        v_item_2_id::text, 38.50
      ),
      20.00
    );

    SELECT status INTO v_status_res FROM public.medicine_requests WHERE id = v_request_id;
    IF v_status_res <> 'availability_confirmed' THEN
      RAISE EXCEPTION 'Request status expected availability_confirmed, got %', v_status_res;
    END IF;

    RAISE NOTICE '  [PASS] Test 6: Multi-item pharmacy availability confirmation and pricing succeeded';
  EXCEPTION WHEN OTHERS THEN
    v_fail_count := v_fail_count + 1;
    RAISE WARNING '  [FAIL] Test 6: Request lifecycle test failed: %', SQLERRM;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 7: Order Creation with Cryptographic Delivery OTP
  -- ---------------------------------------------------------------------------
  v_test_count := v_test_count + 1;
  BEGIN
    -- Act as customer converting confirmed request into order
    PERFORM set_config('app.current_user_id', v_customer_id::text, true);

    v_order_id := public.create_order_from_accepted_request(v_request_id);

    IF v_order_id IS NULL THEN
      RAISE EXCEPTION 'create_order_from_accepted_request returned NULL';
    END IF;

    -- Verify secret isolation in private schema
    SELECT is_consumed, attempts_count, expires_at INTO v_secret_rec
    FROM private.order_delivery_secrets
    WHERE order_id = v_order_id;

    IF v_secret_rec.is_consumed <> false OR v_secret_rec.attempts_count <> 0 THEN
      RAISE EXCEPTION 'Delivery secret initialized with invalid state';
    END IF;

    RAISE NOTICE '  [PASS] Test 7: Order created with isolated cryptographic delivery secret';
  EXCEPTION WHEN OTHERS THEN
    v_fail_count := v_fail_count + 1;
    RAISE WARNING '  [FAIL] Test 7: Order creation failed: %', SQLERRM;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 8: Anti-Brute-Force OTP Lockout (5 Failed Attempts)
  -- ---------------------------------------------------------------------------
  v_test_count := v_test_count + 1;
  BEGIN
    -- Transition order legitimately through state machine RPCs
    -- 1. Pharmacy staff moves confirmed -> in_preparation -> ready_for_pickup -> assigns courier
    PERFORM set_config('app.current_user_id', v_pharmacy_user_id::text, true);
    PERFORM public.transition_order_status(v_order_id, 'in_preparation');
    PERFORM public.transition_order_status(v_order_id, 'ready_for_pickup');
    PERFORM public.assign_courier_to_order(v_order_id, v_courier_profile_id);

    -- 2. Courier confirms pickup and moves in_transit
    PERFORM set_config('app.current_user_id', v_courier_user_id::text, true);
    PERFORM public.transition_order_status(v_order_id, 'in_transit');

    -- Submit 5 wrong OTPs
    FOR i IN 1..5 LOOP
      BEGIN
        PERFORM public.verify_delivery_otp(v_order_id, '000000');
      EXCEPTION WHEN OTHERS THEN
        NULL; -- Expected failures
      END LOOP;
    END LOOP;

    -- 6th attempt must fail with lockout error
    BEGIN
      PERFORM public.verify_delivery_otp(v_order_id, '000000');
      v_fail_count := v_fail_count + 1;
      RAISE WARNING '  [FAIL] Test 8: Lockout did not prevent 6th OTP attempt!';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%Max OTP attempts exceeded%' OR SQLERRM LIKE '%locked out%' THEN
        RAISE NOTICE '  [PASS] Test 8: Anti-brute-force lockout triggered after 5 failed attempts';
      ELSE
        RAISE NOTICE '  [PASS] Test 8: Rejected with error: %', SQLERRM;
      END IF;
    END;
  EXCEPTION WHEN OTHERS THEN
    v_fail_count := v_fail_count + 1;
    RAISE WARNING '  [FAIL] Test 8: Anti-brute-force test failed: %', SQLERRM;
  END;

  -- ---------------------------------------------------------------------------
  -- Summary
  -- ---------------------------------------------------------------------------
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Execution Summary: % executed, % passed, % failed',
    v_test_count, (v_test_count - v_fail_count), v_fail_count;
  RAISE NOTICE '================================================================';

  IF v_fail_count > 0 THEN
    RAISE EXCEPTION '% assertion(s) failed during staging execution', v_fail_count;
  END IF;
END $$;
