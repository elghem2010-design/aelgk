-- ==============================================================================
-- ElajX (علاجك) — Legacy Baseline Fixture for Staging Scenario B
-- File: supabase/staging/01_legacy_baseline_fixture.sql
-- Purpose: Reproduces legacy schema state (public.medicines and pharmacies_stock)
--          with 33 baseline rows prior to executing the reconciliation migration.
-- ==============================================================================

-- 1. Create legacy public.medicines table as defined in project brief
CREATE TABLE IF NOT EXISTS public.medicines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  active_ingredient TEXT,
  dosage_form TEXT,
  strength TEXT,
  manufacturer TEXT,
  alternative_price NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- 2. Populate 33 representative baseline legacy medicines
INSERT INTO public.medicines (id, name, active_ingredient, dosage_form, strength, manufacturer, alternative_price)
VALUES
  ('a0000001-0000-0000-0000-000000000001', 'Panadol Extra (بانادول إكسترا)', 'Paracetamol 500mg + Caffeine 65mg', 'Tablet', '500mg/65mg', 'GSK Egypt', 45.00),
  ('a0000001-0000-0000-0000-000000000002', 'Cataflam 50mg (كتافلام)', 'Diclofenac Potassium', 'Tablet', '50mg', 'Novartis Egypt', 38.50),
  ('a0000001-0000-0000-0000-000000000003', 'Augmentin 1g (أوجمنتين)', 'Amoxicillin + Clavulanic Acid', 'Tablet', '1000mg', 'GSK Egypt', 115.00),
  ('a0000001-0000-0000-0000-000000000004', 'Concor 5mg (كونكور)', 'Bisoprolol Fumarate', 'Tablet', '5mg', 'Merck', 54.00),
  ('a0000001-0000-0000-0000-000000000005', 'Antinal (أنتينال)', 'Nifuroxazide', 'Capsule', '200mg', 'Amoun Pharmaceuticals', 32.00),
  ('a0000001-0000-0000-0000-000000000006', 'Flagyl 500mg (فلاجيل)', 'Metronidazole', 'Tablet', '500mg', 'Sanofi Egypt', 26.00),
  ('a0000001-0000-0000-0000-000000000007', 'Glucophage 1000mg (جلوكوفاج)', 'Metformin HCl', 'Tablet', '1000mg', 'Merck', 42.00),
  ('a0000001-0000-0000-0000-000000000008', 'Lipitor 20mg (ليبيتور)', 'Atorvastatin Calcium', 'Tablet', '20mg', 'Pfizer', 145.00),
  ('a0000001-0000-0000-0000-000000000009', 'Nexium 40mg (نيكسيوم)', 'Esomeprazole', 'Tablet', '40mg', 'AstraZeneca', 198.00),
  ('a0000001-0000-0000-0000-000000000010', 'Ventolin Evohaler (فنتولين)', 'Salbutamol', 'Inhaler', '100mcg', 'GSK Egypt', 65.00),
  ('a0000001-0000-0000-0000-000000000011', 'Brufen 400mg (بروفين)', 'Ibuprofen', 'Tablet', '400mg', 'Abbott', 36.00),
  ('a0000001-0000-0000-0000-000000000012', 'Voltaren 100mg SR (فولتارين)', 'Diclofenac Sodium', 'Tablet', '100mg', 'Novartis', 68.00),
  ('a0000001-0000-0000-0000-000000000013', 'Amoclan 1g (أموكلان)', 'Amoxicillin + Clavulanate', 'Tablet', '1g', 'Hikma', 95.00),
  ('a0000001-0000-0000-0000-000000000014', 'Ketofan 50mg (كيتوفان)', 'Ketoprofen', 'Capsule', '50mg', 'Amoun', 24.00),
  ('a0000001-0000-0000-0000-000000000015', 'Ciprolon 500mg (سيبرولون)', 'Ciprofloxacin', 'Tablet', '500mg', 'EVA Pharma', 48.00),
  ('a0000001-0000-0000-0000-000000000016', 'Zithrokan 500mg (زيثروكان)', 'Azithromycin', 'Capsule', '500mg', 'Hikma', 58.00),
  ('a0000001-0000-0000-0000-000000000017', 'Controloc 40mg (كونترولوك)', 'Pantoprazole', 'Tablet', '40mg', 'Takeda', 120.00),
  ('a0000001-0000-0000-0000-000000000018', 'Gastrazole 20mg (جاسترازول)', 'Omeprazole', 'Capsule', '20mg', 'SEDICO', 34.00),
  ('a0000001-0000-0000-0000-000000000019', 'Epanutin 100mg (إيبانوتين)', 'Phenytoin Sodium', 'Capsule', '100mg', 'Pfizer', 40.00),
  ('a0000001-0000-0000-0000-000000000020', 'Tegretol 200mg (تجريتول)', 'Carbamazepine', 'Tablet', '200mg', 'Novartis', 52.00),
  ('a0000001-0000-0000-0000-000000000021', 'Amaryl 2mg (أماريل)', 'Glimepiride', 'Tablet', '2mg', 'Sanofi', 44.00),
  ('a0000001-0000-0000-0000-000000000022', 'Januvia 100mg (جانوڤيا)', 'Sitagliptin', 'Tablet', '100mg', 'MSD', 210.00),
  ('a0000001-0000-0000-0000-000000000023', 'Exforge 5/160 (إكسفورج)', 'Amlodipine + Valsartan', 'Tablet', '5/160mg', 'Novartis', 185.00),
  ('a0000001-0000-0000-0000-000000000024', 'Plavix 75mg (بلافيكس)', 'Clopidogrel', 'Tablet', '75mg', 'Sanofi', 240.00),
  ('a0000001-0000-0000-0000-000000000025', 'Crestor 10mg (كريستور)', 'Rosuvastatin', 'Tablet', '10mg', 'AstraZeneca', 190.00),
  ('a0000001-0000-0000-0000-000000000026', 'Ator 20mg (أتور)', 'Atorvastatin', 'Tablet', '20mg', 'EIPICO', 45.00),
  ('a0000001-0000-0000-0000-000000000027', 'Otrivin Adult 0.1% (أوتريفين)', 'Xylometazoline HCl', 'Nasal Drops', '0.1%', 'GSK Egypt', 18.00),
  ('a0000001-0000-0000-0000-000000000028', 'Claritin 10mg (كلاريتين)', 'Loratadine', 'Tablet', '10mg', 'Bayer', 55.00),
  ('a0000001-0000-0000-0000-000000000029', 'Zyrtec 10mg (زيرتك)', 'Cetirizine HCl', 'Tablet', '10mg', 'GSK Egypt', 48.00),
  ('a0000001-0000-0000-0000-000000000030', 'Alphintern (ألفانترن)', 'Chymotrypsin + Trypsin', 'Tablet', '300nkat', 'Amoun', 42.00),
  ('a0000001-0000-0000-0000-000000000031', 'Strepsils Honey & Lemon (ستربسلز)', 'Dichlorobenzyl Alcohol + Amylmetacresol', 'Lozenge', 'Standard', 'Reckitt', 75.00),
  ('a0000001-0000-0000-0000-000000000032', 'Gaviscon Liquid (جافيسكون)', 'Sodium Alginate + Potassium Bicarbonate', 'Suspension', '150ml', 'Reckitt', 90.00),
  ('a0000001-0000-0000-0000-000000000033', 'Dettol Antiseptic (ديتول مطهر)', 'Chloroxylenol', 'Liquid', '125ml', 'Reckitt', 48.00)
ON CONFLICT (id) DO NOTHING;

-- 3. Create legacy public.pharmacies_stock baseline table as documented
CREATE TABLE IF NOT EXISTS public.pharmacies_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID,
  medicine_id UUID REFERENCES public.medicines(id) ON DELETE CASCADE,
  in_stock BOOLEAN DEFAULT TRUE,
  unit_price NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- Populate 33 baseline stock entries matching the 33 legacy medicines
INSERT INTO public.pharmacies_stock (id, medicine_id, in_stock, unit_price)
SELECT
  ('s0000001-0000-0000-0000-' || substr(m.id::text, 25, 12))::uuid,
  m.id,
  true,
  m.alternative_price
FROM public.medicines m
ON CONFLICT (id) DO NOTHING;

