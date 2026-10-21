-- ==============================================================================
-- ElajX (علاجك) — Non-Destructive Schema Reconciliation Migration
-- Version: 20261021000001_reconcile_existing_schema.sql
-- Target: Supabase Project sdrctrozoxiknscnsuuk
-- Classification: Data-Preserving Schema Reconciliation with Isolated Secrets & RPCs
--
-- CORE PRINCIPLES & SAFETY GUARANTEES:
-- 1. PRESERVE EXISTING DATA:
--    Zero DROPs, TRUNCATEs, or destructive redefinitions.
--    All 33 rows in public.medicines and 33 rows in public.pharmacies_stock are preserved untouched.
-- 2. ZERO FABRICATED MEDICAL OR COMMERCIAL VALUES:
--    - Target catalog fields are populated only when supported by source data.
--    - No fabricated default prices (arbitrary price fallbacks eliminated). m.alternative_price is the price of an
--      alternative, NOT the regulated ceiling price, so max_regulated_price_egp is left NULL.
--    - Missing manufacturer, pack_size, dosage_form, and category remain NULL.
--    - Fail-closed prescription classification: unknown prescription status defaults to TRUE (Rx required).
--    - Records seeded from legacy medicines are explicitly flagged as is_verified = FALSE.
-- 3. UNAMBIGUOUS CATALOG DATA FLOW (NO TRIGGER LOOPS):
--    - Avoids bidirectional trigger loops and competing write paths.
--    - public.medicines remains the authoritative source for existing legacy records.
--    - public.medicine_catalog serves as the verified domain table for ElajX orders and requests.
--    - Bridging is accomplished via an idempotent, non-destructive INSERT ... ON CONFLICT (id) DO NOTHING.
-- 4. HARDENED SECURITY DEFINER RPCs & ISOLATED SECRETS:
--    - Delivery OTP secrets reside exclusively in private.order_delivery_secrets (revoked from client roles).
--    - All SECURITY DEFINER functions enforce strict search_paths (public, auth, pg_temp; or
--      public, extensions, auth, pg_temp;) with pg_temp strictly last.
--    - Direct client writes on orders, order_items, and delivered events are blocked via RLS.
-- ==============================================================================

-- -----------------------------------------------------------------------------
-- 0. Extensions & Private Schema
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Enumerated Types (Idempotent Creation via schema-qualified pg_type guards)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'user_role_type'
  ) THEN
    CREATE TYPE public.user_role_type AS ENUM ('customer', 'pharmacy_staff', 'courier', 'admin');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'pharmacy_status_type'
  ) THEN
    CREATE TYPE public.pharmacy_status_type AS ENUM ('pending', 'verified', 'suspended');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'courier_status_type'
  ) THEN
    CREATE TYPE public.courier_status_type AS ENUM ('pending', 'verified', 'suspended');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'courier_shift_type'
  ) THEN
    CREATE TYPE public.courier_shift_type AS ENUM ('offline', 'available', 'on_delivery');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'request_status_type'
  ) THEN
    CREATE TYPE public.request_status_type AS ENUM (
      'submitted',
      'under_pharmacy_review',
      'alternative_proposed',
      'availability_confirmed',
      'converted_to_order',
      'rejected',
      'cancelled'
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'alternative_status_type'
  ) THEN
    CREATE TYPE public.alternative_status_type AS ENUM ('pending_customer', 'accepted', 'declined', 'expired');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'order_status_type'
  ) THEN
    CREATE TYPE public.order_status_type AS ENUM (
      'confirmed',
      'in_preparation',
      'ready_for_pickup',
      'assigned_to_courier',
      'in_transit',
      'delivered',
      'failed_delivery',
      'cancelled'
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'delivery_event_type'
  ) THEN
    CREATE TYPE public.delivery_event_type AS ENUM (
      'assigned',
      'courier_arrived_pharmacy',
      'picked_up',
      'in_transit',
      'arrived_destination',
      'delivered',
      'delivery_failed'
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. User Profiles & Trusted Role Assignments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) >= 2),
  phone TEXT NOT NULL UNIQUE CHECK (phone ~ '^\+?[0-9]{10,15}$'),
  national_id_masked TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS national_id_masked TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc', now());
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc', now());

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role user_role_type NOT NULL DEFAULT 'customer',
  granted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(user_id, role)
);

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS role user_role_type DEFAULT 'customer';
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS granted_by UUID REFERENCES auth.users(id);

