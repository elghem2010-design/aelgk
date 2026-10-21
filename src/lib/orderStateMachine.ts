/**
 * ElajX (علاجك) — Order State Machine & Integrity Rules
 * 
 * Enforces valid transition paths, role authorization, bioequivalence requirements,
 * price calculations, OTP verification, and duplicate-conversion guards.
 */

import { OrderStatus, RequestStatus, ProposedAlternative, UserRole, MedicineRequest, MedicineRequestItem } from '../types';
import { createHash, randomBytes } from 'crypto';

export const VALID_REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  submitted: ['under_pharmacy_review', 'cancelled'],
  under_pharmacy_review: ['alternative_proposed', 'availability_confirmed', 'rejected', 'cancelled'],
  alternative_proposed: ['availability_confirmed', 'cancelled'],
  availability_confirmed: ['converted_to_order', 'cancelled'],
  converted_to_order: [],
  rejected: [],
  cancelled: [],
};

export const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  confirmed: ['in_preparation', 'cancelled'],
  in_preparation: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['assigned_to_courier', 'cancelled'],
  assigned_to_courier: ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'failed_delivery'],
  delivered: [],
  failed_delivery: [],
  cancelled: [],
};

export function isValidRequestTransition(current: RequestStatus, next: RequestStatus): boolean {
  return VALID_REQUEST_TRANSITIONS[current]?.includes(next) ?? false;
}

export function isValidOrderTransition(current: OrderStatus, next: OrderStatus): boolean {
  return VALID_ORDER_TRANSITIONS[current]?.includes(next) ?? false;
}

export interface TransitionAuthContext {
  callerUserId: string;
  callerRole: UserRole;
  orderPharmacyId: string;
  orderCustomerId?: string;
  currentStatus?: OrderStatus;
  orderCourierId?: string;
  callerPharmacyIds?: string[];
  callerCourierId?: string;
}

export function isRoleAuthorizedForOrderTransition(
  nextStatus: OrderStatus,
  context: TransitionAuthContext
): { authorized: boolean; reason?: string } {
  if (nextStatus === 'cancelled' && context.currentStatus && ['in_transit', 'delivered', 'failed_delivery', 'cancelled'].includes(context.currentStatus)) {
    return { authorized: false, reason: `Orders in ${context.currentStatus} status cannot be cancelled` };
  }

  if (context.callerRole === 'admin') {
    return { authorized: true };
  }

  switch (nextStatus) {
    case 'in_preparation':
    case 'ready_for_pickup': {
      if (context.callerRole !== 'pharmacy_staff') {
        return { authorized: false, reason: 'Only pharmacy staff can update order preparation state' };
      }
      const isMember = context.callerPharmacyIds?.includes(context.orderPharmacyId);
      if (!isMember) {
        return { authorized: false, reason: 'Pharmacy staff not assigned to fulfilling pharmacy' };
      }
      return { authorized: true };
    }

    case 'assigned_to_courier': {
      const isMember = context.callerPharmacyIds?.includes(context.orderPharmacyId);
      if (!isMember) {
        return { authorized: false, reason: 'Only fulfilling pharmacy can assign courier' };
      }
      return { authorized: true };
    }

    case 'in_transit': {
      if (context.callerRole !== 'courier') {
        return { authorized: false, reason: 'Only an authorized courier can move order to in_transit' };
      }
      if (!context.orderCourierId || context.orderCourierId !== context.callerCourierId) {
        return { authorized: false, reason: 'Courier is not assigned to this delivery' };
      }
      return { authorized: true };
    }

    case 'failed_delivery': {
      if (context.callerRole !== 'courier') {
        return { authorized: false, reason: 'Only assigned courier can report delivery failure' };
      }
      if (!context.orderCourierId || context.orderCourierId !== context.callerCourierId) {
        return { authorized: false, reason: 'Courier is not assigned to this delivery' };
      }
      return { authorized: true };
    }

    case 'cancelled': {
      if (context.callerRole === 'pharmacy_staff') {
        const isMember = context.callerPharmacyIds?.includes(context.orderPharmacyId);
        if (!isMember) {
          return { authorized: false, reason: 'Pharmacy staff not assigned to fulfilling pharmacy' };
        }
        if (context.currentStatus && !['confirmed', 'in_preparation', 'ready_for_pickup', 'assigned_to_courier'].includes(context.currentStatus)) {
          return { authorized: false, reason: `Pharmacy staff cannot cancel order in status ${context.currentStatus}` };
        }
        return { authorized: true };
      }

      if (context.callerRole === 'customer') {
        if (context.orderCustomerId && context.callerUserId !== context.orderCustomerId) {
          return { authorized: false, reason: 'Customer can only cancel their own order' };
        }
        if (context.currentStatus !== 'confirmed') {
          return { authorized: false, reason: 'Customer can only cancel order in confirmed status prior to pharmacy preparation' };
        }
        return { authorized: true };
      }

      return { authorized: false, reason: 'Couriers and unauthorized actors cannot cancel orders' };
    }

    case 'delivered': {
      return { authorized: false, reason: 'Direct transition to delivered blocked; verifyDeliveryOtp is required' };
    }

    default:
      return { authorized: false, reason: 'Unauthorized transition' };
  }
}

