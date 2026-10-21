/**
 * ElajX (علاجك) — Domain Type Definitions
 * Strict TypeScript contracts matching PostgreSQL / Supabase schema entities.
 */

export type UserRole = 'customer' | 'pharmacy_staff' | 'courier' | 'admin';

export interface UserProfile {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  nationalIdMasked?: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerAddress {
  id: string;
  customerId: string;
  label: string;
  governorate: string;
  district: string;
  street: string;
  building: string;
  floor?: string;
  apartment?: string;
  landmark?: string;
  isDefault: boolean;
  createdAt?: string;
}

export type PharmacyVerificationStatus = 'pending' | 'verified' | 'suspended';

export interface Pharmacy {
  id: string;
  commercialName: string;
  licenseNumber: string;
  commercialRegister: string;
  governorate: string;
  district: string;
  streetAddress: string;
  phone: string;
  verificationStatus: PharmacyVerificationStatus;
  isActive: boolean;
  latitude?: number;
  longitude?: number;
  createdAt?: string;
}

export interface PharmacyStaff {
  id: string;
  pharmacyId: string;
  userId: string;
  isPrimaryManager: boolean;
  createdAt: string;
}

export type CourierVerificationStatus = 'pending' | 'verified' | 'suspended';
export type CourierShiftStatus = 'offline' | 'available' | 'on_delivery';

export interface CourierProfile {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  vehicleType: 'motorcycle' | 'bicycle' | 'car';
  verificationStatus: CourierVerificationStatus;
  shiftStatus: CourierShiftStatus;
  currentZone: string;
  createdAt?: string;
}

export interface MedicineCatalogItem {
  id: string;
  brandNameAr: string;
  brandNameEn: string;
  activeIngredient: string;
  dosageForm: string;
  strength: string;
  packSize: string;
  manufacturer: string;
  maxRegulatedPriceEgp: number | null;
  requiresPrescription: boolean;
  category: string;
}

export type RequestStatus =
  | 'submitted'
  | 'under_pharmacy_review'
  | 'alternative_proposed'
  | 'availability_confirmed'
  | 'converted_to_order'
  | 'rejected'
  | 'cancelled';

export interface MedicineRequestItem {
  id: string;
  requestId: string;
  medicineCatalogId?: string;
  rawMedicineName: string;
  requestedQuantity: number;
  prescriptionAttachmentUrl?: string;
  customerNotes?: string;
  confirmedAvailable?: boolean;
  confirmedUnitPriceEgp?: number;
}

export type AlternativeApprovalStatus = 'pending_customer' | 'accepted' | 'declined' | 'expired';

export interface ProposedAlternative {
  id: string;
  requestId: string;
  requestItemId?: string;
  originalCatalogId: string;
  proposedCatalogId: string;
  originalName: string;
  proposedName: string;
  activeIngredientMatch: boolean;
  pharmacistRationaleAr: string;
  originalPriceEgp: number;
  proposedPriceEgp: number;
  approvalStatus: AlternativeApprovalStatus;
  reviewedByPharmacistId: string;
  offerVersion: number;
  expiresAt: string;
  respondedAt?: string;
  createdAt?: string;
}

export interface MedicineRequest {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: CustomerAddress;
  status: RequestStatus;
  assignedPharmacyId?: string;
  assignedPharmacyName?: string;
  confirmedDeliveryFeeEgp?: number;
  items: MedicineRequestItem[];
  proposedAlternative?: ProposedAlternative;
  pharmacistNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type OrderStatus =
  | 'confirmed'
  | 'in_preparation'
  | 'ready_for_pickup'
  | 'assigned_to_courier'
  | 'in_transit'
  | 'delivered'
  | 'failed_delivery'
  | 'cancelled';

export interface OrderItem {
  id: string;
  orderId: string;
  catalogId?: string;
  item_name?: string;
  name: string;
  isAlternative: boolean;
  quantity: number;
  unitPriceEgp: number;
  totalPriceEgp: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  requestId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  pharmacyId: string;
  pharmacyName: string;
  pharmacyPhone: string;
  courierId?: string;
  courierName?: string;
  courierPhone?: string;
  deliveryAddress: CustomerAddress;
  status: OrderStatus;
  items: OrderItem[];
  subtotalEgp: number;
  deliveryFeeEgp: number;
  totalEgp: number;
  tamperSealVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DeliveryEventType =
  | 'assigned'
  | 'courier_arrived_pharmacy'
  | 'picked_up'
  | 'in_transit'
  | 'arrived_destination'
  | 'delivered'
  | 'delivery_failed';

export interface DeliveryEvent {
  id: string;
  orderId: string;
  courierId: string;
  eventType: DeliveryEventType;
  notes?: string;
  timestamp: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorRole: UserRole;
  action: string;
  entityType: 'request' | 'order' | 'alternative' | 'pharmacy' | 'courier' | 'catalog';
  entityId: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}
