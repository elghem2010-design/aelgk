-- ==============================================================================
-- ElajX (علاجك) — Production-Grade Initial Schema & Hardened RLS Migration
-- Version: 20261019000001_initial_schema.sql
-- Classification: Hardened PostgreSQL Schema with Isolated Secrets & Lifecycle RPCs
-- ==============================================================================

-- Enable UUID & Crypto extensions
-- Schema Portability Strategy:
-- 1. In standard vanilla PostgreSQL, extensions install into the current active schema (usually 'public').
-- 2. In managed Supabase environments, extensions typically reside in the 'extensions' schema.
-- 3. Without connecting to a live database, the exact installation schema cannot be dynamically inspected.
-- 4. Therefore, SECURITY DEFINER functions requiring pgcrypto functions (gen_random_bytes, digest)
--    explicitly configure `search_path = public, extensions, pg_temp;`.
--    This safely resolves extension functions across both standard PostgreSQL and Supabase installations,
--    while keeping `pg_temp` strictly last to block temporary-table spoofing/hijacking.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create private schema for non-public secrets (inaccessible via PostgREST / direct client APIs)
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 0. Enumerated Types
-- -----------------------------------------------------------------------------
CREATE TYPE user_role_type AS ENUM ('customer', 'pharmacy_staff', 'courier', 'admin');
CREATE TYPE pharmacy_status_type AS ENUM ('pending', 'verified', 'suspended');
CREATE TYPE courier_status_type AS ENUM ('pending', 'verified', 'suspended');
CREATE TYPE courier_shift_type AS ENUM ('offline', 'available', 'on_delivery');
CREATE TYPE request_status_type AS ENUM (
  'submitted',
  'under_pharmacy_review',
  'alternative_proposed',
  'availability_confirmed',
  'converted_to_order',
  'rejected',
  'cancelled'
);
CREATE TYPE alternative_status_type AS ENUM ('pending_customer', 'accepted', 'declined', 'expired');
CREATE TYPE order_status_type AS ENUM (
  'confirmed',
  'in_preparation',
  'ready_for_pickup',
  'assigned_to_courier',
  'in_transit',
  'delivered',
  'failed_delivery',
  'cancelled'
);
CREATE TYPE delivery_event_type AS ENUM (
  'assigned',
  'courier_arrived_pharmacy',
  'picked_up',
  'in_transit',
  'arrived_destination',
  'delivered',
  'delivery_failed'
);

-- -----------------------------------------------------------------------------
-- 1. User Profiles & Trusted Role Assignments
-- -----------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) >= 2),
  phone TEXT NOT NULL UNIQUE CHECK (phone ~ '^\+?[0-9]{10,15}$'),
  national_id_masked TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role user_role_type NOT NULL DEFAULT 'customer',
  granted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(user_id, role)
);

