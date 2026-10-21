import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { MedicineCatalogItem } from '../types';
import { FIXTURE_CATALOG } from '../data/developmentFixtures';

/**
 * Safely parses the maximum regulated price from database records.
 * Invariants:
 * - Never maps alternative_price to maxRegulatedPriceEgp without authoritative proof.
 * - Never converts an unknown price into a misleading confirmed value of 0.
 * - Preserves missing, null, undefined, empty, or non-positive price values strictly as null.
 */
export function parseRegulatedPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

/**
 * Searches and filters Egyptian medicine catalog.
 * Connects to PostgreSQL table `medicine_catalog` when Supabase is configured;
 * otherwise queries in-memory fixture catalog.
 */
export async function searchMedicineCatalog(
  query: string = '',
  category: string = 'all',
  prescriptionFilter: 'all' | 'otc' | 'rx' = 'all'
): Promise<MedicineCatalogItem[]> {
  if (isSupabaseConfigured && supabase) {
    try {
      let req = supabase.from('medicine_catalog').select('*');

      if (query.trim()) {
        const cleanQuery = query.trim();
        req = req.or(
          `brand_name_ar.ilike.%${cleanQuery}%,brand_name_en.ilike.%${cleanQuery}%,active_ingredient.ilike.%${cleanQuery}%`
        );
      }

      if (category !== 'all') {
        req = req.eq('category', category);
      }

      if (prescriptionFilter === 'otc') {
        req = req.eq('requires_prescription', false);
      } else if (prescriptionFilter === 'rx') {
        req = req.eq('requires_prescription', true);
      }

      const { data, error } = await req.order('brand_name_ar', { ascending: true }).limit(50);

      if (!error && data && data.length > 0) {
        return data.map((item) => ({
          id: item.id,
          brandNameAr: item.brand_name_ar,
          brandNameEn: item.brand_name_en,
          activeIngredient: item.active_ingredient,
          dosageForm: item.dosage_form,
          strength: item.strength,
          packSize: item.pack_size,
          manufacturer: item.manufacturer,
          maxRegulatedPriceEgp: parseRegulatedPrice(item.max_regulated_price_egp),
          requiresPrescription: item.requires_prescription,
          category: item.category,
        }));
      }

      // Direct fallback to connected database medicines table
      let medReq = supabase.from('medicines').select('*');
      if (query.trim()) {
        const cleanQuery = query.trim();
        medReq = medReq.or(`name.ilike.%${cleanQuery}%,active_ingredient.ilike.%${cleanQuery}%`);
      }
      if (prescriptionFilter === 'otc') {
        medReq = medReq.eq('prescription_required', false);
      } else if (prescriptionFilter === 'rx') {
        medReq = medReq.eq('prescription_required', true);
      }

      const { data: medData, error: medError } = await medReq.order('name', { ascending: true }).limit(50);
      if (!medError && medData && medData.length > 0) {
        return medData.map((item) => {
          const nameParts = (item.name || '').split('(');
          const arabicPart = nameParts[0]?.trim() || item.name_ar || item.name || '';
          const englishPart = nameParts[1]?.replace(')', '').trim() || item.name_en || item.name || '';
          return {
            id: item.id,
            brandNameAr: arabicPart,
            brandNameEn: englishPart,
            activeIngredient: item.active_ingredient || '',
            dosageForm: item.dosage_form || '',
            strength: item.strength || '',
            packSize: '',
            manufacturer: item.manufacturer || '',
            maxRegulatedPriceEgp: null, // Do not map alternative_price to maxRegulatedPriceEgp; preserve unknown as null
            requiresPrescription: item.prescription_required !== false, // Conservative fail-closed
            category: 'general',
          };
        });
      }
    } catch (err) {
      console.warn('[ElajX Catalog] Query failed, using fallback:', err);
    }
  }

  return filterFixtureCatalog(query, category, prescriptionFilter);
}

function filterFixtureCatalog(
  query: string,
  category: string,
  prescriptionFilter: 'all' | 'otc' | 'rx'
): MedicineCatalogItem[] {
  let results = [...FIXTURE_CATALOG];

  if (query.trim()) {
    const q = query.trim().toLowerCase();
    results = results.filter(
      (m) =>
        m.brandNameAr.toLowerCase().includes(q) ||
        m.brandNameEn.toLowerCase().includes(q) ||
        m.activeIngredient.toLowerCase().includes(q) ||
        m.manufacturer.toLowerCase().includes(q)
    );
  }

  if (category !== 'all') {
    results = results.filter((m) => m.category === category);
  }

  if (prescriptionFilter === 'otc') {
    results = results.filter((m) => !m.requiresPrescription);
  } else if (prescriptionFilter === 'rx') {
    results = results.filter((m) => m.requiresPrescription);
  }

  return results;
}

export async function getMedicineById(id: string): Promise<MedicineCatalogItem | null> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from('medicine_catalog')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!error && data) {
        return {
          id: data.id,
          brandNameAr: data.brand_name_ar,
          brandNameEn: data.brand_name_en,
          activeIngredient: data.active_ingredient,
          dosageForm: data.dosage_form,
          strength: data.strength,
          packSize: data.pack_size,
          manufacturer: data.manufacturer,
          maxRegulatedPriceEgp: parseRegulatedPrice(data.max_regulated_price_egp),
          requiresPrescription: data.requires_prescription,
          category: data.category,
        };
      }

      const { data: medData, error: medError } = await supabase
        .from('medicines')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!medError && medData) {
        const nameParts = (medData.name || '').split('(');
        const arabicPart = nameParts[0]?.trim() || medData.name_ar || medData.name || '';
        const englishPart = nameParts[1]?.replace(')', '').trim() || medData.name_en || medData.name || '';
        return {
          id: medData.id,
          brandNameAr: arabicPart,
          brandNameEn: englishPart,
          activeIngredient: medData.active_ingredient || '',
          dosageForm: medData.dosage_form || '',
          strength: medData.strength || '',
          packSize: '',
          manufacturer: medData.manufacturer || '',
          maxRegulatedPriceEgp: null, // Do not map alternative_price to maxRegulatedPriceEgp; preserve unknown as null
          requiresPrescription: medData.prescription_required !== false, // Conservative fail-closed
          category: 'general',
        };
      }
    } catch {
      // fallback to fixture
    }
  }

  return FIXTURE_CATALOG.find((m) => m.id === id) || null;
}
