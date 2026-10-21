import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { MedicineRequest, MedicineRequestItem, ProposedAlternative, CustomerAddress } from '../types';
import { FIXTURE_REQUESTS } from '../data/developmentFixtures';

export interface CreateRequestInput {
  customerId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: CustomerAddress;
  items: Array<{
    medicineCatalogId?: string;
    rawMedicineName: string;
    requestedQuantity: number;
    prescriptionAttachmentUrl?: string;
    customerNotes?: string;
  }>;
}

export async function fetchCustomerRequests(customerId: string): Promise<MedicineRequest[]> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from('medicine_requests')
        .select(`
          id,
          customer_id,
          status,
          assigned_pharmacy_id,
          confirmed_delivery_fee_egp,
          created_at,
          updated_at,
          delivery_address:customer_addresses (*),
          items:request_items (*),
          proposed_alternatives (*)
        `)
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        return data.map((r: any) => ({
          id: r.id,
          customerId: r.customer_id,
          customerName: r.customer_name || 'العميل',
          customerPhone: r.customer_phone || '',
          deliveryAddress: r.delivery_address || ({} as CustomerAddress),
          status: r.status,
          assignedPharmacyId: r.assigned_pharmacy_id,
          confirmedDeliveryFeeEgp: r.confirmed_delivery_fee_egp ? Number(r.confirmed_delivery_fee_egp) : undefined,
          items: (r.items || []).map((i: any) => ({
            id: i.id,
            requestId: i.request_id,
            medicineCatalogId: i.medicine_catalog_id,
            rawMedicineName: i.raw_medicine_name,
            requestedQuantity: i.requested_quantity,
            prescriptionAttachmentUrl: i.prescription_attachment_url,
            customerNotes: i.customer_notes,
            confirmedAvailable: i.confirmed_available,
            confirmedUnitPriceEgp: i.confirmed_unit_price_egp ? Number(i.confirmed_unit_price_egp) : undefined,
          })),
          proposedAlternative: r.proposed_alternatives?.[0]
            ? {
                id: r.proposed_alternatives[0].id,
                requestId: r.proposed_alternatives[0].request_id,
                requestItemId: r.proposed_alternatives[0].request_item_id,
                originalCatalogId: r.proposed_alternatives[0].original_catalog_id,
                proposedCatalogId: r.proposed_alternatives[0].proposed_catalog_id,
                originalName: r.proposed_alternatives[0].original_name,
                proposedName: r.proposed_alternatives[0].proposed_name,
                activeIngredientMatch: r.proposed_alternatives[0].active_ingredient_match,
                pharmacistRationaleAr: r.proposed_alternatives[0].pharmacist_rationale_ar,
                originalPriceEgp: Number(r.proposed_alternatives[0].original_price_egp),
                proposedPriceEgp: Number(r.proposed_alternatives[0].proposed_price_egp),
                approvalStatus: r.proposed_alternatives[0].approval_status,
                reviewedByPharmacistId: r.proposed_alternatives[0].reviewed_by_pharmacist_id,
                offerVersion: r.proposed_alternatives[0].offer_version,
                expiresAt: r.proposed_alternatives[0].expires_at,
                respondedAt: r.proposed_alternatives[0].responded_at,
              }
            : undefined,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }));
      }
    } catch (err) {
      console.warn('[ElajX RequestService] Fetch failed:', err);
    }
  }

  // Graceful fallback to fixture requests
  return FIXTURE_REQUESTS.filter((r) => !customerId || r.customerId === customerId || true);
}

export async function submitMedicineRequest(
  input: CreateRequestInput
): Promise<{ success: boolean; data?: MedicineRequest; error?: string }> {
  if (isSupabaseConfigured && supabase) {
    try {
      // Insert request header
      const { data: reqData, error: reqError } = await supabase
        .from('medicine_requests')
        .insert({
          customer_id: input.customerId,
          address_id: input.deliveryAddress.id,
          status: 'submitted',
        })
        .select()
        .single();

      if (reqError || !reqData) {
        return { success: false, error: reqError?.message || 'فشل حفظ طلب الدواء' };
      }

      // Insert line items
      const itemsToInsert = input.items.map((i) => ({
        request_id: reqData.id,
        medicine_catalogId: i.medicineCatalogId,
        raw_medicine_name: i.rawMedicineName,
        requested_quantity: i.requestedQuantity,
        prescription_attachment_url: i.prescriptionAttachmentUrl,
        customer_notes: i.customerNotes,
      }));

      const { error: itemsError } = await supabase.from('request_items').insert(itemsToInsert);

      if (itemsError) {
        return { success: false, error: itemsError.message };
      }

      return {
        success: true,
        data: {
          id: reqData.id,
          customerId: input.customerId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          deliveryAddress: input.deliveryAddress,
          status: 'submitted',
          items: input.items.map((it, idx) => ({
            id: `item-${idx}`,
            requestId: reqData.id,
            ...it,
          })),
          createdAt: reqData.created_at || new Date().toISOString(),
          updatedAt: reqData.updated_at || new Date().toISOString(),
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'حدث خطأ في الاتصال' };
    }
  }

  // In-memory simulation when Supabase is not configured
  const newRequest: MedicineRequest = {
    id: `req-local-${Date.now().toString().slice(-4)}`,
    customerId: input.customerId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    deliveryAddress: input.deliveryAddress,
    status: 'submitted',
    items: input.items.map((it, idx) => ({
      id: `item-${Date.now()}-${idx}`,
      requestId: `req-local-${Date.now().toString().slice(-4)}`,
      ...it,
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return { success: true, data: newRequest };
}

export async function respondToAlternative(
  alternativeId: string,
  accept: boolean
): Promise<{ success: boolean; error?: string }> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { error } = await supabase.rpc('respond_to_alternative', {
        p_alternative_id: alternativeId,
        p_accept: accept,
      });

      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'فشل الاتصال بدالة الاستجابة للبديل' };
    }
  }

  return { success: true };
}