-- -----------------------------------------------------------------------------
-- 2. Hardened Security Helper Functions (Fixed search_path & Least Privilege)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT (
    -- 1. Direct administrative database sessions (psql, migrations, maintenance).
    -- Must check session_user rather than current_user: inside a SECURITY DEFINER
    -- function, PostgreSQL switches current_user to the function owner (e.g. postgres),
    -- which would grant universal admin access to any caller if checked with current_user.
    -- session_user preserves the identity of the authenticated connection initiator.
    session_user IN ('postgres', 'supabase_admin') OR

    -- 2. Trusted backend service-role requests via PostgREST.
    -- PostgREST sets request.jwt.claim.role strictly based on cryptographically verified
    -- JWT signatures against the platform JWT_SECRET. Ordinary API clients cannot tamper
    -- with or override this GUC setting.
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' OR

    -- 3. Application platform administrators:
    -- Verified via active admin role assignment in public.user_roles for the authenticated caller.
    -- SECURITY DEFINER is required here to safely query public.user_roles without triggering
    -- recursive RLS policy evaluation on public.user_roles.
    (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    ))
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_user_role(target_user_id UUID)
RETURNS user_role_type AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = target_user_id
    AND (target_user_id = auth.uid() OR public.is_admin())
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.get_user_role(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_pharmacy_staff(check_pharmacy_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pharmacy_staff
    WHERE user_id = auth.uid() AND pharmacy_id = check_pharmacy_id
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.is_pharmacy_staff(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pharmacy_staff(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_courier_id(check_user_id UUID)
RETURNS UUID AS $$
  SELECT id FROM public.courier_profiles
  WHERE user_id = check_user_id
    AND (check_user_id = auth.uid() OR public.is_admin())
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.get_courier_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_courier_id(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Customer Delivery Addresses
-- -----------------------------------------------------------------------------
CREATE TABLE public.customer_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  governorate TEXT NOT NULL,
  district TEXT NOT NULL,
  street TEXT NOT NULL,
  building TEXT NOT NULL,
  floor TEXT,
  apartment TEXT,
  landmark TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- -----------------------------------------------------------------------------
-- 4. Pharmacies & Staff
-- -----------------------------------------------------------------------------
CREATE TABLE public.pharmacies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  commercial_name TEXT NOT NULL,
  license_number TEXT NOT NULL UNIQUE,
  commercial_register TEXT NOT NULL UNIQUE,
  governorate TEXT NOT NULL,
  district TEXT NOT NULL,
  street_address TEXT NOT NULL,
  phone TEXT NOT NULL,
  verification_status pharmacy_status_type NOT NULL DEFAULT 'pending',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE public.pharmacy_staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_primary_manager BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(pharmacy_id, user_id)
);

-- -----------------------------------------------------------------------------
-- 5. Couriers
-- -----------------------------------------------------------------------------
CREATE TABLE public.courier_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  vehicle_type TEXT NOT NULL,
  national_id_number TEXT NOT NULL UNIQUE,
  verification_status courier_status_type NOT NULL DEFAULT 'pending',
  shift_status courier_shift_type NOT NULL DEFAULT 'offline',
  current_zone TEXT NOT NULL,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- -----------------------------------------------------------------------------
-- 6. Medicine Catalog
-- Note: Catalog entries are informative index records; stock and actual selling
-- prices must be confirmed in real-time by a licensed pharmacy.
-- -----------------------------------------------------------------------------
CREATE TABLE public.medicine_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_name_ar TEXT NOT NULL,
  brand_name_en TEXT NOT NULL,
  active_ingredient TEXT NOT NULL,
  dosage_form TEXT NOT NULL,
  strength TEXT NOT NULL,
  pack_size TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  max_regulated_price_egp NUMERIC(10, 2) NOT NULL CHECK (max_regulated_price_egp >= 0),
  requires_prescription BOOLEAN NOT NULL DEFAULT FALSE,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_medicine_catalog_search ON public.medicine_catalog (brand_name_ar, brand_name_en, active_ingredient);

-- -----------------------------------------------------------------------------
-- 7. Medicine Requests & Line Items (With Explicit Pharmacy Confirmation Fields)
-- -----------------------------------------------------------------------------
CREATE TABLE public.medicine_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  delivery_address_id UUID NOT NULL REFERENCES public.customer_addresses(id) ON DELETE RESTRICT,
  status request_status_type NOT NULL DEFAULT 'submitted',
  assigned_pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  confirmed_delivery_fee_egp NUMERIC(10, 2) CHECK (confirmed_delivery_fee_egp IS NULL OR confirmed_delivery_fee_egp >= 0),
  pharmacist_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE public.request_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES public.medicine_requests(id) ON DELETE CASCADE,
  medicine_catalog_id UUID REFERENCES public.medicine_catalog(id) ON DELETE SET NULL,
  raw_medicine_name TEXT NOT NULL,
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
  prescription_attachment_url TEXT,
  customer_notes TEXT,
  -- Explicit pharmacy availability & pricing confirmation (never fabricated)
  confirmed_available BOOLEAN DEFAULT NULL,
  confirmed_unit_price_egp NUMERIC(10, 2) CHECK (confirmed_unit_price_egp IS NULL OR confirmed_unit_price_egp >= 0),
  UNIQUE (request_id, id)
);

-- -----------------------------------------------------------------------------
-- 8. Proposed Bioequivalent Alternatives
-- -----------------------------------------------------------------------------
CREATE TABLE public.proposed_alternatives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL,
  request_item_id UUID NOT NULL,
  original_catalog_id UUID REFERENCES public.medicine_catalog(id),
  proposed_catalog_id UUID NOT NULL REFERENCES public.medicine_catalog(id),
  pharmacist_rationale_ar TEXT NOT NULL CHECK (char_length(trim(pharmacist_rationale_ar)) >= 10),
  original_price_egp NUMERIC(10, 2) NOT NULL CHECK (original_price_egp >= 0),
  proposed_price_egp NUMERIC(10, 2) NOT NULL CHECK (proposed_price_egp >= 0),
  approval_status alternative_status_type NOT NULL DEFAULT 'pending_customer',
  reviewed_by_pharmacist_id UUID NOT NULL REFERENCES public.profiles(id),
  offer_version INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(request_item_id, offer_version),
  -- Composite foreign key guarantees that proposed_alternatives.request_id matches request_items.request_id
  CONSTRAINT fk_proposed_alternatives_request_item
    FOREIGN KEY (request_id, request_item_id)
    REFERENCES public.request_items(request_id, id)
    ON DELETE CASCADE
);

-- At most one accepted alternative per request item
CREATE UNIQUE INDEX idx_unique_accepted_alternative_per_item
  ON public.proposed_alternatives (request_item_id)
  WHERE approval_status = 'accepted';

-- Database Trigger: Enforce original medicine identity and cross-table integrity
CREATE OR REPLACE FUNCTION public.trg_validate_proposed_alternative()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- 1. Fetch referenced request item ensuring request_id match
  SELECT * INTO v_item
  FROM public.request_items
  WHERE id = NEW.request_item_id AND request_id = NEW.request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referenced request item % does not exist in request %', NEW.request_item_id, NEW.request_id;
  END IF;

  -- 2. Validate original medicine identity:
  -- If the request item was catalogued, the proposed alternative MUST specify the exact matching original_catalog_id
  IF v_item.medicine_catalog_id IS NOT NULL THEN
    IF NEW.original_catalog_id IS NULL THEN
      RAISE EXCEPTION 'Proposed alternative must specify original_catalog_id for catalogued request item %', v_item.raw_medicine_name;
    END IF;

    IF NEW.original_catalog_id <> v_item.medicine_catalog_id THEN
      RAISE EXCEPTION 'Proposed alternative original_catalog_id (%) does not match request item medicine_catalog_id (%)',
        NEW.original_catalog_id, v_item.medicine_catalog_id;
    END IF;
  END IF;

  -- 3. Ensure proposed catalog item is not identical to original catalog item
  IF NEW.original_catalog_id IS NOT NULL AND NEW.proposed_catalog_id = NEW.original_catalog_id THEN
    RAISE EXCEPTION 'Proposed alternative medicine cannot be identical to the original medicine';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.trg_validate_proposed_alternative() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_proposed_alternatives_validate ON public.proposed_alternatives;
CREATE TRIGGER trg_proposed_alternatives_validate
  BEFORE INSERT OR UPDATE ON public.proposed_alternatives
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_validate_proposed_alternative();



-- -----------------------------------------------------------------------------
-- 9. Confirmed Orders & Order Items
-- NOTE: Delivery OTP secrets are NOT stored in public.orders to eliminate courier
-- exfiltration risk. They are stored in private.order_delivery_secrets.
-- -----------------------------------------------------------------------------
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT NOT NULL UNIQUE,
  request_id UUID NOT NULL UNIQUE REFERENCES public.medicine_requests(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  courier_id UUID REFERENCES public.courier_profiles(id) ON DELETE SET NULL,
  delivery_address_snapshot JSONB NOT NULL,
  status order_status_type NOT NULL DEFAULT 'confirmed',
  subtotal_egp NUMERIC(10, 2) NOT NULL CHECK (subtotal_egp >= 0),
  delivery_fee_egp NUMERIC(10, 2) NOT NULL CHECK (delivery_fee_egp >= 0),
  total_egp NUMERIC(10, 2) NOT NULL CHECK (total_egp >= 0),
  tamper_seal_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  catalog_id UUID REFERENCES public.medicine_catalog(id) ON DELETE RESTRICT,
  item_name TEXT NOT NULL,
  is_alternative BOOLEAN NOT NULL DEFAULT FALSE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_egp NUMERIC(10, 2) NOT NULL CHECK (unit_price_egp >= 0),
  total_price_egp NUMERIC(10, 2) NOT NULL CHECK (total_price_egp >= 0)
);

-- -----------------------------------------------------------------------------
-- 9b. Private Delivery Verification Secrets (Inaccessible to Application Clients)
-- -----------------------------------------------------------------------------
CREATE TABLE private.order_delivery_secrets (
  order_id UUID PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  otp_hash TEXT NOT NULL,
  otp_salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts_count INTEGER NOT NULL DEFAULT 0 CHECK (attempts_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5,
  is_consumed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

REVOKE ALL ON TABLE private.order_delivery_secrets FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. Delivery Events (Append-Only Event Ledger)
-- -----------------------------------------------------------------------------
CREATE TABLE public.delivery_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  courier_id UUID NOT NULL REFERENCES public.courier_profiles(id) ON DELETE RESTRICT,
  event_type delivery_event_type NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- -----------------------------------------------------------------------------
-- 11. Audit Logs (Immutable Operational & Security Ledger)
-- -----------------------------------------------------------------------------
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES auth.users(id),
  actor_role user_role_type NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- -----------------------------------------------------------------------------
-- 12. Row Level Security Enablement
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposed_alternatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 13. Hardened Row Level Security Policies
-- -----------------------------------------------------------------------------

-- 13.1 Profiles Policies
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own_or_admin" ON public.profiles
  FOR UPDATE USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

-- 13.2 User Roles Policies (Admins Only - Prevents Self-Privilege Escalation)
CREATE POLICY "user_roles_select_own_or_admin" ON public.user_roles
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "user_roles_admin_insert" ON public.user_roles
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "user_roles_admin_update" ON public.user_roles
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "user_roles_admin_delete" ON public.user_roles
  FOR DELETE USING (public.is_admin());

-- 13.3 Customer Addresses Policies
CREATE POLICY "customer_addresses_select_own_or_admin" ON public.customer_addresses
  FOR SELECT USING (customer_id = auth.uid() OR public.is_admin());

CREATE POLICY "customer_addresses_insert_own" ON public.customer_addresses
  FOR INSERT WITH CHECK (customer_id = auth.uid());

CREATE POLICY "customer_addresses_update_own" ON public.customer_addresses
  FOR UPDATE USING (customer_id = auth.uid() OR public.is_admin())
  WITH CHECK (customer_id = auth.uid() OR public.is_admin());

CREATE POLICY "customer_addresses_delete_own" ON public.customer_addresses
  FOR DELETE USING (customer_id = auth.uid() OR public.is_admin());

-- 13.4 Pharmacies Policies (Blocks Self-Verification by Pharmacy Managers)
CREATE POLICY "pharmacies_select_verified_or_staff_or_admin" ON public.pharmacies
  FOR SELECT USING (
    (verification_status = 'verified' AND is_active = true) OR
    id IN (SELECT pharmacy_id FROM public.pharmacy_staff WHERE user_id = auth.uid()) OR
    public.is_admin()
  );

CREATE POLICY "pharmacies_admin_insert" ON public.pharmacies
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "pharmacies_manager_update" ON public.pharmacies
  FOR UPDATE USING (
    public.is_admin() OR
    id IN (SELECT pharmacy_id FROM public.pharmacy_staff WHERE user_id = auth.uid() AND is_primary_manager = true)
  )
  WITH CHECK (
    public.is_admin() OR
    id IN (SELECT pharmacy_id FROM public.pharmacy_staff WHERE user_id = auth.uid() AND is_primary_manager = true)
  );

-- Enforce pharmacy protected fields at database level via BEFORE UPDATE trigger
CREATE OR REPLACE FUNCTION public.trg_prevent_pharmacy_self_verification()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    OLD.verification_status IS DISTINCT FROM NEW.verification_status OR
    OLD.license_number IS DISTINCT FROM NEW.license_number OR
    OLD.commercial_register IS DISTINCT FROM NEW.commercial_register OR
    OLD.verified_by IS DISTINCT FROM NEW.verified_by OR
    OLD.verified_at IS DISTINCT FROM NEW.verified_at
  ) THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only platform administrators can modify pharmacy verification status, licenses, or verification metadata';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.trg_prevent_pharmacy_self_verification() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_pharmacies_protect_verification ON public.pharmacies;
CREATE TRIGGER trg_pharmacies_protect_verification
  BEFORE UPDATE ON public.pharmacies
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prevent_pharmacy_self_verification();

-- 13.5 Pharmacy Staff Policies
CREATE POLICY "pharmacy_staff_select_colleagues_or_admin" ON public.pharmacy_staff
  FOR SELECT USING (
    pharmacy_id IN (SELECT pharmacy_id FROM public.pharmacy_staff WHERE user_id = auth.uid()) OR
    public.is_admin()
  );

CREATE POLICY "pharmacy_staff_manager_insert" ON public.pharmacy_staff
  FOR INSERT WITH CHECK (
    public.is_admin() OR
    pharmacy_id IN (SELECT pharmacy_id FROM public.pharmacy_staff WHERE user_id = auth.uid() AND is_primary_manager = true)
  );

-- 13.6 Courier Profiles Policies
CREATE POLICY "courier_profiles_select_own_or_admin_or_available" ON public.courier_profiles
  FOR SELECT USING (
    user_id = auth.uid() OR
    public.is_admin() OR
    (verification_status = 'verified' AND shift_status = 'available')
  );

CREATE POLICY "courier_profiles_insert_own_or_admin" ON public.courier_profiles
  FOR INSERT WITH CHECK (
    public.is_admin() OR
    (user_id = auth.uid() AND verification_status = 'pending')
  );

CREATE POLICY "courier_profiles_update_shift" ON public.courier_profiles
  FOR UPDATE USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- Enforce courier protected fields at database level via BEFORE INSERT OR UPDATE trigger
CREATE OR REPLACE FUNCTION public.trg_prevent_courier_self_verification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- On INSERT: non-admins cannot self-verify or forge verification metadata
    IF NOT public.is_admin() THEN
      IF NEW.verification_status <> 'pending' THEN
        RAISE EXCEPTION 'Couriers cannot self-verify on registration. Initial status must be pending.';
      END IF;
      IF NEW.verified_by IS NOT NULL OR NEW.verified_at IS NOT NULL THEN
        RAISE EXCEPTION 'Only platform administrators can set courier verification metadata';
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- On UPDATE: non-admins cannot mutate verification_status, national_id, or verification metadata
    IF (
      OLD.verification_status IS DISTINCT FROM NEW.verification_status OR
      OLD.national_id_number IS DISTINCT FROM NEW.national_id_number OR
      OLD.verified_by IS DISTINCT FROM NEW.verified_by OR
      OLD.verified_at IS DISTINCT FROM NEW.verified_at
    ) THEN
      IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only platform administrators can modify courier verification status, national ID, or verification metadata';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.trg_prevent_courier_self_verification() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_courier_protect_verification ON public.courier_profiles;
CREATE TRIGGER trg_courier_protect_verification
  BEFORE INSERT OR UPDATE ON public.courier_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prevent_courier_self_verification();

-- 13.7 Medicine Catalog Policies (Public Read, Admin Write)
CREATE POLICY "medicine_catalog_select_all" ON public.medicine_catalog
  FOR SELECT USING (true);

CREATE POLICY "medicine_catalog_admin_write" ON public.medicine_catalog
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 13.8 Medicine Requests Policies
CREATE POLICY "medicine_requests_select_involved" ON public.medicine_requests
  FOR SELECT USING (
    customer_id = auth.uid() OR
    (assigned_pharmacy_id IS NOT NULL AND public.is_pharmacy_staff(assigned_pharmacy_id)) OR
    public.is_admin()
  );

CREATE POLICY "medicine_requests_insert_customer" ON public.medicine_requests
  FOR INSERT WITH CHECK (
    customer_id = auth.uid() AND status = 'submitted'
  );

CREATE POLICY "medicine_requests_cancel_customer" ON public.medicine_requests
  FOR UPDATE USING (
    customer_id = auth.uid() AND status IN ('submitted', 'under_pharmacy_review', 'alternative_proposed')
  )
  WITH CHECK (
    customer_id = auth.uid() AND status = 'cancelled'
  );

-- 13.9 Request Items Policies
CREATE POLICY "request_items_select_involved" ON public.request_items
  FOR SELECT USING (
    request_id IN (
      SELECT id FROM public.medicine_requests
      WHERE customer_id = auth.uid() OR
            (assigned_pharmacy_id IS NOT NULL AND public.is_pharmacy_staff(assigned_pharmacy_id)) OR
            public.is_admin()
    )
  );

CREATE POLICY "request_items_insert_customer" ON public.request_items
  FOR INSERT WITH CHECK (
    request_id IN (
      SELECT id FROM public.medicine_requests
      WHERE customer_id = auth.uid() AND status = 'submitted'
    )
  );

-- 13.10 Proposed Alternatives Policies
CREATE POLICY "proposed_alternatives_select_involved" ON public.proposed_alternatives
  FOR SELECT USING (
    request_id IN (
      SELECT id FROM public.medicine_requests
      WHERE customer_id = auth.uid() OR
            (assigned_pharmacy_id IS NOT NULL AND public.is_pharmacy_staff(assigned_pharmacy_id)) OR
            public.is_admin()
    )
  );

CREATE POLICY "proposed_alternatives_insert_pharmacy" ON public.proposed_alternatives
  FOR INSERT WITH CHECK (
    reviewed_by_pharmacist_id = auth.uid() AND
    request_id IN (
      SELECT id FROM public.medicine_requests
      WHERE assigned_pharmacy_id IS NOT NULL AND
            public.is_pharmacy_staff(assigned_pharmacy_id) AND
            status = 'under_pharmacy_review'
    ) AND
    request_item_id IN (
      SELECT id FROM public.request_items
      WHERE request_id = proposed_alternatives.request_id
    )
  );

-- 13.11 Orders Policies (SELECT only via direct client; INSERT & UPDATE blocked to force RPCs)
CREATE POLICY "orders_select_involved" ON public.orders
  FOR SELECT USING (
    customer_id = auth.uid() OR
    public.is_pharmacy_staff(pharmacy_id) OR
    courier_id = public.get_courier_id(auth.uid()) OR
    public.is_admin()
  );

CREATE POLICY "orders_block_client_insert" ON public.orders
  FOR INSERT WITH CHECK (false);

CREATE POLICY "orders_block_client_update" ON public.orders
  FOR UPDATE USING (false);

-- 13.12 Order Items Policies
CREATE POLICY "order_items_select_involved" ON public.order_items
  FOR SELECT USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE customer_id = auth.uid() OR
            public.is_pharmacy_staff(pharmacy_id) OR
            courier_id = public.get_courier_id(auth.uid()) OR
            public.is_admin()
    )
  );

CREATE POLICY "order_items_block_client_insert" ON public.order_items
  FOR INSERT WITH CHECK (false);

-- 13.13 Delivery Events Policies (Couriers cannot forge 'delivered' events directly)
CREATE POLICY "delivery_events_select_involved" ON public.delivery_events
  FOR SELECT USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE customer_id = auth.uid() OR
            public.is_pharmacy_staff(pharmacy_id) OR
            courier_id = public.get_courier_id(auth.uid()) OR
            public.is_admin()
    )
  );

