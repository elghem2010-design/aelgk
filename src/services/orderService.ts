import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Order, OrderStatus, OrderItem, CustomerAddress } from '../types';
import { FIXTURE_ORDERS } from '../data/developmentFixtures';
import { isValidOrderTransition } from '../lib/orderStateMachine';

export async function fetchOrders(filter?: {
  customerId?: string;
  pharmacyId?: string;
  courierId?: string;
}): Promise<Order[]> {
  if (isSupabaseConfigured && supabase) {
    try {
      let query = supabase.from('orders').select(`
        id,
        order_number,
        request_id,
        customer_id,
        pharmacy_id,
        courier_id,
        status,
        subtotal_egp,
        delivery_fee_egp,
        total_egp,
        tamper_seal_verified,
        created_at,
        updated_at,
        delivery_address:customer_addresses (*),
        items:order_items (*)
      `);

      if (filter?.customerId) {
        query = query.eq('customer_id', filter.customerId);
      }
      if (filter?.pharmacyId) {
        query = query.eq('pharmacy_id', filter.pharmacyId);
      }
      if (filter?.courierId) {
        query = query.eq('courier_id', filter.courierId);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        return data.map((o: any) => ({
          id: o.id,
          orderNumber: o.order_number,
          requestId: o.request_id,
          customerId: o.customer_id,
          customerName: 'العميل',
          customerPhone: '',
          pharmacyId: o.pharmacy_id,
          pharmacyName: 'صيدلية معتمدة',
          pharmacyPhone: '',
          courierId: o.courier_id,
          deliveryAddress: o.delivery_address || ({} as CustomerAddress),
          status: o.status,
          items: (o.items || []).map((i: any) => ({
            id: i.id,
            orderId: o.id,
            catalogId: i.medicine_catalog_id,
            name: i.medicine_name,
            isAlternative: i.is_alternative,
            quantity: i.quantity,
            unitPriceEgp: Number(i.unit_price_egp),
            totalPriceEgp: Number(i.total_price_egp),
          })),
          subtotalEgp: Number(o.subtotal_egp),
          deliveryFeeEgp: Number(o.delivery_fee_egp),
          totalEgp: Number(o.total_egp),
          tamperSealVerified: o.tamper_seal_verified,
          createdAt: o.created_at,
          updatedAt: o.updated_at,
        }));
      }
    } catch (err) {
      console.warn('[ElajX OrderService] Fetch orders error:', err);
    }
  }

  // Fallback to fixture orders
  let filtered = [...FIXTURE_ORDERS];
  if (filter?.customerId) {
    filtered = filtered.filter((o) => o.customerId === filter.customerId);
  }
  if (filter?.pharmacyId) {
    filtered = filtered.filter((o) => o.pharmacyId === filter.pharmacyId);
  }
  if (filter?.courierId) {
    filtered = filtered.filter((o) => o.courierId === filter.courierId);
  }

  return filtered.length > 0 ? filtered : FIXTURE_ORDERS;
}

export async function createOrderFromRequest(
  requestId: string
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.rpc('create_order_from_accepted_request', {
        p_request_id: requestId,
      });

      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true, orderId: data };
    } catch (err: any) {
      return { success: false, error: err.message || 'فشل إنشاء الطلب' };
    }
  }

  return { success: true, orderId: `ord-${Date.now()}` };
}

export async function transitionOrderStatus(
  orderId: string,
  currentStatus: OrderStatus,
  nextStatus: OrderStatus,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  // Pre-validate with state machine
  if (!isValidOrderTransition(currentStatus, nextStatus)) {
    return {
      success: false,
      error: `التحول من حالة ${currentStatus} إلى ${nextStatus} غير مسموح به في مسار الدواء.`,
    };
  }

  if (isSupabaseConfigured && supabase) {
    try {
      const { error } = await supabase.rpc('transition_order_status', {
        p_order_id: orderId,
        p_next_status: nextStatus,
        p_notes: notes || '',
      });

      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'فشل تحديث حالة الطلب' };
    }
  }

  return { success: true };
}

export async function verifyDeliveryOtp(
  orderId: string,
  plaintextOtp: string
): Promise<{ success: boolean; error?: string }> {
  if (!plaintextOtp || !/^\d{6}$/.test(plaintextOtp.trim())) {
    return { success: false, error: 'رمز التحقق يجب أن يتكون من 6 أرقام دقيقة' };
  }

  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.rpc('verify_delivery_otp', {
        p_order_id: orderId,
        p_plaintext_otp: plaintextOtp.trim(),
      });

      if (error) {
        return { success: false, error: error.message };
      }
      if (!data) {
        return { success: false, error: 'رمز التحقق غير متطابق' };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'فشل إتمام التحقق من الرمز' };
    }
  }

  // In demo simulation mode, accept sample OTP
  return { success: true };
}