export interface ValidateAlternativeResult {
  valid: boolean;
  errors: string[];
}

export function validateProposedAlternative(
  proposal: Partial<ProposedAlternative>,
  now: Date = new Date()
): ValidateAlternativeResult {
  const errors: string[] = [];

  if (!proposal.pharmacistRationaleAr || proposal.pharmacistRationaleAr.trim().length < 10) {
    errors.push('يجب تقديم مبرر صيدلاني مفصل لا يقل عن 10 أحرف للمريض.');
  }

  if (proposal.proposedPriceEgp === undefined || proposal.proposedPriceEgp <= 0) {
    errors.push('يجب تحديد السعر الرسمي للبديل المقترح.');
  }

  if (proposal.activeIngredientMatch !== true) {
    errors.push('البديل الصيدلي المقترح يجب أن يطابق المادة الفعالة والشكل الصيدلي.');
  }

  if (proposal.expiresAt && new Date(proposal.expiresAt).getTime() <= now.getTime()) {
    errors.push('عرض البديل الدوائي منتهي الصلاحية.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Calculates order totals.
 * Note: Delivery fee must be explicitly provided from verified pharmacy confirmation;
 * no default fee is assumed as an approved rule.
 */
export function calculateOrderTotals(
  items: Array<{ unitPriceEgp: number; quantity: number }>,
  deliveryFeeEgp: number
): { subtotalEgp: number; deliveryFeeEgp: number; totalEgp: number } {
  const subtotalEgp = items.reduce((acc, item) => {
    const unit = Math.max(0, item.unitPriceEgp);
    const qty = Math.max(1, Math.floor(item.quantity));
    return acc + unit * qty;
  }, 0);

  const roundedSubtotal = Math.round(subtotalEgp * 100) / 100;
  const roundedFee = Math.round(Math.max(0, deliveryFeeEgp) * 100) / 100;
  const totalEgp = Math.round((roundedSubtotal + roundedFee) * 100) / 100;

  return {
    subtotalEgp: roundedSubtotal,
    deliveryFeeEgp: roundedFee,
    totalEgp,
  };
}

export interface OtpValidationParams {
  storedHash: string;
  storedSalt: string;
  inputOtp: string;
  attemptsCount: number;
  maxAttempts: number;
  expiresAt: string;
  isConsumed?: boolean;
  currentTime?: Date;
}

export interface OtpValidationResult {
  valid: boolean;
  error?: string;
  lockedOut?: boolean;
}

export function validateDeliveryOtpHandshake(params: OtpValidationParams): OtpValidationResult {
  const now = params.currentTime || new Date();

  if (params.isConsumed) {
    return { valid: false, error: 'Delivery OTP has already been consumed (Replay blocked).' };
  }

  if (params.attemptsCount >= params.maxAttempts) {
    return { valid: false, error: 'Maximum verification attempts exceeded. Locked out.', lockedOut: true };
  }

  if (new Date(params.expiresAt).getTime() < now.getTime()) {
    return { valid: false, error: 'Delivery OTP has expired.' };
  }

  if (!params.inputOtp || params.inputOtp.trim().length !== 6) {
    return { valid: false, error: 'OTP must be exactly 6 digits.' };
  }

  const computedHash = createHash('sha256')
    .update(params.inputOtp.trim() + params.storedSalt)
    .digest('hex');

  if (computedHash !== params.storedHash) {
    return { valid: false, error: 'Invalid delivery OTP.' };
  }

  return { valid: true };
}

/**
 * Generates uniform 6-digit OTP code spanning all 900,000 combinations [100000, 999999]
 * using 32-bit cryptographically secure random integers and rejection sampling
 * (threshold 4,294,800,000) to eliminate modulo bias.
 */
export function generateSecureOtp(): { otpCode: string; salt: string; hash: string } {
  let otpNumber: number;
  while (true) {
    const buf = randomBytes(4);
    const uint32 = buf.readUInt32BE(0);
    // 4,294,800,000 is largest multiple of 900,000 <= 2^32
    if (uint32 < 4294800000) {
      otpNumber = 100000 + (uint32 % 900000);
      break;
    }
  }
  const otpCode = otpNumber.toString();
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(otpCode + salt).digest('hex');

  return { otpCode, salt, hash };
}

export interface MultiItemConversionResult {
  valid: boolean;
  orderItems: Array<{
    catalogId?: string;
    rawMedicineName: string;
    isAlternative: boolean;
    quantity: number;
    unitPriceEgp: number;
    totalPriceEgp: number;
  }>;
  subtotalEgp: number;
  error?: string;
}

/**
 * Correctly matches accepted alternatives item-by-item against specific request items.
 * Prioritizes requestItemId foreign key binding to guarantee that an alternative for Item A
 * never mutates Item B, even if items share catalog IDs or are uncatalogued raw names.
 */
export function convertRequestItemsToOrderItems(
  items: MedicineRequestItem[],
  acceptedAlternatives: ProposedAlternative[]
): MultiItemConversionResult {
  const orderItems = [];
  let subtotalEgp = 0;

  for (const item of items) {
    // Match alternative strictly by requestItemId (or fallback to originalCatalogId if legacy/unbound)
    const matchedAlt = acceptedAlternatives.find((alt) => {
      if (alt.approvalStatus !== 'accepted') return false;
      if (alt.requestItemId) {
        return alt.requestItemId === item.id;
      }
      return Boolean(item.medicineCatalogId && alt.originalCatalogId === item.medicineCatalogId);
    });

    if (matchedAlt) {
      // Validate that catalog ID matches if item is catalogued (null/undefined originalCatalogId cannot bypass)
      if (item.medicineCatalogId) {
        if (!matchedAlt.originalCatalogId || item.medicineCatalogId !== matchedAlt.originalCatalogId) {
          return {
            valid: false,
            orderItems: [],
            subtotalEgp: 0,
            error: `Alternative original catalog ID does not match request item ${item.rawMedicineName}`,
          };
        }
      }

      // Proposed alternative must not be identical to original medicine
      if (matchedAlt.originalCatalogId && matchedAlt.proposedCatalogId === matchedAlt.originalCatalogId) {
        return {
          valid: false,
          orderItems: [],
          subtotalEgp: 0,
          error: `Proposed alternative medicine cannot be identical to original medicine for item ${item.rawMedicineName}`,
        };
      }

      const unitPrice = matchedAlt.proposedPriceEgp;
      const total = unitPrice * item.requestedQuantity;
      subtotalEgp += total;
      orderItems.push({
        catalogId: matchedAlt.proposedCatalogId,
        rawMedicineName: matchedAlt.proposedName,
        isAlternative: true,
        quantity: item.requestedQuantity,
        unitPriceEgp: unitPrice,
        totalPriceEgp: total,
      });
    } else {
      // Must have pharmacy-confirmed unit price for original medicine (never fabricated)
      if (item.confirmedUnitPriceEgp === undefined || item.confirmedUnitPriceEgp === null) {
        return {
          valid: false,
          orderItems: [],
          subtotalEgp: 0,
          error: `Pharmacy confirmed price missing for item ${item.rawMedicineName}`,
        };
      }
      const unitPrice = item.confirmedUnitPriceEgp;
      const total = unitPrice * item.requestedQuantity;
      subtotalEgp += total;
      orderItems.push({
        catalogId: item.medicineCatalogId,
        rawMedicineName: item.rawMedicineName,
        isAlternative: false,
        quantity: item.requestedQuantity,
        unitPriceEgp: unitPrice,
        totalPriceEgp: total,
      });
    }
  }

  return { valid: true, orderItems, subtotalEgp };
}

export interface OrderConversionParams {
  request: MedicineRequest;
  existingOrderExists: boolean;
  currentTime?: Date;
}

export function validateOrderConversionGuard(params: OrderConversionParams): { valid: boolean; error?: string } {
  if (params.existingOrderExists) {
    return { valid: false, error: 'Duplicate order error: An order already exists for this request.' };
  }

  if (params.request.status !== 'availability_confirmed') {
    return { valid: false, error: 'Request must be availability_confirmed before converting to order.' };
  }

  if (params.request.confirmedDeliveryFeeEgp === undefined || params.request.confirmedDeliveryFeeEgp === null) {
    return { valid: false, error: 'Confirmed delivery fee from pharmacy is required before converting to order.' };
  }

  if (params.request.proposedAlternative) {
    if (params.request.proposedAlternative.approvalStatus !== 'accepted') {
      return { valid: false, error: 'Proposed alternative must be accepted by customer before converting to order.' };
    }

    const now = params.currentTime || new Date();
    if (
      params.request.proposedAlternative.expiresAt &&
      new Date(params.request.proposedAlternative.expiresAt).getTime() <= now.getTime()
    ) {
      return { valid: false, error: 'Accepted alternative offer has expired.' };
    }
  }

  return { valid: true };
}