CREATE POLICY "delivery_events_insert_courier" ON public.delivery_events
  FOR INSERT WITH CHECK (
    courier_id = public.get_courier_id(auth.uid()) AND
    event_type <> 'delivered' AND -- Delivered events are recorded exclusively by verify_delivery_otp RPC
    order_id IN (
      SELECT id FROM public.orders
      WHERE courier_id = public.get_courier_id(auth.uid())
    )
  );

-- 13.14 Audit Logs Policies (Admins only read, client writes blocked)
CREATE POLICY "audit_logs_admin_select" ON public.audit_logs
  FOR SELECT USING (public.is_admin());

CREATE POLICY "audit_logs_block_client_insert" ON public.audit_logs
  FOR INSERT WITH CHECK (false);

-- -----------------------------------------------------------------------------
-- 14. Trusted Server-Side RPC Functions (Lifecycle, Tenancy & Secrets)
-- -----------------------------------------------------------------------------

-- Internal Audit Logger Helper
CREATE OR REPLACE FUNCTION public.internal_log_audit(
  p_actor_id UUID,
  p_actor_role user_role_type,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_metadata JSONB DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, metadata)
  VALUES (p_actor_id, p_actor_role, p_action, p_entity_type, p_entity_id, p_metadata);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.internal_log_audit FROM PUBLIC;