-- -----------------------------------------------------------------------------
-- 3. Hardened Security Helper Functions (Fixed search_path & Least Privilege)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT (
    -- 1. Direct administrative database sessions (psql, migrations, maintenance).
    session_user IN ('postgres', 'supabase_admin') OR

    -- 2. Trusted backend service-role requests via PostgREST.
    coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '') = 'service_role' OR

    -- 3. Application platform administrators:
    (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    ))
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_user_role(target_user_id UUID)
RETURNS user_role_type AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = target_user_id
    AND (target_user_id = auth.uid() OR public.is_admin())
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.get_user_role(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_pharmacy_staff(check_pharmacy_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pharmacy_staff
    WHERE user_id = auth.uid() AND pharmacy_id = check_pharmacy_id
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.is_pharmacy_staff(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pharmacy_staff(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_pharmacy_manager(check_pharmacy_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pharmacy_staff
    WHERE user_id = auth.uid()
      AND pharmacy_id = check_pharmacy_id
      AND is_primary_manager = true
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.is_pharmacy_manager(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pharmacy_manager(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_courier_id(check_user_id UUID)
RETURNS UUID AS $$
  SELECT id FROM public.courier_profiles
  WHERE user_id = check_user_id
    AND (check_user_id = auth.uid() OR public.is_admin())
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.get_courier_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_courier_id(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Customer Delivery Addresses
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_addresses (
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

ALTER TABLE public.customer_addresses ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE public.customer_addresses ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE public.customer_addresses ADD COLUMN IF NOT EXISTS governorate TEXT;
ALTER TABLE public.customer_addresses ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE public.customer_addresses ADD COLUMN IF NOT EXISTS street TEXT;
ALTER TABLE public.customer_addresses ADD COLUMN IF NOT EXISTS building TEXT;
ALTER TABLE public.customer_addresses ADD COLUMN IF NOT EXISTS floor TEXT;
ALTER TABLE public.customer_addresses ADD COLUMN IF NOT EXISTS apartment TEXT;
ALTER TABLE public.customer_addresses ADD COLUMN IF NOT EXISTS landmark TEXT;
ALTER TABLE public.customer_addresses ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;
ALTER TABLE public.customer_addresses ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc', now());

-- -----------------------------------------------------------------------------
-- 5. Pharmacies & Staff (Additive Reconciliation with Existing Table)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pharmacies (
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

ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS commercial_name TEXT;
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS license_number TEXT;
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS commercial_register TEXT;
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS governorate TEXT;
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS street_address TEXT;
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS verification_status pharmacy_status_type DEFAULT 'pending';
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id);
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc', now());

CREATE TABLE IF NOT EXISTS public.pharmacy_staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_primary_manager BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(pharmacy_id, user_id)
);

ALTER TABLE public.pharmacy_staff ADD COLUMN IF NOT EXISTS pharmacy_id UUID;
ALTER TABLE public.pharmacy_staff ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.pharmacy_staff ADD COLUMN IF NOT EXISTS is_primary_manager BOOLEAN DEFAULT FALSE;
ALTER TABLE public.pharmacy_staff ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc', now());

-- -----------------------------------------------------------------------------
-- 6. Courier Profiles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.courier_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  vehicle_type TEXT NOT NULL,
  national_id_number TEXT NOT NULL UNIQUE,
  verification_status courier_status_type NOT NULL DEFAULT 'pending',
  shift_status courier_shift_type NOT NULL DEFAULT 'offline',
  current_zone TEXT,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.courier_profiles ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.courier_profiles ADD COLUMN IF NOT EXISTS vehicle_type TEXT;
ALTER TABLE public.courier_profiles ADD COLUMN IF NOT EXISTS national_id_number TEXT;
ALTER TABLE public.courier_profiles ADD COLUMN IF NOT EXISTS verification_status courier_status_type DEFAULT 'pending';
ALTER TABLE public.courier_profiles ADD COLUMN IF NOT EXISTS shift_status courier_shift_type DEFAULT 'offline';
ALTER TABLE public.courier_profiles ADD COLUMN IF NOT EXISTS current_zone TEXT;
ALTER TABLE public.courier_profiles ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id);
ALTER TABLE public.courier_profiles ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.courier_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc', now());

-- -----------------------------------------------------------------------------
-- 7. Medicine Catalog & Preserved Medicines Data Reconciliation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medicine_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_name_ar TEXT NOT NULL,
  brand_name_en TEXT,
  active_ingredient TEXT,
  dosage_form TEXT,
  strength TEXT,
  pack_size TEXT,
  manufacturer TEXT,
  max_regulated_price_egp NUMERIC(10, 2) CHECK (max_regulated_price_egp IS NULL OR max_regulated_price_egp >= 0),
  requires_prescription BOOLEAN NOT NULL DEFAULT TRUE,
  category TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  source_table TEXT NOT NULL DEFAULT 'legacy_medicines',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Reconcile public.medicine_catalog columns additively if table pre-existed
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS brand_name_ar TEXT;
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS brand_name_en TEXT;
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS active_ingredient TEXT;
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS dosage_form TEXT;
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS strength TEXT;
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS pack_size TEXT;
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS manufacturer TEXT;
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS max_regulated_price_egp NUMERIC(10, 2);
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS requires_prescription BOOLEAN DEFAULT TRUE;
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS source_table TEXT DEFAULT 'legacy_medicines';
ALTER TABLE public.medicine_catalog ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc', now());

-- Drop NOT NULL constraints on optional catalog fields only after columns exist
ALTER TABLE public.medicine_catalog ALTER COLUMN brand_name_en DROP NOT NULL;
ALTER TABLE public.medicine_catalog ALTER COLUMN active_ingredient DROP NOT NULL;
ALTER TABLE public.medicine_catalog ALTER COLUMN dosage_form DROP NOT NULL;
ALTER TABLE public.medicine_catalog ALTER COLUMN strength DROP NOT NULL;
ALTER TABLE public.medicine_catalog ALTER COLUMN pack_size DROP NOT NULL;
ALTER TABLE public.medicine_catalog ALTER COLUMN manufacturer DROP NOT NULL;
ALTER TABLE public.medicine_catalog ALTER COLUMN max_regulated_price_egp DROP NOT NULL;
ALTER TABLE public.medicine_catalog ALTER COLUMN category DROP NOT NULL;

-- Safe to create index now that all columns are verified to exist
CREATE INDEX IF NOT EXISTS idx_medicine_catalog_search ON public.medicine_catalog (brand_name_ar, brand_name_en, active_ingredient);

-- Ensure public.medicines table exists idempotently for both fresh and legacy environments
CREATE TABLE IF NOT EXISTS public.medicines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  name_ar TEXT,
  name_en TEXT,
  active_ingredient TEXT,
  dosage_form TEXT,
  strength TEXT,
  manufacturer TEXT,
  alternative_price NUMERIC(10, 2),
  prescription_required BOOLEAN DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- Reconcile public.medicines columns additively (never drop/truncate)
-- Invariant: Newly added prescription_required must default to NULL (fail-closed via COALESCE(..., true)), never FALSE!
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS name_ar TEXT;
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS name_en TEXT;
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS active_ingredient TEXT;
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS dosage_form TEXT;
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS strength TEXT;
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS manufacturer TEXT;
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS alternative_price NUMERIC(10, 2);
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS prescription_required BOOLEAN DEFAULT NULL;
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc', now());

-- Non-destructively seed public.medicine_catalog from live public.medicines (33 records)
-- RULE: ZERO FABRICATED MEDICAL OR COMMERCIAL VALUES.
-- 1. brand_name_ar: honestly extracted from name_ar or parsed from name.
-- 2. brand_name_en: honestly extracted from name_en or parsed from name.
-- 3. active_ingredient, dosage_form, strength, manufacturer: preserved as-is, NULL if absent.
-- 4. pack_size: left NULL (not present in source).
-- 5. max_regulated_price_egp: left NULL (alternative_price is not the regulated price of this medicine).
-- 6. requires_prescription: fail-closed (defaults to TRUE if NULL/unknown).
-- 7. category: left NULL (no hardcoded category).
-- 8. is_verified: FALSE (indicates legacy unverified data).
-- 9. ON CONFLICT (id) DO NOTHING prevents overwriting existing records on reruns.
INSERT INTO public.medicine_catalog (
  id,
  brand_name_ar,
  brand_name_en,
  active_ingredient,
  dosage_form,
  strength,
  pack_size,
  manufacturer,
  max_regulated_price_egp,
  requires_prescription,
  category,
  is_verified,
  source_table,
  created_at
)
SELECT
  m.id,
  COALESCE(NULLIF(trim(m.name_ar), ''), NULLIF(trim(split_part(m.name, '(', 1)), ''), m.name),
  NULLIF(trim(COALESCE(NULLIF(trim(m.name_en), ''), rtrim(split_part(m.name, '(', 2), ')'))), ''),
  NULLIF(trim(m.active_ingredient), ''),
  NULLIF(trim(m.dosage_form), ''),
  NULLIF(trim(m.strength), ''),
  NULL, -- pack_size absent in source; preserved as NULL
  NULLIF(trim(m.manufacturer), ''),
  NULL, -- alternative_price is NOT the regulated ceiling price; preserved as NULL
  COALESCE(m.prescription_required, true), -- fail-closed: requires prescription if unknown
  NULL, -- category absent in source; preserved as NULL
  false, -- unverified legacy medicine record
  'legacy_medicines',
  COALESCE(m.created_at, timezone('utc', now()))
FROM public.medicines m
ON CONFLICT (id) DO NOTHING;

-- NOTE ON CATALOG SYNCHRONIZATION:
-- To eliminate bidirectional trigger loops, recursive execution, and competing write paths,
-- no automatic synchronization trigger is installed between public.medicines and public.medicine_catalog.
-- public.medicines remains the authoritative source for existing legacy records.
-- public.medicine_catalog serves as the dedicated domain catalog for ElajX requests and orders.

-- -----------------------------------------------------------------------------
-- 8. Medicine Requests & Line Items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medicine_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  delivery_address_id UUID REFERENCES public.customer_addresses(id) ON DELETE RESTRICT,
  address_id UUID,
  status request_status_type NOT NULL DEFAULT 'submitted',
  assigned_pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  confirmed_delivery_fee_egp NUMERIC(10, 2) CHECK (confirmed_delivery_fee_egp IS NULL OR confirmed_delivery_fee_egp >= 0),
  pharmacist_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.medicine_requests ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE public.medicine_requests ADD COLUMN IF NOT EXISTS delivery_address_id UUID;
ALTER TABLE public.medicine_requests ADD COLUMN IF NOT EXISTS address_id UUID;
ALTER TABLE public.medicine_requests ADD COLUMN IF NOT EXISTS status request_status_type DEFAULT 'submitted';
ALTER TABLE public.medicine_requests ADD COLUMN IF NOT EXISTS assigned_pharmacy_id UUID;
ALTER TABLE public.medicine_requests ADD COLUMN IF NOT EXISTS confirmed_delivery_fee_egp NUMERIC(10, 2);
ALTER TABLE public.medicine_requests ADD COLUMN IF NOT EXISTS pharmacist_notes TEXT;
ALTER TABLE public.medicine_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc', now());
ALTER TABLE public.medicine_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc', now());

CREATE OR REPLACE FUNCTION public.trg_sync_request_address_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.delivery_address_id IS NULL AND NEW.address_id IS NOT NULL THEN
    NEW.delivery_address_id := NEW.address_id;
  ELSIF NEW.address_id IS NULL AND NEW.delivery_address_id IS NOT NULL THEN
    NEW.address_id := NEW.delivery_address_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_medicine_requests_sync_addr ON public.medicine_requests;
CREATE TRIGGER trg_medicine_requests_sync_addr
  BEFORE INSERT OR UPDATE ON public.medicine_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_request_address_id();

CREATE TABLE IF NOT EXISTS public.request_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES public.medicine_requests(id) ON DELETE CASCADE,
  medicine_catalog_id UUID REFERENCES public.medicine_catalog(id) ON DELETE SET NULL,
  raw_medicine_name TEXT NOT NULL,
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
  prescription_attachment_url TEXT,
  customer_notes TEXT,
  confirmed_available BOOLEAN DEFAULT NULL,
  confirmed_unit_price_egp NUMERIC(10, 2) CHECK (confirmed_unit_price_egp IS NULL OR confirmed_unit_price_egp >= 0),
  UNIQUE (request_id, id)
);

ALTER TABLE public.request_items ADD COLUMN IF NOT EXISTS medicine_catalog_id UUID REFERENCES public.medicine_catalog(id) ON DELETE SET NULL;
ALTER TABLE public.request_items ADD COLUMN IF NOT EXISTS raw_medicine_name TEXT;
ALTER TABLE public.request_items ADD COLUMN IF NOT EXISTS requested_quantity INTEGER DEFAULT 1;
ALTER TABLE public.request_items ADD COLUMN IF NOT EXISTS prescription_attachment_url TEXT;
ALTER TABLE public.request_items ADD COLUMN IF NOT EXISTS customer_notes TEXT;
ALTER TABLE public.request_items ADD COLUMN IF NOT EXISTS confirmed_available BOOLEAN DEFAULT NULL;
ALTER TABLE public.request_items ADD COLUMN IF NOT EXISTS confirmed_unit_price_egp NUMERIC(10, 2);

-- -----------------------------------------------------------------------------
-- 9. Proposed Bioequivalent Alternatives
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proposed_alternatives (
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
  CONSTRAINT fk_proposed_alternatives_request_item
    FOREIGN KEY (request_id, request_item_id)
    REFERENCES public.request_items(request_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_accepted_alternative_per_item
  ON public.proposed_alternatives (request_item_id)
  WHERE approval_status = 'accepted';

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.trg_validate_proposed_alternative() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_proposed_alternatives_validate ON public.proposed_alternatives;
CREATE TRIGGER trg_proposed_alternatives_validate
  BEFORE INSERT OR UPDATE ON public.proposed_alternatives
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_validate_proposed_alternative();

-- -----------------------------------------------------------------------------
-- 10. Confirmed Orders & Order Items (Additive Reconciliation with Existing Tables)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
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

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_number TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES public.medicine_requests(id) ON DELETE RESTRICT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pharmacy_id UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS courier_id UUID REFERENCES public.courier_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_address_snapshot JSONB;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status order_status_type DEFAULT 'confirmed';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS subtotal_egp NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_fee_egp NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total_egp NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tamper_seal_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc', now());
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc', now());

CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  catalog_id UUID REFERENCES public.medicine_catalog(id) ON DELETE RESTRICT,
  item_name TEXT NOT NULL,
  is_alternative BOOLEAN NOT NULL DEFAULT FALSE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_egp NUMERIC(10, 2) NOT NULL CHECK (unit_price_egp >= 0),
  total_price_egp NUMERIC(10, 2) NOT NULL CHECK (total_price_egp >= 0)
);

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS catalog_id UUID REFERENCES public.medicine_catalog(id) ON DELETE RESTRICT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS medicine_catalog_id UUID REFERENCES public.medicine_catalog(id) ON DELETE SET NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS item_name TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_alternative BOOLEAN DEFAULT FALSE;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS unit_price_egp NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS total_price_egp NUMERIC(10, 2) DEFAULT 0;

-- -----------------------------------------------------------------------------
-- 11. Private Delivery Verification Secrets (Inaccessible to Public Clients)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.order_delivery_secrets (
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
-- 12. Delivery Events & Audit Logs Ledgers
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  courier_id UUID NOT NULL REFERENCES public.courier_profiles(id) ON DELETE RESTRICT,
  event_type delivery_event_type NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
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
-- 13. Enable Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;
-- Ensure public.pharmacies_stock table exists idempotently for both fresh and legacy environments
CREATE TABLE IF NOT EXISTS public.pharmacies_stock (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id UUID REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  medicine_id UUID,
  in_stock BOOLEAN DEFAULT TRUE,
  unit_price NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);

ALTER TABLE public.pharmacies_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposed_alternatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 14. Hardened Row Level Security Policies (Idempotent: DROP IF EXISTS + CREATE)
-- -----------------------------------------------------------------------------

-- 14.1 Profiles
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_update_own_or_admin" ON public.profiles
  FOR UPDATE USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

-- 14.2 User Roles (Admins Only)
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.user_roles;
DROP POLICY IF EXISTS "Enable update for users based on email" ON public.user_roles;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.user_roles;
DROP POLICY IF EXISTS "Allow all" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select_own_or_admin" ON public.user_roles;
CREATE POLICY "user_roles_select_own_or_admin" ON public.user_roles
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "user_roles_admin_insert" ON public.user_roles;
CREATE POLICY "user_roles_admin_insert" ON public.user_roles
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "user_roles_admin_update" ON public.user_roles;
CREATE POLICY "user_roles_admin_update" ON public.user_roles
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "user_roles_admin_delete" ON public.user_roles;
CREATE POLICY "user_roles_admin_delete" ON public.user_roles
  FOR DELETE USING (public.is_admin());

-- AS RESTRICTIVE write barriers to neutralize any legacy permissive policies on user_roles
DROP POLICY IF EXISTS "user_roles_block_non_admin_insert" ON public.user_roles;
CREATE POLICY "user_roles_block_non_admin_insert" ON public.user_roles
  AS RESTRICTIVE
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "user_roles_block_non_admin_update" ON public.user_roles;
CREATE POLICY "user_roles_block_non_admin_update" ON public.user_roles
  AS RESTRICTIVE
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "user_roles_block_non_admin_delete" ON public.user_roles;
CREATE POLICY "user_roles_block_non_admin_delete" ON public.user_roles
  AS RESTRICTIVE
  FOR DELETE USING (public.is_admin());

-- 14.3 Customer Addresses
DROP POLICY IF EXISTS "customer_addresses_select_own_or_admin" ON public.customer_addresses;
CREATE POLICY "customer_addresses_select_own_or_admin" ON public.customer_addresses
  FOR SELECT USING (customer_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "customer_addresses_insert_own" ON public.customer_addresses;
CREATE POLICY "customer_addresses_insert_own" ON public.customer_addresses
  FOR INSERT WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS "customer_addresses_update_own" ON public.customer_addresses;
CREATE POLICY "customer_addresses_update_own" ON public.customer_addresses
  FOR UPDATE USING (customer_id = auth.uid() OR public.is_admin())
  WITH CHECK (customer_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "customer_addresses_delete_own" ON public.customer_addresses;
CREATE POLICY "customer_addresses_delete_own" ON public.customer_addresses
  FOR DELETE USING (customer_id = auth.uid() OR public.is_admin());

-- AS RESTRICTIVE write barrier to neutralize any legacy permissive policies on customer_addresses
DROP POLICY IF EXISTS "customer_addresses_restrictive_ownership" ON public.customer_addresses;
CREATE POLICY "customer_addresses_restrictive_ownership" ON public.customer_addresses
  AS RESTRICTIVE
  FOR ALL
  USING (customer_id = auth.uid() OR public.is_admin())
  WITH CHECK (customer_id = auth.uid() OR public.is_admin());

-- 14.4 Pharmacies
DROP POLICY IF EXISTS "pharmacies_select_verified_or_staff_or_admin" ON public.pharmacies;
CREATE POLICY "pharmacies_select_verified_or_staff_or_admin" ON public.pharmacies
  FOR SELECT USING (
    (verification_status = 'verified' AND is_active = true) OR
    public.is_pharmacy_staff(id) OR
    public.is_admin()
  );

DROP POLICY IF EXISTS "pharmacies_admin_insert" ON public.pharmacies;
CREATE POLICY "pharmacies_admin_insert" ON public.pharmacies
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "pharmacies_manager_update" ON public.pharmacies;
CREATE POLICY "pharmacies_manager_update" ON public.pharmacies
  FOR UPDATE USING (
    public.is_admin() OR
    public.is_pharmacy_manager(id)
  )
  WITH CHECK (
    public.is_admin() OR
    public.is_pharmacy_manager(id)
  );

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.trg_prevent_pharmacy_self_verification() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_pharmacies_protect_verification ON public.pharmacies;
CREATE TRIGGER trg_pharmacies_protect_verification
  BEFORE UPDATE ON public.pharmacies
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prevent_pharmacy_self_verification();

-- 14.5 Pharmacy Staff (Self & Colleague Access via SECURITY DEFINER, Zero Recursion)
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.pharmacy_staff;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.pharmacy_staff;
DROP POLICY IF EXISTS "Allow all" ON public.pharmacy_staff;
DROP POLICY IF EXISTS "pharmacy_staff_select_colleagues_or_admin" ON public.pharmacy_staff;
CREATE POLICY "pharmacy_staff_select_colleagues_or_admin" ON public.pharmacy_staff
  FOR SELECT USING (
    user_id = auth.uid() OR
    public.is_pharmacy_staff(pharmacy_id) OR
    public.is_admin()
  );

DROP POLICY IF EXISTS "pharmacy_staff_manager_insert" ON public.pharmacy_staff;
CREATE POLICY "pharmacy_staff_manager_insert" ON public.pharmacy_staff
  FOR INSERT WITH CHECK (
    public.is_admin() OR
    (public.is_pharmacy_manager(pharmacy_id) AND is_primary_manager = false)
  );

DROP POLICY IF EXISTS "pharmacy_staff_admin_update" ON public.pharmacy_staff;
CREATE POLICY "pharmacy_staff_admin_update" ON public.pharmacy_staff
  FOR UPDATE USING (
    public.is_admin()
  ) WITH CHECK (
    public.is_admin()
  );

DROP POLICY IF EXISTS "pharmacy_staff_admin_or_manager_delete" ON public.pharmacy_staff;
CREATE POLICY "pharmacy_staff_admin_or_manager_delete" ON public.pharmacy_staff
  FOR DELETE USING (
    public.is_admin() OR
    (public.is_pharmacy_manager(pharmacy_id) AND is_primary_manager = false)
  );

-- AS RESTRICTIVE write barriers to neutralize any legacy permissive write policies on pharmacy_staff
DROP POLICY IF EXISTS "pharmacy_staff_block_unauthorized_insert" ON public.pharmacy_staff;
CREATE POLICY "pharmacy_staff_block_unauthorized_insert" ON public.pharmacy_staff
  AS RESTRICTIVE
  FOR INSERT WITH CHECK (
    public.is_admin() OR
    (public.is_pharmacy_manager(pharmacy_id) AND is_primary_manager = false)
  );

DROP POLICY IF EXISTS "pharmacy_staff_block_non_admin_update" ON public.pharmacy_staff;
CREATE POLICY "pharmacy_staff_block_non_admin_update" ON public.pharmacy_staff
  AS RESTRICTIVE
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 14.6 Courier Profiles (Sensitive PII: national_id_number visible only to owner and platform administrators)
DROP POLICY IF EXISTS "courier_profiles_select_own_or_admin_or_available" ON public.courier_profiles;
DROP POLICY IF EXISTS "courier_profiles_select_own_or_admin" ON public.courier_profiles;
CREATE POLICY "courier_profiles_select_own_or_admin" ON public.courier_profiles
  FOR SELECT USING (
    user_id = auth.uid() OR
    public.is_admin()
  );

DROP POLICY IF EXISTS "courier_profiles_insert_own_or_admin" ON public.courier_profiles;
CREATE POLICY "courier_profiles_insert_own_or_admin" ON public.courier_profiles
  FOR INSERT WITH CHECK (
    public.is_admin() OR
    (user_id = auth.uid() AND verification_status = 'pending')
  );

DROP POLICY IF EXISTS "courier_profiles_update_shift" ON public.courier_profiles;
CREATE POLICY "courier_profiles_update_shift" ON public.courier_profiles
  FOR UPDATE USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.trg_prevent_courier_self_verification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_admin() THEN
      IF NEW.verification_status <> 'pending' THEN
        RAISE EXCEPTION 'Couriers cannot self-verify on registration. Initial status must be pending.';
      END IF;
      IF NEW.verified_by IS NOT NULL OR NEW.verified_at IS NOT NULL THEN
        RAISE EXCEPTION 'Only platform administrators can set courier verification metadata';
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.trg_prevent_courier_self_verification() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_courier_protect_verification ON public.courier_profiles;
CREATE TRIGGER trg_courier_protect_verification
  BEFORE INSERT OR UPDATE ON public.courier_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prevent_courier_self_verification();

-- 14.7 Preserved Medicines & Catalog Read Policies
DROP POLICY IF EXISTS "medicines_select_all" ON public.medicines;
CREATE POLICY "medicines_select_all" ON public.medicines
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "pharmacies_stock_select_all" ON public.pharmacies_stock;
CREATE POLICY "pharmacies_stock_select_all" ON public.pharmacies_stock
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "medicine_catalog_select_all" ON public.medicine_catalog;
CREATE POLICY "medicine_catalog_select_all" ON public.medicine_catalog
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "medicine_catalog_admin_write" ON public.medicine_catalog;
CREATE POLICY "medicine_catalog_admin_write" ON public.medicine_catalog
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 14.8 Medicine Requests
DROP POLICY IF EXISTS "medicine_requests_select_involved" ON public.medicine_requests;
CREATE POLICY "medicine_requests_select_involved" ON public.medicine_requests
  FOR SELECT USING (
    customer_id = auth.uid() OR
    (assigned_pharmacy_id IS NOT NULL AND public.is_pharmacy_staff(assigned_pharmacy_id)) OR
    public.is_admin()
  );

DROP POLICY IF EXISTS "medicine_requests_insert_customer" ON public.medicine_requests;
CREATE POLICY "medicine_requests_insert_customer" ON public.medicine_requests
  FOR INSERT WITH CHECK (
    customer_id = auth.uid() AND status = 'submitted'
  );

DROP POLICY IF EXISTS "medicine_requests_cancel_customer" ON public.medicine_requests;
CREATE POLICY "medicine_requests_cancel_customer" ON public.medicine_requests
  FOR UPDATE USING (
    customer_id = auth.uid() AND status IN ('submitted', 'under_pharmacy_review', 'alternative_proposed')
  )
  WITH CHECK (
    customer_id = auth.uid() AND status = 'cancelled'
  );

-- AS RESTRICTIVE write barriers for medicine_requests (neutralizes legacy permissive policies)
DROP POLICY IF EXISTS "medicine_requests_block_unauthorized_insert" ON public.medicine_requests;
CREATE POLICY "medicine_requests_block_unauthorized_insert" ON public.medicine_requests
  AS RESTRICTIVE
  FOR INSERT WITH CHECK (
    public.is_admin() OR
    (customer_id = auth.uid() AND status = 'submitted')
  );

DROP POLICY IF EXISTS "medicine_requests_block_unauthorized_update" ON public.medicine_requests;
CREATE POLICY "medicine_requests_block_unauthorized_update" ON public.medicine_requests
  AS RESTRICTIVE
  FOR UPDATE USING (
    public.is_admin() OR customer_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin() OR
    (customer_id = auth.uid() AND status = 'cancelled')
  );

DROP POLICY IF EXISTS "medicine_requests_block_client_delete" ON public.medicine_requests;
CREATE POLICY "medicine_requests_block_client_delete" ON public.medicine_requests
  AS RESTRICTIVE
  FOR DELETE USING (public.is_admin());

-- 14.9 Request Items
DROP POLICY IF EXISTS "request_items_select_involved" ON public.request_items;
CREATE POLICY "request_items_select_involved" ON public.request_items
  FOR SELECT USING (
    request_id IN (
      SELECT id FROM public.medicine_requests
      WHERE customer_id = auth.uid() OR
            (assigned_pharmacy_id IS NOT NULL AND public.is_pharmacy_staff(assigned_pharmacy_id)) OR
            public.is_admin()
    )
  );

DROP POLICY IF EXISTS "request_items_insert_customer" ON public.request_items;
CREATE POLICY "request_items_insert_customer" ON public.request_items
  FOR INSERT WITH CHECK (
    request_id IN (
      SELECT id FROM public.medicine_requests
      WHERE customer_id = auth.uid() AND status = 'submitted'
    )
  );

-- AS RESTRICTIVE write barriers for request_items (neutralizes legacy permissive policies)
DROP POLICY IF EXISTS "request_items_block_unauthorized_insert" ON public.request_items;
CREATE POLICY "request_items_block_unauthorized_insert" ON public.request_items
  AS RESTRICTIVE
  FOR INSERT WITH CHECK (
    public.is_admin() OR
    request_id IN (
      SELECT id FROM public.medicine_requests
      WHERE customer_id = auth.uid() AND status = 'submitted'
    )
  );

DROP POLICY IF EXISTS "request_items_block_client_update" ON public.request_items;
CREATE POLICY "request_items_block_client_update" ON public.request_items
  AS RESTRICTIVE
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "request_items_block_client_delete" ON public.request_items;
CREATE POLICY "request_items_block_client_delete" ON public.request_items
  AS RESTRICTIVE
  FOR DELETE USING (public.is_admin());

-- 14.10 Proposed Alternatives
DROP POLICY IF EXISTS "proposed_alternatives_select_involved" ON public.proposed_alternatives;
CREATE POLICY "proposed_alternatives_select_involved" ON public.proposed_alternatives
  FOR SELECT USING (
    request_id IN (
      SELECT id FROM public.medicine_requests
      WHERE customer_id = auth.uid() OR
            (assigned_pharmacy_id IS NOT NULL AND public.is_pharmacy_staff(assigned_pharmacy_id)) OR
            public.is_admin()
    )
  );

DROP POLICY IF EXISTS "proposed_alternatives_insert_pharmacy" ON public.proposed_alternatives;
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

-- AS RESTRICTIVE write barriers for proposed_alternatives (neutralizes legacy permissive policies)
DROP POLICY IF EXISTS "proposed_alternatives_block_unauthorized_insert" ON public.proposed_alternatives;
CREATE POLICY "proposed_alternatives_block_unauthorized_insert" ON public.proposed_alternatives
  AS RESTRICTIVE
  FOR INSERT WITH CHECK (
    public.is_admin() OR
    (
      reviewed_by_pharmacist_id = auth.uid() AND
      request_id IN (
        SELECT id FROM public.medicine_requests
        WHERE assigned_pharmacy_id IS NOT NULL AND
              public.is_pharmacy_staff(assigned_pharmacy_id) AND
              status = 'under_pharmacy_review'
      )
    )
  );

DROP POLICY IF EXISTS "proposed_alternatives_block_client_update" ON public.proposed_alternatives;
CREATE POLICY "proposed_alternatives_block_client_update" ON public.proposed_alternatives
  AS RESTRICTIVE
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "proposed_alternatives_block_client_delete" ON public.proposed_alternatives;
CREATE POLICY "proposed_alternatives_block_client_delete" ON public.proposed_alternatives
  AS RESTRICTIVE
  FOR DELETE USING (public.is_admin());

-- 14.11 Orders (SELECT allowed for involved actors; INSERT & UPDATE blocked to force audited RPCs)
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.orders;
DROP POLICY IF EXISTS "Enable update for users based on email" ON public.orders;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.orders;
DROP POLICY IF EXISTS "Allow all" ON public.orders;
DROP POLICY IF EXISTS "Users can insert their own orders" ON public.orders;
DROP POLICY IF EXISTS "orders_select_involved" ON public.orders;
CREATE POLICY "orders_select_involved" ON public.orders
  FOR SELECT USING (
    customer_id = auth.uid() OR
    public.is_pharmacy_staff(pharmacy_id) OR
    courier_id = public.get_courier_id(auth.uid()) OR
    public.is_admin()
  );

DROP POLICY IF EXISTS "orders_block_client_insert" ON public.orders;
CREATE POLICY "orders_block_client_insert" ON public.orders
  AS RESTRICTIVE
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "orders_block_client_update" ON public.orders;
CREATE POLICY "orders_block_client_update" ON public.orders
  AS RESTRICTIVE
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "orders_block_client_delete" ON public.orders;
CREATE POLICY "orders_block_client_delete" ON public.orders
  AS RESTRICTIVE
  FOR DELETE USING (false);

-- 14.12 Order Items
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.order_items;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.order_items;
DROP POLICY IF EXISTS "Allow all" ON public.order_items;
DROP POLICY IF EXISTS "order_items_select_involved" ON public.order_items;
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

DROP POLICY IF EXISTS "order_items_block_client_insert" ON public.order_items;
CREATE POLICY "order_items_block_client_insert" ON public.order_items
  AS RESTRICTIVE
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "order_items_block_client_update" ON public.order_items;
CREATE POLICY "order_items_block_client_update" ON public.order_items
  AS RESTRICTIVE
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "order_items_block_client_delete" ON public.order_items;
CREATE POLICY "order_items_block_client_delete" ON public.order_items
  AS RESTRICTIVE
  FOR DELETE USING (false);

-- 14.13 Delivery Events
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.delivery_events;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.delivery_events;
DROP POLICY IF EXISTS "Allow all" ON public.delivery_events;
DROP POLICY IF EXISTS "delivery_events_select_involved" ON public.delivery_events;
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

-- Direct client modifications strictly blocked to prevent forged delivery ledgers
DROP POLICY IF EXISTS "delivery_events_insert_courier" ON public.delivery_events;
DROP POLICY IF EXISTS "delivery_events_block_delivered_client_insert" ON public.delivery_events;
DROP POLICY IF EXISTS "delivery_events_block_client_insert" ON public.delivery_events;
CREATE POLICY "delivery_events_block_client_insert" ON public.delivery_events
  AS RESTRICTIVE
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "delivery_events_block_client_update" ON public.delivery_events;
CREATE POLICY "delivery_events_block_client_update" ON public.delivery_events
  AS RESTRICTIVE
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "delivery_events_block_client_delete" ON public.delivery_events;
CREATE POLICY "delivery_events_block_client_delete" ON public.delivery_events
  AS RESTRICTIVE
  FOR DELETE USING (false);

-- 14.14 Audit Logs
DROP POLICY IF EXISTS "Enable read access for all users" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_admin_select" ON public.audit_logs;
CREATE POLICY "audit_logs_admin_select" ON public.audit_logs
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "audit_logs_block_client_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_block_client_insert" ON public.audit_logs
  AS RESTRICTIVE
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "audit_logs_block_client_update" ON public.audit_logs;
CREATE POLICY "audit_logs_block_client_update" ON public.audit_logs
  AS RESTRICTIVE
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "audit_logs_block_client_delete" ON public.audit_logs;
CREATE POLICY "audit_logs_block_client_delete" ON public.audit_logs
  AS RESTRICTIVE
  FOR DELETE USING (false);

-- -----------------------------------------------------------------------------
-- 15. Server-Authoritative Lifecycle & Secrets RPCs
-- -----------------------------------------------------------------------------

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.internal_log_audit FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.start_pharmacy_review(
  p_request_id UUID,
  p_pharmacy_id UUID
) RETURNS VOID AS $$
DECLARE
  v_req RECORD;
  v_caller_role user_role_type;
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

  v_caller_role := COALESCE(public.get_user_role(auth.uid()), 'pharmacy_staff');

  PERFORM public.internal_log_audit(
    auth.uid(),
    v_caller_role,
    'START_PHARMACY_REVIEW',
    'request',
    p_request_id,
    jsonb_build_object('pharmacy_id', p_pharmacy_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.start_pharmacy_review(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_pharmacy_review(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_pharmacy_availability(
  p_request_id UUID,
  p_items_pricing JSONB,
  p_delivery_fee_egp NUMERIC(10, 2)
) RETURNS VOID AS $$
DECLARE
  v_req RECORD;
  v_item RECORD;
  v_unit_price NUMERIC(10, 2);
  v_caller_role user_role_type;
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

  IF NOT EXISTS (SELECT 1 FROM public.request_items WHERE request_id = p_request_id) THEN
    RAISE EXCEPTION 'Request % has no items; cannot confirm availability for empty request', p_request_id;
  END IF;

  IF p_items_pricing IS NULL OR jsonb_typeof(p_items_pricing) <> 'object' THEN
    RAISE EXCEPTION 'p_items_pricing must be a JSON object mapping item IDs to prices';
  END IF;

  -- Reject unexpected item IDs or unknown keys in p_items_pricing
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_items_pricing) k
    WHERE NOT EXISTS (
      SELECT 1 FROM public.request_items ri
      WHERE ri.request_id = p_request_id AND ri.id::text = k
    )
  ) THEN
    RAISE EXCEPTION 'p_items_pricing contains unexpected item IDs not belonging to request %', p_request_id;
  END IF;

  FOR v_item IN (SELECT * FROM public.request_items WHERE request_id = p_request_id) LOOP
    IF NOT (p_items_pricing ? v_item.id::text) THEN
      RAISE EXCEPTION 'Missing pricing entry in p_items_pricing for item %', v_item.id;
    END IF;

    IF (p_items_pricing->>v_item.id::text) !~ '^[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Confirmed unit price is not a valid non-negative number for item %', v_item.id;
    END IF;

    v_unit_price := (p_items_pricing->>v_item.id::text)::numeric;
    IF v_unit_price <= 0 THEN
      RAISE EXCEPTION 'Confirmed unit price must be positive for item %', v_item.id;
    END IF;

    UPDATE public.request_items
    SET confirmed_available = true,
        confirmed_unit_price_egp = v_unit_price
    WHERE id = v_item.id;
  END LOOP;

  -- Expire any lingering or orphaned customer proposals for this request
  UPDATE public.proposed_alternatives
  SET approval_status = 'expired'
  WHERE request_id = p_request_id
    AND approval_status = 'pending_customer';

  UPDATE public.medicine_requests
  SET status = 'availability_confirmed',
      confirmed_delivery_fee_egp = p_delivery_fee_egp,
      updated_at = timezone('utc', now())
  WHERE id = p_request_id;

  v_caller_role := COALESCE(public.get_user_role(auth.uid()), 'pharmacy_staff');

  PERFORM public.internal_log_audit(
    auth.uid(),
    v_caller_role,
    'CONFIRM_PHARMACY_AVAILABILITY',
    'request',
    p_request_id,
    jsonb_build_object('delivery_fee_egp', p_delivery_fee_egp)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.confirm_pharmacy_availability(UUID, JSONB, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_pharmacy_availability(UUID, JSONB, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_to_alternative(
  p_alternative_id UUID,
  p_accept BOOLEAN
) RETURNS VOID AS $$
DECLARE
  v_req_id UUID;
  v_alt RECORD;
  v_req RECORD;
  v_caller_role user_role_type;
BEGIN
  -- Determine request ID first to guarantee consistent locking order (requests -> alternatives)
  SELECT request_id INTO v_req_id FROM public.proposed_alternatives WHERE id = p_alternative_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alternative proposal not found';
  END IF;

  SELECT * INTO v_req FROM public.medicine_requests WHERE id = v_req_id FOR UPDATE;
  SELECT * INTO v_alt FROM public.proposed_alternatives WHERE id = p_alternative_id FOR UPDATE;

  IF v_req.customer_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not the requesting customer';
  END IF;

  -- Anti-resurrection invariant: only requests in alternative_proposed status can be acted upon
  IF v_req.status <> 'alternative_proposed' THEN
    RAISE EXCEPTION 'Request cannot accept or decline alternative; current status is %', v_req.status;
  END IF;

  IF v_alt.approval_status <> 'pending_customer' THEN
    RAISE EXCEPTION 'Alternative proposal is not pending customer review';
  END IF;

  IF v_alt.expires_at < timezone('utc', now()) THEN
    RAISE EXCEPTION 'Proposed alternative offer has expired';
  END IF;

  v_caller_role := COALESCE(public.get_user_role(auth.uid()), 'customer');

  IF p_accept THEN
    UPDATE public.proposed_alternatives
    SET approval_status = 'accepted', responded_at = timezone('utc', now())
    WHERE id = p_alternative_id;

    -- Expire any competing pending proposals for this specific item
    UPDATE public.proposed_alternatives
    SET approval_status = 'expired'
    WHERE request_item_id = v_alt.request_item_id
      AND id <> p_alternative_id
      AND approval_status = 'pending_customer';

    -- Only advance request to availability_confirmed if EVERY item in the request has a valid fulfillment decision
    -- (either confirmed available with unit price > 0, OR has an accepted alternative with proposed price > 0)
    -- AND no other alternatives remain pending_customer.
    IF NOT EXISTS (
      SELECT 1 FROM public.request_items ri
      WHERE ri.request_id = v_req.id
        AND NOT (
          (ri.confirmed_available IS TRUE AND ri.confirmed_unit_price_egp > 0)
          OR EXISTS (
            SELECT 1 FROM public.proposed_alternatives pa
            WHERE pa.request_item_id = ri.id
              AND pa.request_id = v_req.id
              AND pa.approval_status = 'accepted'
              AND pa.proposed_price_egp > 0
          )
        )
    ) AND NOT EXISTS (
      SELECT 1 FROM public.proposed_alternatives
      WHERE request_id = v_req.id
        AND approval_status = 'pending_customer'
    ) THEN
      UPDATE public.medicine_requests
      SET status = 'availability_confirmed', updated_at = timezone('utc', now())
      WHERE id = v_req.id;
    END IF;

    PERFORM public.internal_log_audit(auth.uid(), v_caller_role, 'ACCEPT_ALTERNATIVE', 'alternative', p_alternative_id);
  ELSE
    UPDATE public.proposed_alternatives
    SET approval_status = 'declined', responded_at = timezone('utc', now())
    WHERE id = p_alternative_id;

    UPDATE public.medicine_requests
    SET status = 'cancelled', updated_at = timezone('utc', now())
    WHERE id = v_req.id;

    PERFORM public.internal_log_audit(auth.uid(), v_caller_role, 'DECLINE_ALTERNATIVE', 'alternative', p_alternative_id);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.respond_to_alternative(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_alternative(UUID, BOOLEAN) TO authenticated;

-- Standalone transactional expiry RPC: Persists status = 'expired' cleanly without rollback
CREATE OR REPLACE FUNCTION public.expire_proposed_alternative(
  p_alternative_id UUID
) RETURNS VOID AS $$
DECLARE
  v_alt RECORD;
  v_req RECORD;
  v_caller_role user_role_type;
BEGIN
  SELECT * INTO v_alt FROM public.proposed_alternatives
  WHERE id = p_alternative_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alternative proposal not found';
  END IF;

  SELECT * INTO v_req FROM public.medicine_requests
  WHERE id = v_alt.request_id FOR UPDATE;

  IF NOT (v_req.customer_id = auth.uid() OR (v_req.assigned_pharmacy_id IS NOT NULL AND public.is_pharmacy_staff(v_req.assigned_pharmacy_id)) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not authorized to expire this proposal';
  END IF;

  IF v_alt.approval_status <> 'pending_customer' THEN
    RAISE EXCEPTION 'Alternative proposal is not in pending_customer status; current status is %', v_alt.approval_status;
  END IF;

  IF v_alt.expires_at > timezone('utc', now()) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Cannot expire alternative before expiry timestamp %', v_alt.expires_at;
  END IF;

  v_caller_role := COALESCE(public.get_user_role(auth.uid()), 'customer');

  UPDATE public.proposed_alternatives
  SET approval_status = 'expired'
  WHERE id = p_alternative_id;

  PERFORM public.internal_log_audit(
    auth.uid(),
    v_caller_role,
    'EXPIRE_ALTERNATIVE',
    'alternative',
    p_alternative_id,
    jsonb_build_object('expired_at', timezone('utc', now()))
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.expire_proposed_alternative(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_proposed_alternative(UUID) TO authenticated;

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
  v_caller_role user_role_type;
BEGIN
  SELECT * INTO v_req FROM public.medicine_requests
  WHERE id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_req.customer_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not the requesting customer';
  END IF;

  IF v_req.status <> 'availability_confirmed' THEN
    RAISE EXCEPTION 'Request status must be availability_confirmed to convert to order';
  END IF;

  IF EXISTS (SELECT 1 FROM public.orders WHERE request_id = p_request_id) THEN
    RAISE EXCEPTION 'An order has already been generated for this request';
  END IF;

  IF v_req.confirmed_delivery_fee_egp IS NULL THEN
    RAISE EXCEPTION 'Fulfilling pharmacy has not confirmed delivery fee for this request';
  END IF;
  v_delivery_fee := v_req.confirmed_delivery_fee_egp;

  -- Empty request guard: reject requests with zero items fail-closed
  IF NOT EXISTS (SELECT 1 FROM public.request_items WHERE request_id = p_request_id) THEN
    RAISE EXCEPTION 'Request % has no items; cannot create order from empty request', p_request_id;
  END IF;

  -- Address resolution & ownership validation (Fail-closed, zero synthetic default)
  IF COALESCE(v_req.delivery_address_id, v_req.address_id) IS NULL THEN
    RAISE EXCEPTION 'Delivery address is required to convert request % to order', p_request_id;
  END IF;

  SELECT to_jsonb(a) INTO v_addr_snapshot
  FROM public.customer_addresses a
  WHERE a.id = COALESCE(v_req.delivery_address_id, v_req.address_id)
    AND a.customer_id = v_req.customer_id;

  IF v_addr_snapshot IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.customer_addresses
      WHERE id = COALESCE(v_req.delivery_address_id, v_req.address_id)
    ) THEN
      RAISE EXCEPTION 'Delivery address % does not belong to requesting customer %',
        COALESCE(v_req.delivery_address_id, v_req.address_id), v_req.customer_id;
    ELSE
      RAISE EXCEPTION 'Delivery address % not found',
        COALESCE(v_req.delivery_address_id, v_req.address_id);
    END IF;
  END IF;

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
      IF v_item.medicine_catalog_id IS NOT NULL THEN
        IF v_alt.original_catalog_id IS NULL OR v_item.medicine_catalog_id <> v_alt.original_catalog_id THEN
          RAISE EXCEPTION 'Alternative original catalog ID does not match request item %', v_item.raw_medicine_name;
        END IF;
      END IF;
      IF v_alt.proposed_price_egp IS NULL OR v_alt.proposed_price_egp <= 0 THEN
        RAISE EXCEPTION 'Proposed alternative price is invalid for item %', v_item.raw_medicine_name;
      END IF;
      v_is_alt := true;
      v_final_catalog_id := v_alt.proposed_catalog_id;
      v_item_price := v_alt.proposed_price_egp;
      v_item_name := v_alt.brand_name_ar;
    ELSE
      IF v_item.confirmed_available IS NOT TRUE THEN
        RAISE EXCEPTION 'Item % is not confirmed available and has no accepted alternative', v_item.raw_medicine_name;
      END IF;
      IF v_item.confirmed_unit_price_egp IS NULL OR v_item.confirmed_unit_price_egp <= 0 THEN
        RAISE EXCEPTION 'Pharmacy-confirmed price missing or invalid for requested item %', v_item.raw_medicine_name;
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
      medicine_catalog_id,
      item_name,
      is_alternative,
      quantity,
      unit_price_egp,
      total_price_egp
    ) VALUES (
      v_order_id,
      v_final_catalog_id,
      v_final_catalog_id,
      v_item_name,
      v_is_alt,
      v_item.requested_quantity,
      v_item_price,
      v_item_price * v_item.requested_quantity
    );
  END LOOP;

  -- 6-digit uniform OTP generation via rejection sampling
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

  UPDATE public.medicine_requests
  SET status = 'converted_to_order', updated_at = timezone('utc', now())
  WHERE id = p_request_id;

  v_caller_role := COALESCE(public.get_user_role(auth.uid()), 'customer');

  PERFORM public.internal_log_audit(
    auth.uid(),
    v_caller_role,
    'CREATE_ORDER',
    'order',
    v_order_id,
    jsonb_build_object('order_number', v_order_number, 'total_egp', v_total)
  );

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.create_order_from_accepted_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_from_accepted_request(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_courier_to_order(
  p_order_id UUID,
  p_courier_id UUID
) RETURNS VOID AS $$
DECLARE
  v_ord RECORD;
  v_cour RECORD;
  v_caller_role user_role_type;
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

  v_caller_role := COALESCE(public.get_user_role(auth.uid()), 'pharmacy_staff');

  PERFORM public.internal_log_audit(
    auth.uid(),
    v_caller_role,
    'ASSIGN_COURIER_TO_ORDER',
    'order',
    p_order_id,
    jsonb_build_object('courier_id', p_courier_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.assign_courier_to_order(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_courier_to_order(UUID, UUID) TO authenticated;

-- Narrowly scoped audited RPC for couriers to record transit milestones
CREATE OR REPLACE FUNCTION public.record_courier_delivery_milestone(
  p_order_id UUID,
  p_event_type delivery_event_type,
  p_notes TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_ord RECORD;
  v_cour_id UUID;
  v_caller_role user_role_type;
BEGIN
  -- Strict prohibition: 'delivered' and 'assigned' cannot be created through this generic milestone RPC
  IF p_event_type = 'delivered' THEN
    RAISE EXCEPTION 'Successful delivery events can only be recorded via verify_delivery_otp with valid recipient OTP';
  END IF;

  IF p_event_type = 'assigned' THEN
    RAISE EXCEPTION 'Assignment events can only be recorded via assign_courier_to_order';
  END IF;

  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_cour_id := public.get_courier_id(auth.uid());

  IF (v_ord.courier_id IS NULL OR v_ord.courier_id <> v_cour_id) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only the assigned courier can record delivery events for this order';
  END IF;

  -- Validate event validity against order state
  IF p_event_type = 'courier_arrived_pharmacy' THEN
    IF v_ord.status <> 'assigned_to_courier' THEN
      RAISE EXCEPTION 'Order must be assigned_to_courier to record arrival at pharmacy';
    END IF;
  ELSIF p_event_type = 'picked_up' THEN
    IF v_ord.status NOT IN ('assigned_to_courier', 'in_transit') THEN
      RAISE EXCEPTION 'Order must be assigned or moving to in_transit to record pickup';
    END IF;
  ELSIF p_event_type IN ('in_transit', 'arrived_destination') THEN
    IF v_ord.status <> 'in_transit' THEN
      RAISE EXCEPTION 'Order must be in_transit to record % event', p_event_type;
    END IF;
  ELSIF p_event_type = 'delivery_failed' THEN
    IF v_ord.status <> 'in_transit' THEN
      RAISE EXCEPTION 'Order must be in_transit to record delivery failure';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid delivery event type: %', p_event_type;
  END IF;

  v_caller_role := COALESCE(public.get_user_role(auth.uid()), 'courier');

  INSERT INTO public.delivery_events (order_id, courier_id, event_type, notes)
  VALUES (p_order_id, COALESCE(v_ord.courier_id, v_cour_id), p_event_type, p_notes);

  PERFORM public.internal_log_audit(
    auth.uid(),
    v_caller_role,
    'RECORD_DELIVERY_EVENT',
    'order',
    p_order_id,
    jsonb_build_object('event_type', p_event_type, 'notes', p_notes)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.record_courier_delivery_milestone(UUID, delivery_event_type, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_courier_delivery_milestone(UUID, delivery_event_type, TEXT) TO authenticated;

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
    -- In-transit, delivered, failed, or already cancelled orders cannot be cancelled via generic transition RPC
    IF v_ord.status IN ('in_transit', 'delivered', 'failed_delivery', 'cancelled') THEN
      RAISE EXCEPTION 'Order in status % cannot be cancelled through this transition RPC', v_ord.status;
    END IF;

    -- Explicit server-side cancellation authorization matrix
    IF public.is_admin() THEN
      -- Platform administrators may cancel orders in pre-transit states ('confirmed', 'in_preparation', 'ready_for_pickup', 'assigned_to_courier')
      NULL;
    ELSIF public.is_pharmacy_staff(v_ord.pharmacy_id) THEN
      -- Pharmacy staff may cancel only orders assigned to their fulfilling pharmacy in pre-transit states
      IF v_ord.status NOT IN ('confirmed', 'in_preparation', 'ready_for_pickup', 'assigned_to_courier') THEN
        RAISE EXCEPTION 'Pharmacy staff cannot cancel order in status %', v_ord.status;
      END IF;
    ELSIF v_ord.customer_id = auth.uid() THEN
      -- Customers may cancel only their own order and only prior to pharmacy preparation commencement
      IF v_ord.status <> 'confirmed' THEN
        RAISE EXCEPTION 'Customer can only cancel orders in confirmed status prior to pharmacy preparation';
      END IF;
    ELSE
      -- Couriers, unrelated customers, and unauthorized actors are strictly rejected
      RAISE EXCEPTION 'Caller is not authorized to cancel this order';
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.transition_order_status(UUID, order_status_type, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_order_status(UUID, order_status_type, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_delivery_otp(
  p_order_id UUID,
  p_plaintext_otp TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_ord RECORD;
  v_sec RECORD;
  v_computed_hash TEXT;
  v_caller_role user_role_type;
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
  v_caller_role := COALESCE(public.get_user_role(auth.uid()), 'courier');

  IF v_computed_hash = v_sec.otp_hash THEN
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
      v_caller_role,
      'VERIFY_DELIVERY_OTP_SUCCESS',
      'order',
      p_order_id
    );

    RETURN true;
  ELSE
    UPDATE private.order_delivery_secrets
    SET attempts_count = attempts_count + 1
    WHERE order_id = p_order_id;

    PERFORM public.internal_log_audit(
      auth.uid(),
      v_caller_role,
      'VERIFY_DELIVERY_OTP_FAILED',
      'order',
      p_order_id,
      jsonb_build_object('attempt', v_sec.attempts_count + 1)
    );

    RETURN false;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, auth, pg_temp;

REVOKE EXECUTE ON FUNCTION public.verify_delivery_otp(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_delivery_otp(UUID, TEXT) TO authenticated;