-- 14.1 Lifecycle RPC: Start Pharmacy Review
CREATE OR REPLACE FUNCTION public.start_pharmacy_review(
  p_request_id UUID,
  p_pharmacy_id UUID
) RETURNS VOID AS $$
DECLARE
  v_req RECORD;
BEGIN
  IF NOT (public.is_pharmacy_staff(p_pharmacy_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Caller is not authorized staff of the specified pharmacy';
  END IF;

  SELECT * INTO v_req FROM public.medicine_requests
  WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_req.status <> 'submitted' THEN
    RAISE EXCEPTION 'Request cannot be moved to review; current status is %', v_req.status;
  END IF;

  UPDATE public.medicine_requests
  SET status = 'under_pharmacy_review',
      assigned_pharmacy_id = p_pharmacy_id,
      updated_at = timezone('utc', now())
  WHERE id = p_request_id;

  PERFORM public.internal_log_audit(
    auth.uid(),
    'pharmacy_staff',
    'START_PHARMACY_REVIEW',
    'request',
    p_request_id,
    jsonb_build_object('pharmacy_id', p_pharmacy_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.start_pharmacy_review(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_pharmacy_review(UUID, UUID) TO authenticated;

-- 14.2 Lifecycle RPC: Confirm Original Medicine Availability & Pricing
CREATE OR REPLACE FUNCTION public.confirm_pharmacy_availability(
  p_request_id UUID,
  p_items_pricing JSONB,
  p_delivery_fee_egp NUMERIC(10, 2)
) RETURNS VOID AS $$
DECLARE
  v_req RECORD;
  v_item RECORD;
  v_pricing RECORD;
  v_unit_price NUMERIC(10, 2);
BEGIN
  SELECT * INTO v_req FROM public.medicine_requests
  WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF NOT (public.is_pharmacy_staff(v_req.assigned_pharmacy_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Caller is not authorized staff of the assigned pharmacy';
  END IF;

  IF v_req.status <> 'under_pharmacy_review' THEN
    RAISE EXCEPTION 'Request must be under_pharmacy_review to confirm availability';
  END IF;

  IF p_delivery_fee_egp IS NULL OR p_delivery_fee_egp < 0 THEN
    RAISE EXCEPTION 'Delivery fee must be a non-negative number';
  END IF;

  -- Iterate through items and record pharmacy-confirmed stock and prices
  FOR v_item IN (SELECT * FROM public.request_items WHERE request_id = p_request_id) LOOP
    v_unit_price := (p_items_pricing->>v_item.id::text)::numeric;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Confirmed unit price missing or invalid for item %', v_item.id;
    END IF;

    UPDATE public.request_items
    SET confirmed_available = true,
        confirmed_unit_price_egp = v_unit_price
    WHERE id = v_item.id;
  END LOOP;

  UPDATE public.medicine_requests
  SET status = 'availability_confirmed',
      confirmed_delivery_fee_egp = p_delivery_fee_egp,
      updated_at = timezone('utc', now())
  WHERE id = p_request_id;

  PERFORM public.internal_log_audit(
    auth.uid(),
    'pharmacy_staff',
    'CONFIRM_PHARMACY_AVAILABILITY',
    'request',
    p_request_id,
    jsonb_build_object('delivery_fee_egp', p_delivery_fee_egp)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.confirm_pharmacy_availability(UUID, JSONB, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_pharmacy_availability(UUID, JSONB, NUMERIC) TO authenticated;

-- 14.3 Lifecycle RPC: Customer Accepts or Declines Alternative
CREATE OR REPLACE FUNCTION public.respond_to_alternative(
  p_alternative_id UUID,
  p_accept BOOLEAN
) RETURNS VOID AS $$
DECLARE
  v_alt RECORD;
  v_req RECORD;
BEGIN
  SELECT * INTO v_alt FROM public.proposed_alternatives
  WHERE id = p_alternative_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alternative proposal not found';
  END IF;

  SELECT * INTO v_req FROM public.medicine_requests
  WHERE id = v_alt.request_id FOR UPDATE;

  IF v_req.customer_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not the requesting customer';
  END IF;

  IF v_alt.approval_status <> 'pending_customer' THEN
    RAISE EXCEPTION 'Alternative proposal is not pending customer review';
  END IF;

  IF v_alt.expires_at < timezone('utc', now()) THEN
    UPDATE public.proposed_alternatives SET approval_status = 'expired' WHERE id = p_alternative_id;
    RAISE EXCEPTION 'Proposed alternative offer has expired';
  END IF;

  IF p_accept THEN
    UPDATE public.proposed_alternatives
    SET approval_status = 'accepted', responded_at = timezone('utc', now())
    WHERE id = p_alternative_id;

    UPDATE public.medicine_requests
    SET status = 'availability_confirmed', updated_at = timezone('utc', now())
    WHERE id = v_alt.request_id;

    PERFORM public.internal_log_audit(auth.uid(), 'customer', 'ACCEPT_ALTERNATIVE', 'alternative', p_alternative_id);
  ELSE
    UPDATE public.proposed_alternatives
    SET approval_status = 'declined', responded_at = timezone('utc', now())
    WHERE id = p_alternative_id;

    UPDATE public.medicine_requests
    SET status = 'cancelled', updated_at = timezone('utc', now())
    WHERE id = v_alt.request_id;

    PERFORM public.internal_log_audit(auth.uid(), 'customer', 'DECLINE_ALTERNATIVE', 'alternative', p_alternative_id);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.respond_to_alternative(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_alternative(UUID, BOOLEAN) TO authenticated;

-- 14.4 Atomic Order Conversion RPC (With Correct Multi-Item Mapping & Isolated Secrets)
CREATE OR REPLACE FUNCTION public.create_order_from_accepted_request(
  p_request_id UUID
) RETURNS UUID AS $$
DECLARE
  v_req RECORD;
  v_order_id UUID;
  v_order_number TEXT;
  v_subtotal NUMERIC(10, 2) := 0;
  v_delivery_fee NUMERIC(10, 2);
  v_total NUMERIC(10, 2);
  v_addr_snapshot JSONB;
  v_item RECORD;
  v_item_price NUMERIC(10, 2);
  v_is_alt BOOLEAN;
  v_final_catalog_id UUID;
  v_item_name TEXT;
  v_salt TEXT;
  v_otp_code TEXT;
  v_otp_hash TEXT;
  v_alt RECORD;
  v_raw_bytes BYTEA;
  v_random_int BIGINT;
BEGIN
  -- 1. Lock the request row
  SELECT * INTO v_req FROM public.medicine_requests
  WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  -- 2. Verify caller ownership
  IF v_req.customer_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not the requesting customer';
  END IF;

  -- 3. Verify request status
  IF v_req.status <> 'availability_confirmed' THEN
    RAISE EXCEPTION 'Request status must be availability_confirmed to convert to order';
  END IF;

  -- 4. Verify no duplicate order already exists (anti-replay guard)
  IF EXISTS (SELECT 1 FROM public.orders WHERE request_id = p_request_id) THEN
    RAISE EXCEPTION 'An order has already been generated for this request';
  END IF;

  -- 5. Delivery fee must be verified by pharmacy
  IF v_req.confirmed_delivery_fee_egp IS NULL THEN
    RAISE EXCEPTION 'Fulfilling pharmacy has not confirmed delivery fee for this request';
  END IF;
  v_delivery_fee := v_req.confirmed_delivery_fee_egp;

  -- 6. Fetch delivery address snapshot
  SELECT to_jsonb(a) INTO v_addr_snapshot
  FROM public.customer_addresses a WHERE a.id = v_req.delivery_address_id;

  -- 7. Compute subtotal with exact item-by-item matching
  FOR v_item IN (SELECT * FROM public.request_items WHERE request_id = p_request_id) LOOP
    -- Check if an accepted alternative exists SPECIFICALLY for this request item
    SELECT pa.*, mc.brand_name_ar INTO v_alt
    FROM public.proposed_alternatives pa
    JOIN public.medicine_catalog mc ON mc.id = pa.proposed_catalog_id
    WHERE pa.request_item_id = v_item.id
      AND pa.request_id = p_request_id
      AND pa.approval_status = 'accepted'
    ORDER BY pa.offer_version DESC
    LIMIT 1;

    IF FOUND THEN
      -- Validate that original catalog ID matches if item was catalogued (null original_catalog_id cannot bypass)
      IF v_item.medicine_catalog_id IS NOT NULL THEN
        IF v_alt.original_catalog_id IS NULL OR v_item.medicine_catalog_id <> v_alt.original_catalog_id THEN
          RAISE EXCEPTION 'Alternative original catalog ID does not match request item %', v_item.raw_medicine_name;
        END IF;
      END IF;
      v_is_alt := true;
      v_final_catalog_id := v_alt.proposed_catalog_id;
      v_item_price := v_alt.proposed_price_egp;
      v_item_name := v_alt.brand_name_ar;
    ELSE
      -- Must have pharmacy-confirmed unit price for original medicine (never fabricated)
      IF v_item.confirmed_unit_price_egp IS NULL THEN
        RAISE EXCEPTION 'Pharmacy-confirmed price missing for requested item %', v_item.raw_medicine_name;
      END IF;
      v_is_alt := false;
      v_final_catalog_id := v_item.medicine_catalog_id;
      v_item_price := v_item.confirmed_unit_price_egp;
      v_item_name := v_item.raw_medicine_name;
    END IF;

    v_subtotal := v_subtotal + (v_item_price * v_item.requested_quantity);
  END LOOP;

  v_total := v_subtotal + v_delivery_fee;
  v_order_number := 'ELX-' || to_char(now(), 'YYYY') || '-' || substr(md5(random()::text), 1, 6);

  -- 8. Insert into public.orders (Without OTP secrets)
  INSERT INTO public.orders (
    order_number,
    request_id,
    customer_id,
    pharmacy_id,
    delivery_address_snapshot,
    status,
    subtotal_egp,
    delivery_fee_egp,
    total_egp
  ) VALUES (
    v_order_number,
    p_request_id,
    v_req.customer_id,
    v_req.assigned_pharmacy_id,
    v_addr_snapshot,
    'confirmed',
    v_subtotal,
    v_delivery_fee,
    v_total
  ) RETURNING id INTO v_order_id;

  -- 9. Insert order line items
  FOR v_item IN (SELECT * FROM public.request_items WHERE request_id = p_request_id) LOOP
    SELECT pa.*, mc.brand_name_ar INTO v_alt
    FROM public.proposed_alternatives pa
    JOIN public.medicine_catalog mc ON mc.id = pa.proposed_catalog_id
    WHERE pa.request_item_id = v_item.id
      AND pa.request_id = p_request_id
      AND pa.approval_status = 'accepted'
    ORDER BY pa.offer_version DESC
    LIMIT 1;

    IF FOUND THEN
      v_is_alt := true;
      v_final_catalog_id := v_alt.proposed_catalog_id;
      v_item_price := v_alt.proposed_price_egp;
      v_item_name := v_alt.brand_name_ar;
    ELSE
      v_is_alt := false;
      v_final_catalog_id := v_item.medicine_catalog_id;
      v_item_price := v_item.confirmed_unit_price_egp;
      v_item_name := v_item.raw_medicine_name;
    END IF;

    INSERT INTO public.order_items (
      order_id,
      catalog_id,
      item_name,
      is_alternative,
      quantity,
      unit_price_egp,
      total_price_egp
    ) VALUES (
      v_order_id,
      v_final_catalog_id,
      v_item_name,
      v_is_alt,
      v_item.requested_quantity,
      v_item_price,
      v_item_price * v_item.requested_quantity
    );
  END LOOP;

  -- 10. Generate cryptographically uniform 6-digit OTP across all 900,000 combinations [100000, 999999]
  -- Uses rejection sampling on 32-bit cryptographically secure random integers from gen_random_bytes(4)
  -- to eliminate modulo bias. (4,294,800,000 is largest multiple of 900,000 <= 2^32)
  v_salt := encode(gen_random_bytes(16), 'hex');
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
  v_otp_hash := encode(digest(v_otp_code || v_salt, 'sha256'), 'hex');

  -- Store secret in isolated private table (Inaccessible to couriers/clients)
  INSERT INTO private.order_delivery_secrets (
    order_id,
    otp_hash,
    otp_salt,
    expires_at
  ) VALUES (
    v_order_id,
    v_otp_hash,
    v_salt,
    timezone('utc', now() + interval '4 hours')
  );

  -- 11. Update request status
  UPDATE public.medicine_requests
  SET status = 'converted_to_order', updated_at = timezone('utc', now())
  WHERE id = p_request_id;

  -- 12. Record audit log (OTP value is NEVER logged)
  PERFORM public.internal_log_audit(
    auth.uid(),
    'customer',
    'CREATE_ORDER',
    'order',
    v_order_id,
    jsonb_build_object('order_number', v_order_number, 'total_egp', v_total)
  );

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

REVOKE EXECUTE ON FUNCTION public.create_order_from_accepted_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_from_accepted_request(UUID) TO authenticated;

-- 14.5 Assign Courier RPC (Persists Courier Assignment Explicitly)
CREATE OR REPLACE FUNCTION public.assign_courier_to_order(
  p_order_id UUID,
  p_courier_id UUID
) RETURNS VOID AS $$
DECLARE
  v_ord RECORD;
  v_cour RECORD;
BEGIN
  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF NOT (public.is_pharmacy_staff(v_ord.pharmacy_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Unauthorized to assign courier to this order';
  END IF;

  IF v_ord.status <> 'ready_for_pickup' THEN
    RAISE EXCEPTION 'Order must be ready_for_pickup before assigning a courier';
  END IF;

  SELECT * INTO v_cour FROM public.courier_profiles
  WHERE id = p_courier_id AND verification_status = 'verified';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assigned courier is not verified or does not exist';
  END IF;

  UPDATE public.orders
  SET courier_id = p_courier_id,
      status = 'assigned_to_courier',
      updated_at = timezone('utc', now())
  WHERE id = p_order_id;

  INSERT INTO public.delivery_events (order_id, courier_id, event_type, notes)
  VALUES (p_order_id, p_courier_id, 'assigned', 'Assigned by fulfilling pharmacy');

  PERFORM public.internal_log_audit(
    auth.uid(),
    'pharmacy_staff',
    'ASSIGN_COURIER_TO_ORDER',
    'order',
    p_order_id,
    jsonb_build_object('courier_id', p_courier_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.assign_courier_to_order(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_courier_to_order(UUID, UUID) TO authenticated;

-- 14.6 Order State Transition RPC (With Strict Tenant and Assignment Checks)
CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id UUID,
  p_next_status order_status_type,
  p_notes TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_ord RECORD;
  v_caller_role user_role_type;
BEGIN
  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_caller_role := public.get_user_role(auth.uid());

  IF p_next_status = 'in_preparation' THEN
    IF NOT (public.is_pharmacy_staff(v_ord.pharmacy_id) OR public.is_admin()) THEN
      RAISE EXCEPTION 'Only fulfilling pharmacy staff can move order to in_preparation';
    END IF;
    IF v_ord.status <> 'confirmed' THEN
      RAISE EXCEPTION 'Order must be confirmed to start preparation';
    END IF;

  ELSIF p_next_status = 'ready_for_pickup' THEN
    IF NOT (public.is_pharmacy_staff(v_ord.pharmacy_id) OR public.is_admin()) THEN
      RAISE EXCEPTION 'Only fulfilling pharmacy staff can mark order ready for pickup';
    END IF;
    IF v_ord.status <> 'in_preparation' THEN
      RAISE EXCEPTION 'Order must be in_preparation to be ready for pickup';
    END IF;

  ELSIF p_next_status = 'in_transit' THEN
    IF NOT (v_ord.courier_id = public.get_courier_id(auth.uid()) OR public.is_admin()) THEN
      RAISE EXCEPTION 'Only the assigned courier can confirm pickup and move order in_transit';
    END IF;
    IF v_ord.status <> 'assigned_to_courier' THEN
      RAISE EXCEPTION 'Order must be assigned to courier before moving in_transit';
    END IF;

  ELSIF p_next_status = 'failed_delivery' THEN
    IF NOT (v_ord.courier_id = public.get_courier_id(auth.uid()) OR public.is_admin()) THEN
      RAISE EXCEPTION 'Only assigned courier can report delivery failure';
    END IF;
    IF v_ord.status <> 'in_transit' THEN
      RAISE EXCEPTION 'Order must be in_transit to record delivery failure';
    END IF;

  ELSIF p_next_status = 'cancelled' THEN
    IF v_ord.status IN ('delivered', 'in_transit') AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Orders in transit or delivered cannot be cancelled by client';
    END IF;

  ELSE
    RAISE EXCEPTION 'Direct transition to % is restricted or requires dedicated verification RPC', p_next_status;
  END IF;

  UPDATE public.orders
  SET status = p_next_status, updated_at = timezone('utc', now())
  WHERE id = p_order_id;

  PERFORM public.internal_log_audit(
    auth.uid(),
    v_caller_role,
    'TRANSITION_ORDER_STATUS',
    'order',
    p_order_id,
    jsonb_build_object('from', v_ord.status, 'to', p_next_status, 'notes', p_notes)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.transition_order_status(UUID, order_status_type, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_order_status(UUID, order_status_type, TEXT) TO authenticated;

-- 14.7 Secure Delivery OTP Verification RPC (Reads Private Secrets & Consumes Hash)
CREATE OR REPLACE FUNCTION public.verify_delivery_otp(
  p_order_id UUID,
  p_plaintext_otp TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_ord RECORD;
  v_sec RECORD;
  v_computed_hash TEXT;
BEGIN
  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_ord.courier_id <> public.get_courier_id(auth.uid()) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only the assigned courier can verify delivery OTP';
  END IF;

  IF v_ord.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Order must be in_transit to verify delivery';
  END IF;

  -- Fetch secret from private schema
  SELECT * INTO v_sec FROM private.order_delivery_secrets
  WHERE order_id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery secrets not found for order';
  END IF;

  IF v_sec.is_consumed THEN
    RAISE EXCEPTION 'Delivery OTP has already been consumed (Replay blocked)';
  END IF;

  IF v_sec.attempts_count >= v_sec.max_attempts THEN
    RAISE EXCEPTION 'Max OTP attempts exceeded. Locked out.';
  END IF;

  IF v_sec.expires_at < timezone('utc', now()) THEN
    RAISE EXCEPTION 'Delivery OTP has expired.';
  END IF;

  v_computed_hash := encode(digest(p_plaintext_otp || v_sec.otp_salt, 'sha256'), 'hex');

  IF v_computed_hash = v_sec.otp_hash THEN
    -- Success: mark delivered, consume secret, record authoritative delivery event
    UPDATE public.orders
    SET status = 'delivered', updated_at = timezone('utc', now())
    WHERE id = p_order_id;

    UPDATE private.order_delivery_secrets
    SET is_consumed = true, otp_hash = 'CONSUMED'
    WHERE order_id = p_order_id;

    INSERT INTO public.delivery_events (order_id, courier_id, event_type, notes)
    VALUES (p_order_id, v_ord.courier_id, 'delivered', 'Verified via valid recipient OTP');

    PERFORM public.internal_log_audit(
      auth.uid(),
      'courier',
      'VERIFY_DELIVERY_OTP_SUCCESS',
      'order',
      p_order_id
    );

    RETURN true;
  ELSE
    -- Increment attempts count
    UPDATE private.order_delivery_secrets
    SET attempts_count = attempts_count + 1
    WHERE order_id = p_order_id;

    PERFORM public.internal_log_audit(
      auth.uid(),
      'courier',
      'VERIFY_DELIVERY_OTP_FAILED',
      'order',
      p_order_id,
      jsonb_build_object('attempt', v_sec.attempts_count + 1)
    );

    RETURN false;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

REVOKE EXECUTE ON FUNCTION public.verify_delivery_otp(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_delivery_otp(UUID, TEXT) TO authenticated;
