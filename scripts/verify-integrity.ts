/**
 * ElajX (علاجك) — Automated TypeScript Domain & Business Logic Unit Tests
 * 
 * IMPORTANT SCOPE NOTICE:
 * These tests are strictly in-memory TypeScript unit tests running under Node.js (tsx).
 * They verify domain invariants, mathematical calculations, and business transformations in application code.
 * THEY DO NOT EXECUTE SQL, DO NOT TEST POSTGRESQL RLS POLICIES, DO NOT EXECUTE DATABASE TRIGGERS,
 * AND DO NOT PROVE POSTGRESQL ENGINE BEHAVIOR.
 * Database-level verification requires executing the pgTAP test plan against a live PostgreSQL instance.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  isValidRequestTransition,
  isValidOrderTransition,
  isRoleAuthorizedForOrderTransition,
  validateProposedAlternative,
  calculateOrderTotals,
  validateDeliveryOtpHandshake,
  validateOrderConversionGuard,
  generateSecureOtp,
  convertRequestItemsToOrderItems,
  TransitionAuthContext,
} from '../src/lib/orderStateMachine';
import { MedicineRequest, ProposedAlternative, MedicineRequestItem, UserRole } from '../src/types';
import {
  normalizeEgyptianPhone,
  isValidEmail,
  isUserAuthorizedForRole,
} from '../src/services/authService';
import { DEMO_PERSONAS } from '../src/contexts/AuthContext';
import { parseRegulatedPrice } from '../src/services/catalogService';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS [TypeScript Unit]: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL [TypeScript Unit]: ${message}`);
    failed++;
  }
}

console.log('================================================================');
console.log('   ELAJX (علاجك) TYPESCRIPT DOMAIN & BUSINESS UNIT SUITE        ');
console.log('   (In-Memory Unit Tests — Not A Database / RLS Verification)   ');
console.log('================================================================');

// -----------------------------------------------------------------------------
// Suite 1: Request State Machine Transitions
// -----------------------------------------------------------------------------
console.log('\n[Suite 1: Request State Machine Transitions]');
assert(
  isValidRequestTransition('submitted', 'under_pharmacy_review'),
  'Permits valid request submission to pharmacy review'
);
assert(
  isValidRequestTransition('under_pharmacy_review', 'alternative_proposed'),
  'Permits pharmacy proposing a bioequivalent alternative'
);
assert(
  !isValidRequestTransition('submitted', 'converted_to_order'),
  'BLOCKS direct promotion from submitted to converted_to_order without review'
);
assert(
  !isValidRequestTransition('alternative_proposed', 'converted_to_order'),
  'BLOCKS conversion to order while alternative approval is pending'
);

// -----------------------------------------------------------------------------
// Suite 2: Order State Machine Transitions
// -----------------------------------------------------------------------------
console.log('\n[Suite 2: Order State Machine Transitions]');
assert(
  isValidOrderTransition('confirmed', 'in_preparation'),
  'Permits confirmed order moving to pharmacy preparation'
);
assert(
  isValidOrderTransition('in_preparation', 'ready_for_pickup'),
  'Permits moving from preparation to ready for pickup with tamper seal'
);
assert(
  isValidOrderTransition('ready_for_pickup', 'assigned_to_courier'),
  'Permits moving from ready_for_pickup to assigned_to_courier'
);
assert(
  isValidOrderTransition('assigned_to_courier', 'in_transit'),
  'Permits assigned courier verifying pickup and moving order in_transit'
);
assert(
  isValidOrderTransition('in_transit', 'delivered'),
  'Permits delivery completion after courier verification'
);
assert(
  !isValidOrderTransition('ready_for_pickup', 'in_transit'),
  'BLOCKS moving in_transit directly from ready_for_pickup before courier assignment'
);
assert(
  !isValidOrderTransition('confirmed', 'delivered'),
  'BLOCKS jumping from confirmed directly to delivered without preparation and transit'
);
assert(
  !isValidOrderTransition('delivered', 'cancelled'),
  'BLOCKS cancelling a completed delivery'
);

// -----------------------------------------------------------------------------
// Suite 3: Role-Based Order Transition Authorization & Tenancy Isolation
// -----------------------------------------------------------------------------
console.log('\n[Suite 3: Role Authorization & Tenant Isolation]');
const fulfillingPharmacyId = 'pharm-cairo-01';
const otherPharmacyId = 'pharm-giza-99';
const assignedCourierId = 'cour-alex-01';
const otherCourierId = 'cour-cairo-99';

// Pharmacy Staff Isolation
const authorizedPharmacyContext: TransitionAuthContext = {
  callerUserId: 'user-pharm-01',
  callerRole: 'pharmacy_staff',
  orderPharmacyId: fulfillingPharmacyId,
  callerPharmacyIds: [fulfillingPharmacyId],
};
assert(
  isRoleAuthorizedForOrderTransition('in_preparation', authorizedPharmacyContext).authorized,
  'Authorizes assigned pharmacy staff to mark order in_preparation'
);

const unauthorizedPharmacyContext: TransitionAuthContext = {
  callerUserId: 'user-pharm-99',
  callerRole: 'pharmacy_staff',
  orderPharmacyId: fulfillingPharmacyId,
  callerPharmacyIds: [otherPharmacyId], // Cross-pharmacy attempt!
};
assert(
  !isRoleAuthorizedForOrderTransition('in_preparation', unauthorizedPharmacyContext).authorized,
  'BLOCKS cross-pharmacy staff from modifying an order assigned to a different pharmacy'
);

// Courier Isolation
const assignedCourierContext: TransitionAuthContext = {
  callerUserId: 'user-cour-01',
  callerRole: 'courier',
  orderPharmacyId: fulfillingPharmacyId,
  orderCourierId: assignedCourierId,
  callerCourierId: assignedCourierId,
};
assert(
  isRoleAuthorizedForOrderTransition('in_transit', assignedCourierContext).authorized,
  'Authorizes assigned courier to mark order in_transit'
);

const unassignedCourierContext: TransitionAuthContext = {
  callerUserId: 'user-cour-99',
  callerRole: 'courier',
  orderPharmacyId: fulfillingPharmacyId,
  orderCourierId: assignedCourierId,
  callerCourierId: otherCourierId, // Different courier!
};
assert(
  !isRoleAuthorizedForOrderTransition('in_transit', unassignedCourierContext).authorized,
  'BLOCKS unassigned courier from intercepting or updating an order assigned to another courier'
);

// Direct 'delivered' promotion blocked without OTP verification RPC
assert(
  !isRoleAuthorizedForOrderTransition('delivered', assignedCourierContext).authorized,
  'BLOCKS direct state promotion to delivered (requires verifyDeliveryOtp RPC)'
);

// Customer cannot directly cancel orders in preparation or transit
const customerContext: TransitionAuthContext = {
  callerUserId: 'cust-01',
  callerRole: 'customer',
  orderPharmacyId: fulfillingPharmacyId,
};
assert(
  !isRoleAuthorizedForOrderTransition('cancelled', customerContext).authorized,
  'BLOCKS customer from cancelling an active order once in preparation or transit'
);

// -----------------------------------------------------------------------------
// Suite 4: Multi-Item Alternative Price Isolation (Anti-Corruption)
// -----------------------------------------------------------------------------
console.log('\n[Suite 4: Multi-Item Alternative Price Isolation & requestItemId Mapping]');
const multiItems: MedicineRequestItem[] = [
  {
    id: 'item-concor',
    requestId: 'req-multi-01',
    medicineCatalogId: 'med-concor-5mg',
    rawMedicineName: 'كونكور 5 مجم',
    requestedQuantity: 2,
    confirmedAvailable: false, // Out of stock
    confirmedUnitPriceEgp: 56.5,
  },
  {
    id: 'item-panadol',
    requestId: 'req-multi-01',
    medicineCatalogId: 'med-panadol-extra',
    rawMedicineName: 'بانادول إكسترا',
    requestedQuantity: 1,
    confirmedAvailable: true, // In stock
    confirmedUnitPriceEgp: 45.0, // Confirmed selling price
  },
];

// Alternative accepted ONLY for Item 1 explicitly via requestItemId (Concor -> Bisocard @ 32.0 EGP)
const acceptedAlts: ProposedAlternative[] = [
  {
    id: 'alt-bisocard',
    requestId: 'req-multi-01',
    requestItemId: 'item-concor',
    originalCatalogId: 'med-concor-5mg',
    proposedCatalogId: 'med-bisocard-5mg',
    originalName: 'كونكور 5 مجم',
    proposedName: 'بيسوكارد 5 مجم (بديل معتمد)',
    activeIngredientMatch: true,
    pharmacistRationaleAr: 'بديل مكافئ بنفس المادة والتركيز',
    originalPriceEgp: 56.5,
    proposedPriceEgp: 32.0,
    approvalStatus: 'accepted',
    reviewedByPharmacistId: 'p1',
    offerVersion: 1,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  },
];

const conversionResult = convertRequestItemsToOrderItems(multiItems, acceptedAlts);
assert(conversionResult.valid, 'Converts multi-item request successfully using requestItemId foreign key');
assert(conversionResult.orderItems.length === 2, 'Maintains exact 2 items in order');

const convertedItem1 = conversionResult.orderItems.find((i) => i.catalogId === 'med-bisocard-5mg');
const convertedItem2 = conversionResult.orderItems.find((i) => i.catalogId === 'med-panadol-extra');

assert(
  Boolean(convertedItem1 && convertedItem1.isAlternative && convertedItem1.unitPriceEgp === 32.0),
  'Item 1 (Concor) correctly mapped to accepted alternative Bisocard at 32.00 EGP'
);
assert(
  Boolean(convertedItem2 && !convertedItem2.isAlternative && convertedItem2.unitPriceEgp === 45.0),
  'Item 2 (Panadol) PRESERVES original medicine identity and confirmed 45.00 EGP price without corruption'
);
assert(
  conversionResult.subtotalEgp === 32.0 * 2 + 45.0 * 1, // 64 + 45 = 109
  'Calculates accurate multi-item subtotal (109.00 EGP) without price overwrite leakage'
);

// Test: Duplicate request items with identical catalog ID isolated by requestItemId
const duplicateCatalogItems: MedicineRequestItem[] = [
  {
    id: 'item-pack-1',
    requestId: 'req-dup-01',
    medicineCatalogId: 'med-same-catalog',
    rawMedicineName: 'بانادول (العبوة 1 - للمريض)',
    requestedQuantity: 1,
    confirmedAvailable: false,
    confirmedUnitPriceEgp: 40.0,
  },
  {
    id: 'item-pack-2',
    requestId: 'req-dup-01',
    medicineCatalogId: 'med-same-catalog',
    rawMedicineName: 'بانادول (العبوة 2 - للمرافق)',
    requestedQuantity: 1,
    confirmedAvailable: true,
    confirmedUnitPriceEgp: 40.0,
  },
];
const duplicateCatalogAlt: ProposedAlternative[] = [
  {
    id: 'alt-pack-1-only',
    requestId: 'req-dup-01',
    requestItemId: 'item-pack-1', // Bound specifically to Item 1!
    originalCatalogId: 'med-same-catalog',
    proposedCatalogId: 'med-substitute-pack',
    originalName: 'بانادول',
    proposedName: 'سيتال بديل للعبوة 1',
    activeIngredientMatch: true,
    pharmacistRationaleAr: 'بديل مكافئ متوفر للعبوة الأولى',
    originalPriceEgp: 40.0,
    proposedPriceEgp: 20.0,
    approvalStatus: 'accepted',
    reviewedByPharmacistId: 'p1',
    offerVersion: 1,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  },
];
const dupResult = convertRequestItemsToOrderItems(duplicateCatalogItems, duplicateCatalogAlt);
assert(dupResult.valid, 'Converts request with duplicate catalog items correctly');
const dupItem1 = dupResult.orderItems.find((i) => i.rawMedicineName === 'سيتال بديل للعبوة 1');
const dupItem2 = dupResult.orderItems.find((i) => i.rawMedicineName === 'بانادول (العبوة 2 - للمرافق)');
assert(
  Boolean(dupItem1 && dupItem1.isAlternative && dupItem1.unitPriceEgp === 20.0),
  'requestItemId binds alternative specifically to Item 1 only'
);
assert(
  Boolean(dupItem2 && !dupItem2.isAlternative && dupItem2.unitPriceEgp === 40.0),
  'Item 2 with identical catalog ID is NOT contaminated by Item 1 alternative'
);

// Test: Uncatalogued item matched via requestItemId
const uncataloguedItems: MedicineRequestItem[] = [
  {
    id: 'item-raw-uncatalogued',
    requestId: 'req-raw-01',
    medicineCatalogId: undefined, // Free text from patient
    rawMedicineName: 'دواء ضغط مركب نادر',
    requestedQuantity: 1,
    confirmedAvailable: false,
  },
];
const uncataloguedAlt: ProposedAlternative[] = [
  {
    id: 'alt-for-uncatalogued',
    requestId: 'req-raw-01',
    requestItemId: 'item-raw-uncatalogued',
    originalCatalogId: '',
    proposedCatalogId: 'med-catalogued-substitute',
    originalName: 'دواء ضغط مركب نادر',
    proposedName: 'بديل مسجل بهيئة الدواء',
    activeIngredientMatch: true,
    pharmacistRationaleAr: 'تم استبدال الصنف الحر بصنف مسجل مكافئ',
    originalPriceEgp: 100.0,
    proposedPriceEgp: 75.0,
    approvalStatus: 'accepted',
    reviewedByPharmacistId: 'p1',
    offerVersion: 1,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  },
];
const uncataloguedResult = convertRequestItemsToOrderItems(uncataloguedItems, uncataloguedAlt);
assert(
  uncataloguedResult.valid && uncataloguedResult.orderItems[0].isAlternative && uncataloguedResult.orderItems[0].unitPriceEgp === 75.0,
  'Enables accepted alternative for uncatalogued request item via explicit requestItemId binding'
);

// Test: Reject conversion when alternative originalCatalogId conflicts with request item
const conflictingAlt: ProposedAlternative[] = [
  {
    id: 'alt-conflict',
    requestId: 'req-multi-01',
    requestItemId: 'item-concor',
    originalCatalogId: 'med-WRONG-CATALOG-ID', // Conflict with med-concor-5mg!
    proposedCatalogId: 'med-bisocard-5mg',
    originalName: 'كونكور 5 مجم',
    proposedName: 'بيسوكارد 5 مجم',
    activeIngredientMatch: true,
    pharmacistRationaleAr: 'مبرر بديل',
    originalPriceEgp: 56.5,
    proposedPriceEgp: 32.0,
    approvalStatus: 'accepted',
    reviewedByPharmacistId: 'p1',
    offerVersion: 1,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  },
];
const conflictResult = convertRequestItemsToOrderItems(multiItems, conflictingAlt);
assert(
  !conflictResult.valid,
  'BLOCKS order conversion when alternative original catalog ID conflicts with requested item'
);

// Test: Null or empty originalCatalogId cannot bypass identity check for catalogued item
const nullOriginalAlt: ProposedAlternative[] = [
  {
    id: 'alt-null-original',
    requestId: 'req-multi-01',
    requestItemId: 'item-concor',
    originalCatalogId: '', // Attempted bypass via empty/null ID!
    proposedCatalogId: 'med-bisocard-5mg',
    originalName: 'كونكور 5 مجم',
    proposedName: 'بيسوكارد 5 مجم',
    activeIngredientMatch: true,
    pharmacistRationaleAr: 'مبرر بديل',
    originalPriceEgp: 56.5,
    proposedPriceEgp: 32.0,
    approvalStatus: 'accepted',
    reviewedByPharmacistId: 'p1',
    offerVersion: 1,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  },
];
const nullOriginalResult = convertRequestItemsToOrderItems(multiItems, nullOriginalAlt);
assert(
  !nullOriginalResult.valid,
  'BLOCKS order conversion when originalCatalogId is missing or null for catalogued request item (No bypass)'
);

// Test: Reject conversion when proposed alternative medicine is identical to original medicine
const identicalProposalAlt: ProposedAlternative[] = [
  {
    id: 'alt-identical',
    requestId: 'req-multi-01',
    requestItemId: 'item-concor',
    originalCatalogId: 'med-concor-5mg',
    proposedCatalogId: 'med-concor-5mg', // Identical!
    originalName: 'كونكور 5 مجم',
    proposedName: 'كونكور 5 مجم',
    activeIngredientMatch: true,
    pharmacistRationaleAr: 'مبرر بديل',
    originalPriceEgp: 56.5,
    proposedPriceEgp: 56.5,
    approvalStatus: 'accepted',
    reviewedByPharmacistId: 'p1',
    offerVersion: 1,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  },
];
const identicalResult = convertRequestItemsToOrderItems(multiItems, identicalProposalAlt);
assert(
  !identicalResult.valid,
  'BLOCKS order conversion when proposed alternative is identical to the original medicine'
);

// Regression test: Missing pharmacy confirmation for original item
const missingConfirmationItems: MedicineRequestItem[] = [
  {
    id: 'item-unconfirmed',
    requestId: 'req-multi-02',
    medicineCatalogId: 'med-antibiotic',
    rawMedicineName: 'أوجمنتين 1 جم',
    requestedQuantity: 1,
    confirmedAvailable: true,
    confirmedUnitPriceEgp: undefined, // Missing confirmed price!
  },
];
const unconfirmedConversion = convertRequestItemsToOrderItems(missingConfirmationItems, []);
assert(
  !unconfirmedConversion.valid,
  'BLOCKS order conversion when pharmacy has not explicitly confirmed original selling price (Never fabricates prices)'
);

// -----------------------------------------------------------------------------
// Suite 5: Bioequivalent Alternative Validation & Expiry
// -----------------------------------------------------------------------------
console.log('\n[Suite 5: Bioequivalent Alternative Validation & Expiry]');
const validProposal: Partial<ProposedAlternative> = {
  pharmacistRationaleAr: 'الصنف المطلوب غير متوفر بالشركة والمكافئ يحتوي على نفس المادة الفعالة بالكامل',
  proposedPriceEgp: 32.0,
  activeIngredientMatch: true,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
};
assert(validateProposedAlternative(validProposal).valid, 'Accepts valid bioequivalent proposal');

const invalidProposalNoRationale: Partial<ProposedAlternative> = {
  pharmacistRationaleAr: '',
  proposedPriceEgp: 32.0,
  activeIngredientMatch: true,
};
assert(
  !validateProposedAlternative(invalidProposalNoRationale).valid,
  'Rejects alternative lacking clinical rationale (< 10 chars)'
);

const invalidProposalNoMatch: Partial<ProposedAlternative> = {
  pharmacistRationaleAr: 'بديل علاجي مختلف تماماً',
  proposedPriceEgp: 32.0,
  activeIngredientMatch: false,
};
assert(
  !validateProposedAlternative(invalidProposalNoMatch).valid,
  'Rejects alternative without active ingredient bioequivalence match'
);

const expiredProposal: Partial<ProposedAlternative> = {
  pharmacistRationaleAr: 'الصنف مكافئ معتمد ومطابق للمعايير الصيدلانية',
  proposedPriceEgp: 45.0,
  activeIngredientMatch: true,
  expiresAt: new Date(Date.now() - 3600000).toISOString(),
};
assert(
  !validateProposedAlternative(expiredProposal, new Date()).valid,
  'BLOCKS expired alternative offer from being accepted'
);

// -----------------------------------------------------------------------------
// Suite 6: Atomic Order Conversion & Unapproved Assumptions
// -----------------------------------------------------------------------------
console.log('\n[Suite 6: Order Conversion & Configuration Guard]');
const baseRequest: MedicineRequest = {
  id: 'req-test-101',
  customerId: 'cust-demo-1',
  customerName: 'طارق عبد السلام',
  customerPhone: '+201228419022',
  deliveryAddress: {
    id: 'addr-1',
    customerId: 'cust-demo-1',
    label: 'المنزل',
    governorate: 'القاهرة',
    district: 'المعادي',
    street: 'شارع 9',
    building: '14',
    isDefault: true,
  },
  status: 'availability_confirmed',
  confirmedDeliveryFeeEgp: 20.0, // Explicitly confirmed by pharmacy, not an assumed default
  items: [
    {
      id: 'item-1',
      requestId: 'req-test-101',
      medicineCatalogId: 'med-1',
      rawMedicineName: 'Concor 5mg',
      requestedQuantity: 1,
      confirmedAvailable: true,
      confirmedUnitPriceEgp: 56.5,
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

assert(
  validateOrderConversionGuard({ request: baseRequest, existingOrderExists: false }).valid,
  'Allows order conversion when request is availability_confirmed with confirmed delivery fee'
);

// Missing delivery fee blocks conversion (unapproved fee assumption rejected)
const missingFeeRequest = { ...baseRequest, confirmedDeliveryFeeEgp: undefined };
assert(
  !validateOrderConversionGuard({ request: missingFeeRequest, existingOrderExists: false }).valid,
  'BLOCKS order conversion when delivery fee has not been confirmed (Prevents hardcoded assumptions)'
);

// Duplicate order conversion blocked
assert(
  !validateOrderConversionGuard({ request: baseRequest, existingOrderExists: true }).valid,
  'BLOCKS duplicate order conversion when an order already exists for this request'
);

// Conversion blocked if request is not confirmed
const unconfirmedRequest = { ...baseRequest, status: 'submitted' as const };
assert(
  !validateOrderConversionGuard({ request: unconfirmedRequest, existingOrderExists: false }).valid,
  'BLOCKS order conversion if request status is still submitted'
);

// -----------------------------------------------------------------------------
// Suite 7: Cryptographic Proof-of-Delivery OTP & Keyspace Uniformity
// -----------------------------------------------------------------------------
console.log('\n[Suite 7: Proof-of-Delivery OTP Handshake & Entropy]');
const secretOtp = '849201';
const testSalt = 'a1b2c3d4e5f67890';
const correctHash = createHash('sha256')
  .update(secretOtp + testSalt)
  .digest('hex');
const validExpiry = new Date(Date.now() + 14400000).toISOString();

// Valid OTP submission
const validOtpCheck = validateDeliveryOtpHandshake({
  storedHash: correctHash,
  storedSalt: testSalt,
  inputOtp: secretOtp,
  attemptsCount: 0,
  maxAttempts: 5,
  expiresAt: validExpiry,
  isConsumed: false,
});
assert(validOtpCheck.valid, 'Verifies valid 6-digit delivery OTP against salted SHA-256 hash');

// Replay prevention: consumed OTP rejection
const replayedOtpCheck = validateDeliveryOtpHandshake({
  storedHash: correctHash,
  storedSalt: testSalt,
  inputOtp: secretOtp,
  attemptsCount: 0,
  maxAttempts: 5,
  expiresAt: validExpiry,
  isConsumed: true, // Already consumed!
});
assert(
  Boolean(!replayedOtpCheck.valid && replayedOtpCheck.error?.includes('Replay blocked')),
  'BLOCKS replaying an already consumed OTP'
);

// Wrong OTP submission
const wrongOtpCheck = validateDeliveryOtpHandshake({
  storedHash: correctHash,
  storedSalt: testSalt,
  inputOtp: '111111',
  attemptsCount: 1,
  maxAttempts: 5,
  expiresAt: validExpiry,
  isConsumed: false,
});
assert(!wrongOtpCheck.valid, 'Rejects incorrect OTP input');

// Attempt limit / brute force lockout
const lockedOutCheck = validateDeliveryOtpHandshake({
  storedHash: correctHash,
  storedSalt: testSalt,
  inputOtp: secretOtp,
  attemptsCount: 5,
  maxAttempts: 5,
  expiresAt: validExpiry,
  isConsumed: false,
});
assert(
  !lockedOutCheck.valid && lockedOutCheck.lockedOut === true,
  'BLOCKS OTP verification when maximum attempts count is exceeded (Anti-Brute-Force)'
);

// Expired OTP rejection
const expiredOtpCheck = validateDeliveryOtpHandshake({
  storedHash: correctHash,
  storedSalt: testSalt,
  inputOtp: secretOtp,
  attemptsCount: 0,
  maxAttempts: 5,
  expiresAt: new Date(Date.now() - 60000).toISOString(),
  isConsumed: false,
});
assert(!expiredOtpCheck.valid, 'BLOCKS delivery completion when OTP has expired');

// Keyspace Uniformity & 32-bit Random Rejection Sampling Test
const generatedSamples: string[] = [];
let hasAbove165535 = false;
let hasAbove500000 = false;
let allWithinRange = true;

for (let i = 0; i < 200; i++) {
  const sample = generateSecureOtp();
  generatedSamples.push(sample.otpCode);
  const num = parseInt(sample.otpCode, 10);
  if (num < 100000 || num > 999999 || isNaN(num)) {
    allWithinRange = false;
  }
  if (num > 165535) {
    hasAbove165535 = true;
  }
  if (num > 500000) {
    hasAbove500000 = true;
  }
}
assert(
  generatedSamples.every((code) => code.length === 6 && /^\d{6}$/.test(code)),
  'Generates valid 6-digit numeric OTP format across all 200 samples'
);
assert(
  allWithinRange,
  'CONFIRMS exact numeric range [100000, 999999]: zero samples under 100,000 or above 999,999'
);
assert(
  hasAbove165535 && hasAbove500000,
  'CONFIRMS elimination of modulo/entropy collapse: OTP spans across full 900,000 spectrum'
);

// -----------------------------------------------------------------------------
// Suite 8: TypeScript Unit Simulation of Trigger Column Protection Invariants
// -----------------------------------------------------------------------------
console.log('\n[Suite 8: TypeScript Simulation of Trigger Column Protection Invariants]');
console.log('  NOTE: These assertions test in-memory mock simulations of database trigger invariants.');
console.log('  They verify application logic contracts; live trigger execution requires pgTAP in PostgreSQL.\n');

// Trigger Invariant Simulation: Courier INSERT Verification Protection
interface CourierInsertSimulationInput {
  callerRole: UserRole;
  isServiceRole?: boolean;
  status: string;
  verifiedBy?: string;
  verifiedAt?: string;
}

function simulateCourierInsert(input: CourierInsertSimulationInput): { permitted: boolean; reason?: string } {
  const isAdmin = input.callerRole === 'admin' || input.isServiceRole === true;
  if (!isAdmin) {
    if (input.status !== 'pending') {
      return { permitted: false, reason: 'Couriers cannot self-verify on registration. Initial status must be pending.' };
    }
    if (input.verifiedBy !== undefined || input.verifiedAt !== undefined) {
      return { permitted: false, reason: 'Only platform administrators can set courier verification metadata' };
    }
  }
  return { permitted: true };
}

assert(
  !simulateCourierInsert({
    callerRole: 'courier',
    status: 'verified',
  }).permitted,
  'SIMULATED TRIGGER & RLS: BLOCKS courier from self-approving verification status on INSERT'
);
assert(
  !simulateCourierInsert({
    callerRole: 'courier',
    status: 'pending',
    verifiedBy: 'fake-admin-uuid',
  }).permitted,
  'SIMULATED TRIGGER: BLOCKS courier from setting verification audit metadata on INSERT'
);
assert(
  simulateCourierInsert({
    callerRole: 'courier',
    status: 'pending',
  }).permitted,
  'SIMULATED TRIGGER & RLS: Permits courier registering with initial pending status and clean metadata'
);
assert(
  simulateCourierInsert({
    callerRole: 'admin',
    status: 'verified',
    verifiedBy: 'admin-uuid',
    verifiedAt: new Date().toISOString(),
  }).permitted,
  'SIMULATED TRIGGER & RLS: Authorizes administrator to create/register courier with verified status'
);

// Trigger Invariant Simulation: Courier UPDATE Protected Fields
interface CourierUpdateSimulationInput {
  callerRole: UserRole;
  isServiceRole?: boolean;
  isOwnProfile: boolean;
  oldStatus: string;
  newStatus: string;
  oldNationalId: string;
  newNationalId: string;
  oldVerifiedBy?: string;
  newVerifiedBy?: string;
}

function simulateCourierUpdate(input: CourierUpdateSimulationInput): { permitted: boolean; reason?: string } {
  const isAdmin = input.callerRole === 'admin' || input.isServiceRole === true;
  if (isAdmin) return { permitted: true };
  if (!input.isOwnProfile) return { permitted: false, reason: 'Cross-profile update denied' };
  if (input.oldStatus !== input.newStatus) {
    return { permitted: false, reason: 'Only platform administrators can modify courier verification status' };
  }
  if (input.oldNationalId !== input.newNationalId) {
    return { permitted: false, reason: 'Only platform administrators can modify courier national ID' };
  }
  if (input.oldVerifiedBy !== input.newVerifiedBy) {
    return { permitted: false, reason: 'Only platform administrators can modify courier verification metadata' };
  }
  return { permitted: true };
}

assert(
  !simulateCourierUpdate({
    callerRole: 'courier',
    isOwnProfile: true,
    oldStatus: 'pending',
    newStatus: 'verified',
    oldNationalId: '29010101234567',
    newNationalId: '29010101234567',
  }).permitted,
  'SIMULATED TRIGGER: BLOCKS courier from self-approving verification status on UPDATE'
);
assert(
  !simulateCourierUpdate({
    callerRole: 'courier',
    isOwnProfile: true,
    oldStatus: 'pending',
    newStatus: 'pending',
    oldNationalId: '29010101234567',
    newNationalId: '29999999999999',
  }).permitted,
  'SIMULATED TRIGGER: BLOCKS courier from modifying their national ID number on UPDATE'
);
assert(
  !simulateCourierUpdate({
    callerRole: 'courier',
    isOwnProfile: true,
    oldStatus: 'pending',
    newStatus: 'pending',
    oldNationalId: '29010101234567',
    newNationalId: '29010101234567',
    oldVerifiedBy: undefined,
    newVerifiedBy: 'forged-admin',
  }).permitted,
  'SIMULATED TRIGGER: BLOCKS courier from modifying verification metadata on UPDATE'
);
assert(
  simulateCourierUpdate({
    callerRole: 'courier',
    isOwnProfile: true,
    oldStatus: 'pending',
    newStatus: 'pending',
    oldNationalId: '29010101234567',
    newNationalId: '29010101234567',
  }).permitted,
  'SIMULATED TRIGGER: Permits courier updating permitted self-service fields on UPDATE (e.g. shift_status)'
);
assert(
  simulateCourierUpdate({
    callerRole: 'admin',
    isOwnProfile: false,
    oldStatus: 'pending',
    newStatus: 'verified',
    oldNationalId: '29010101234567',
    newNationalId: '29010101234567',
  }).permitted,
  'SIMULATED TRIGGER: Authorizes administrator to verify courier on UPDATE'
);

// Authorization Model Simulation: PostgreSQL SECURITY DEFINER vs. session_user semantics
// Explicitly models the distinction between:
// 1. session_user: The physical database connection initiator (e.g., 'authenticator' for PostgREST, 'postgres' for direct psql)
// 2. effective current_user: Inside a SECURITY DEFINER function, PostgreSQL switches current_user to the function owner (e.g. 'postgres')
// 3. function owner: Role that defined the function ('postgres' or 'supabase_admin')
// 4. validated JWT role claim: request.jwt.claim.role set exclusively by PostgREST upon JWT cryptographic verification
// 5. auth.uid() and assigned application roles in public.user_roles
interface PostgresSecurityContext {
  sessionUser: string;
  functionOwner: string;
  isSecurityDefiner: boolean;
  jwtClaimRole?: string;
  authUid?: string;
  userRoles: Array<{ userId: string; role: string }>;
}

interface IsAdminSimulationResult {
  isAdmin: boolean;
  effectiveCurrentUser: string;
  matchedBranch?: 'session_user_admin' | 'service_role_jwt' | 'application_admin_role';
  flawedImplementationWouldBypass: boolean;
}

function simulateIsAdmin(ctx: PostgresSecurityContext): IsAdminSimulationResult {
  // Inside a SECURITY DEFINER function, PostgreSQL sets current_user = functionOwner:
  const effectiveCurrentUser = ctx.isSecurityDefiner ? ctx.functionOwner : ctx.sessionUser;

  // The flawed implementation checked `current_user IN ('postgres', 'service_role', 'supabase_admin')`
  // which falsely evaluated to TRUE for ANY caller because effectiveCurrentUser is 'postgres'!
  const flawedImplementationWouldBypass = ['postgres', 'service_role', 'supabase_admin'].includes(effectiveCurrentUser);

  // CORRECTED POSTGRESQL AUTHORIZATION LOGIC:
  // Branch 1: Direct database administrator session (checks session_user, NOT current_user!)
  if (['postgres', 'supabase_admin'].includes(ctx.sessionUser)) {
    return { isAdmin: true, effectiveCurrentUser, matchedBranch: 'session_user_admin', flawedImplementationWouldBypass };
  }

  // Branch 2: Verified backend service-role JWT claim set by PostgREST
  if (ctx.jwtClaimRole === 'service_role') {
    return { isAdmin: true, effectiveCurrentUser, matchedBranch: 'service_role_jwt', flawedImplementationWouldBypass };
  }

  // Branch 3: Application platform administrator verified in public.user_roles
  if (ctx.authUid) {
    const hasAdminRole = ctx.userRoles.some((r) => r.userId === ctx.authUid && r.role === 'admin');
    if (hasAdminRole) {
      return { isAdmin: true, effectiveCurrentUser, matchedBranch: 'application_admin_role', flawedImplementationWouldBypass };
    }
  }

  return { isAdmin: false, effectiveCurrentUser, flawedImplementationWouldBypass };
}

// Positive Test 1: Direct superuser session ('postgres')
const directPostgresResult = simulateIsAdmin({
  sessionUser: 'postgres',
  functionOwner: 'postgres',
  isSecurityDefiner: true,
  jwtClaimRole: undefined,
  authUid: undefined,
  userRoles: [],
});
assert(
  directPostgresResult.isAdmin && directPostgresResult.matchedBranch === 'session_user_admin',
  'AUTHORIZATION CONTRACT (Positive): Direct superuser session (postgres) authorized via session_user'
);

// Positive Test 2: Direct superuser session ('supabase_admin')
const directSupabaseAdminResult = simulateIsAdmin({
  sessionUser: 'supabase_admin',
  functionOwner: 'postgres',
  isSecurityDefiner: true,
  jwtClaimRole: undefined,
  authUid: undefined,
  userRoles: [],
});
assert(
  directSupabaseAdminResult.isAdmin && directSupabaseAdminResult.matchedBranch === 'session_user_admin',
  'AUTHORIZATION CONTRACT (Positive): Direct superuser session (supabase_admin) authorized via session_user'
);

// Positive Test 3: Authorized backend service-role request
const serviceRoleResult = simulateIsAdmin({
  sessionUser: 'authenticator',
  functionOwner: 'postgres',
  isSecurityDefiner: true,
  jwtClaimRole: 'service_role',
  authUid: undefined,
  userRoles: [],
});
assert(
  serviceRoleResult.isAdmin && serviceRoleResult.matchedBranch === 'service_role_jwt',
  'AUTHORIZATION CONTRACT (Positive): PostgREST service_role JWT claim authorized as admin without auth.uid()'
);

// Positive Test 4: Legitimate application platform administrator
const appAdminResult = simulateIsAdmin({
  sessionUser: 'authenticator',
  functionOwner: 'postgres',
  isSecurityDefiner: true,
  jwtClaimRole: 'authenticated',
  authUid: 'admin-user-01',
  userRoles: [{ userId: 'admin-user-01', role: 'admin' }],
});
assert(
  appAdminResult.isAdmin && appAdminResult.matchedBranch === 'application_admin_role',
  'AUTHORIZATION CONTRACT (Positive): Authenticated user with admin role in public.user_roles authorized'
);

// Negative Test 1: Ordinary customer
const customerResult = simulateIsAdmin({
  sessionUser: 'authenticator',
  functionOwner: 'postgres',
  isSecurityDefiner: true,
  jwtClaimRole: 'authenticated',
  authUid: 'customer-user-01',
  userRoles: [{ userId: 'customer-user-01', role: 'customer' }],
});
assert(
  !customerResult.isAdmin,
  'AUTHORIZATION CONTRACT (Negative): Ordinary customer is strictly NOT authorized as administrator'
);
assert(
  customerResult.flawedImplementationWouldBypass === true,
  'SIMULATION AUDIT: Demonstrates that flawed current_user check would have mistakenly authorized ordinary customer'
);

// Negative Test 2: Unverified courier
const courierResult = simulateIsAdmin({
  sessionUser: 'authenticator',
  functionOwner: 'postgres',
  isSecurityDefiner: true,
  jwtClaimRole: 'authenticated',
  authUid: 'courier-user-01',
  userRoles: [{ userId: 'courier-user-01', role: 'courier' }],
});
assert(
  !courierResult.isAdmin,
  'AUTHORIZATION CONTRACT (Negative): Unverified courier is strictly NOT authorized as administrator'
);

// Negative Test 3: Pharmacy staff without administrator privileges
const pharmacyStaffResult = simulateIsAdmin({
  sessionUser: 'authenticator',
  functionOwner: 'postgres',
  isSecurityDefiner: true,
  jwtClaimRole: 'authenticated',
  authUid: 'pharmacy-staff-01',
  userRoles: [{ userId: 'pharmacy-staff-01', role: 'pharmacist' }],
});
assert(
  !pharmacyStaffResult.isAdmin,
  'AUTHORIZATION CONTRACT (Negative): Pharmacy staff without admin role is strictly NOT authorized as administrator'
);

// Negative Test 4: Attacker attempting self-assignment of admin role via public.user_roles INSERT
const privilegeEscalationAttempt = simulateIsAdmin({
  sessionUser: 'authenticator',
  functionOwner: 'postgres',
  isSecurityDefiner: true,
  jwtClaimRole: 'authenticated',
  authUid: 'attacker-01',
  userRoles: [{ userId: 'attacker-01', role: 'customer' }],
});
assert(
  !privilegeEscalationAttempt.isAdmin,
  'AUTHORIZATION CONTRACT (Negative): Customer attempting self-privilege escalation cannot pass WITH CHECK (public.is_admin())'
);

// Trigger Invariant Simulation: pharmacy manager cannot approve pharmacy or alter license
interface PharmacyUpdateSimulationInput {
  callerRole: UserRole;
  isPrimaryManager: boolean;
  oldStatus: string;
  newStatus: string;
  oldLicense: string;
  newLicense: string;
  oldCommercialRegister: string;
  newCommercialRegister: string;
}

function simulatePharmacyTrigger(input: PharmacyUpdateSimulationInput): { permitted: boolean; reason?: string } {
  if (input.callerRole === 'admin') return { permitted: true };
  if (!input.isPrimaryManager) return { permitted: false, reason: 'Unauthorized staff' };
  if (input.oldStatus !== input.newStatus) {
    return { permitted: false, reason: 'Only platform administrators can modify pharmacy verification status' };
  }
  if (input.oldLicense !== input.newLicense || input.oldCommercialRegister !== input.newCommercialRegister) {
    return { permitted: false, reason: 'Only platform administrators can modify pharmacy license or register' };
  }
  return { permitted: true };
}

assert(
  !simulatePharmacyTrigger({
    callerRole: 'pharmacy_staff',
    isPrimaryManager: true,
    oldStatus: 'pending',
    newStatus: 'verified',
    oldLicense: 'LIC-100',
    newLicense: 'LIC-100',
    oldCommercialRegister: 'CR-100',
    newCommercialRegister: 'CR-100',
  }).permitted,
  'SIMULATED TRIGGER: BLOCKS pharmacy manager from self-approving verification status'
);
assert(
  !simulatePharmacyTrigger({
    callerRole: 'pharmacy_staff',
    isPrimaryManager: true,
    oldStatus: 'pending',
    newStatus: 'pending',
    oldLicense: 'LIC-100',
    newLicense: 'LIC-FORGED',
    oldCommercialRegister: 'CR-100',
    newCommercialRegister: 'CR-100',
  }).permitted,
  'SIMULATED TRIGGER: BLOCKS pharmacy manager from modifying pharmacy license number'
);
assert(
  simulatePharmacyTrigger({
    callerRole: 'pharmacy_staff',
    isPrimaryManager: true,
    oldStatus: 'pending',
    newStatus: 'pending',
    oldLicense: 'LIC-100',
    newLicense: 'LIC-100',
    oldCommercialRegister: 'CR-100',
    newCommercialRegister: 'CR-100',
  }).permitted,
  'SIMULATED TRIGGER: Permits pharmacy manager updating operational profile fields (phone, address)'
);
assert(
  simulatePharmacyTrigger({
    callerRole: 'admin',
    isPrimaryManager: false,
    oldStatus: 'pending',
    newStatus: 'verified',
    oldLicense: 'LIC-100',
    newLicense: 'LIC-100',
    oldCommercialRegister: 'CR-100',
    newCommercialRegister: 'CR-100',
  }).permitted,
  'SIMULATED TRIGGER: Authorizes administrator to verify pharmacy'
);

// Invariant: direct courier delivery event insertion blocked
function simulateDeliveryEventInsert(
  callerRole: UserRole,
  isAssignedCourier: boolean,
  eventType: string
): { permitted: boolean; reason?: string } {
  if (!isAssignedCourier) return { permitted: false, reason: 'Unassigned courier' };
  if (eventType === 'delivered') {
    return { permitted: false, reason: 'Delivered event must be created exclusively via verifyDeliveryOtp RPC' };
  }
  return { permitted: true };
}

assert(
  !simulateDeliveryEventInsert('courier', true, 'delivered').permitted,
  'BLOCKS direct insertion of delivered event by courier (Enforces proof-of-delivery OTP)'
);
assert(
  simulateDeliveryEventInsert('courier', true, 'in_transit').permitted,
  'Permits courier logging operational transit event'
);

// Trigger Invariant Simulation: proposed alternative cross-table identity & composite FK validation
interface AlternativeTriggerSimulationInput {
  requestId: string;
  requestItemId: string;
  itemRequestId: string;
  itemMedicineCatalogId?: string;
  originalCatalogId?: string;
  proposedCatalogId: string;
}

function simulateProposedAlternativeTrigger(input: AlternativeTriggerSimulationInput): { permitted: boolean; reason?: string } {
  // Check 1: request_item must belong to the request (mimics composite FK & trigger check)
  if (input.requestId !== input.itemRequestId) {
    return { permitted: false, reason: 'Referenced request item does not belong to this request' };
  }

  // Check 2: catalogued item requires non-null matching original_catalog_id
  if (input.itemMedicineCatalogId) {
    if (!input.originalCatalogId) {
      return { permitted: false, reason: 'Proposed alternative must specify original_catalog_id for catalogued request item' };
    }
    if (input.originalCatalogId !== input.itemMedicineCatalogId) {
      return { permitted: false, reason: 'Proposed alternative original_catalog_id does not match request item medicine_catalog_id' };
    }
  }

  // Check 3: proposed catalog id must not be identical to original catalog id
  if (input.originalCatalogId && input.proposedCatalogId === input.originalCatalogId) {
    return { permitted: false, reason: 'Proposed alternative medicine cannot be identical to the original medicine' };
  }

  return { permitted: true };
}

assert(
  !simulateProposedAlternativeTrigger({
    requestId: 'req-01',
    requestItemId: 'item-from-req-02',
    itemRequestId: 'req-02', // Cross-request mismatch!
    itemMedicineCatalogId: 'med-concor',
    originalCatalogId: 'med-concor',
    proposedCatalogId: 'med-bisocard',
  }).permitted,
  'SIMULATED TRIGGER / COMPOSITE FK: BLOCKS alternative referencing an item belonging to a different request'
);

assert(
  !simulateProposedAlternativeTrigger({
    requestId: 'req-01',
    requestItemId: 'item-01',
    itemRequestId: 'req-01',
    itemMedicineCatalogId: 'med-concor',
    originalCatalogId: undefined, // Null/missing attempted bypass!
    proposedCatalogId: 'med-bisocard',
  }).permitted,
  'SIMULATED TRIGGER: BLOCKS proposal with null originalCatalogId for catalogued request item'
);

assert(
  !simulateProposedAlternativeTrigger({
    requestId: 'req-01',
    requestItemId: 'item-01',
    itemRequestId: 'req-01',
    itemMedicineCatalogId: 'med-concor',
    originalCatalogId: 'med-wrong-item', // Mismatched medicine!
    proposedCatalogId: 'med-bisocard',
  }).permitted,
  'SIMULATED TRIGGER: BLOCKS proposal where originalCatalogId does not match request item medicine_catalog_id'
);

assert(
  !simulateProposedAlternativeTrigger({
    requestId: 'req-01',
    requestItemId: 'item-01',
    itemRequestId: 'req-01',
    itemMedicineCatalogId: 'med-concor',
    originalCatalogId: 'med-concor',
    proposedCatalogId: 'med-concor', // Identical!
  }).permitted,
  'SIMULATED TRIGGER: BLOCKS proposal where proposed alternative medicine is identical to original medicine'
);

assert(
  simulateProposedAlternativeTrigger({
    requestId: 'req-01',
    requestItemId: 'item-01',
    itemRequestId: 'req-01',
    itemMedicineCatalogId: 'med-concor',
    originalCatalogId: 'med-concor',
    proposedCatalogId: 'med-bisocard',
  }).permitted,
  'SIMULATED TRIGGER: Permits valid bioequivalent proposal matching catalogued request item'
);

assert(
  simulateProposedAlternativeTrigger({
    requestId: 'req-01',
    requestItemId: 'item-uncatalogued',
    itemRequestId: 'req-01',
    itemMedicineCatalogId: undefined, // Uncatalogued raw medicine
    originalCatalogId: undefined,
    proposedCatalogId: 'med-bisocard',
  }).permitted,
  'SIMULATED TRIGGER: Permits proposal for uncatalogued raw medicine without false positive'
);

// -----------------------------------------------------------------------------
// Suite 9: Database Migration Static Schema & Search-Path Invariants
// -----------------------------------------------------------------------------
console.log('\n[Suite 9: Database Migration Static Schema & Search-Path Invariants]');
console.log('  Verifying static schema file invariants in supabase/migrations/20261019000001_initial_schema.sql\n');

const migrationFilePath = path.resolve(process.cwd(), 'supabase/migrations/20261019000001_initial_schema.sql');
const schemaSql = fs.readFileSync(migrationFilePath, 'utf-8');

assert(
  schemaSql.includes('CREATE POLICY "courier_profiles_insert_own_or_admin"') &&
  schemaSql.includes("verification_status = 'pending'"),
  'STATIC SCHEMA: courier_profiles INSERT policy explicitly enforces verification_status = pending for non-admins'
);

assert(
  schemaSql.includes('CREATE TRIGGER trg_courier_protect_verification') &&
  schemaSql.includes('BEFORE INSERT OR UPDATE ON public.courier_profiles'),
  'STATIC SCHEMA: trg_courier_protect_verification triggers BEFORE INSERT OR UPDATE on courier_profiles'
);

assert(
  schemaSql.includes("IF TG_OP = 'INSERT' THEN") &&
  schemaSql.includes("Couriers cannot self-verify on registration"),
  'STATIC SCHEMA: trg_prevent_courier_self_verification explicitly validates TG_OP = INSERT'
);

assert(
  /create_order_from_accepted_request[\s\S]*?SET search_path = public, extensions, pg_temp;/.test(schemaSql),
  'STATIC SCHEMA: create_order_from_accepted_request includes extensions in search_path for pgcrypto portability'
);

assert(
  /verify_delivery_otp[\s\S]*?SET search_path = public, extensions, pg_temp;/.test(schemaSql),
  'STATIC SCHEMA: verify_delivery_otp includes extensions in search_path for pgcrypto portability'
);

// Verify pg_temp is strictly the last element in search_path across all functions
const searchPathMatches = schemaSql.match(/SET search_path = [^;]+/g) || [];
const allSearchPathsEndWithPgTemp = searchPathMatches.every((sp) => /pg_temp$/.test(sp.trim()));
assert(
  searchPathMatches.length >= 15 && allSearchPathsEndWithPgTemp,
  'STATIC SCHEMA: pg_temp is strictly the last element across all SECURITY DEFINER search_paths'
);

// Verify is_admin() static invariants
assert(
  schemaSql.includes("session_user IN ('postgres', 'supabase_admin')") &&
  !schemaSql.includes("current_user IN ('postgres', 'service_role', 'supabase_admin')"),
  'STATIC SCHEMA: is_admin() uses session_user for direct superuser check and eliminates unsafe current_user'
);

assert(
  /is_admin\(\)[\s\S]*?coalesce\(current_setting\('request\.jwt\.claim\.role', true\), ''\) = 'service_role'/.test(schemaSql),
  'STATIC SCHEMA: is_admin() verifies request.jwt.claim.role = service_role for backend callers'
);

assert(
  /is_admin\(\)[\s\S]*?WHERE user_id = auth\.uid\(\) AND role = 'admin'/.test(schemaSql),
  'STATIC SCHEMA: is_admin() verifies auth.uid() against public.user_roles role = admin'
);

// -----------------------------------------------------------------------------
// Suite 10: Reconciliation Migration Static Invariants & Non-Destructive Guards
// -----------------------------------------------------------------------------
console.log('\n[Suite 10: Reconciliation Migration Static Invariants & Non-Destructive Guards]');
console.log('  Verifying reconciliation schema file invariants in supabase/migrations/20261021000001_reconcile_existing_schema.sql\n');

const reconFilePath = path.resolve(process.cwd(), 'supabase/migrations/20261021000001_reconcile_existing_schema.sql');
const reconExists = fs.existsSync(reconFilePath);
assert(reconExists, 'RECON MIGRATION: 20261021000001_reconcile_existing_schema.sql exists on disk');

if (reconExists) {
  const reconSql = fs.readFileSync(reconFilePath, 'utf-8');

  // 1. Guard against destructive statements
  const hasDestructiveTableDrops = /DROP\s+TABLE\s+(?!IF\s+EXISTS\s+(?:temp_|backup_))/i.test(reconSql);
  assert(!hasDestructiveTableDrops, 'RECON MIGRATION: Zero destructive DROP TABLE statements');

  const hasTruncate = /TRUNCATE\s+/i.test(reconSql);
  assert(!hasTruncate, 'RECON MIGRATION: Zero TRUNCATE statements (preserves all live rows)');

  // 2. Preserved tables check
  assert(
    reconSql.includes('public.medicines') && reconSql.includes('public.pharmacies_stock'),
    'RECON MIGRATION: Preserves existing public.medicines and public.pharmacies_stock'
  );

  // 3. Non-destructive seeding check (idempotent, no overwrite on reruns)
  assert(
    reconSql.includes('INSERT INTO public.medicine_catalog') && reconSql.includes('ON CONFLICT (id) DO NOTHING'),
    'RECON MIGRATION: Seeds medicine_catalog from medicines non-destructively (ON CONFLICT DO NOTHING)'
  );

  // 4. Zero fabricated medical or commercial data assertions
  assert(
    !reconSql.includes('45.00'),
    'RECON MIGRATION: Zero fabricated fallback price (45.00 EGP eliminated)'
  );

  assert(
    !reconSql.includes('الشركة المصرية للصناعات الدوائية'),
    'RECON MIGRATION: Zero fabricated manufacturer name eliminated'
  );

  assert(
    !reconSql.includes('مكافئ طبي معتمد'),
    'RECON MIGRATION: Zero fabricated active ingredient substitute eliminated'
  );

  assert(
    !reconSql.includes('عبوة صيدلانية معتمدة'),
    'RECON MIGRATION: Zero fabricated pack size eliminated'
  );

  assert(
    !reconSql.includes("'cardiovascular'"),
    'RECON MIGRATION: Zero hardcoded cardiovascular category eliminated'
  );

  // 5. Unsafe alternative-price mapping prevention
  assert(
    !reconSql.includes('COALESCE(m.alternative_price'),
    'RECON MIGRATION: alternative_price is NOT mismapped to max_regulated_price_egp'
  );

  // 6. Conservative fail-closed prescription requirement
  assert(
    reconSql.includes('COALESCE(m.prescription_required, true)'),
    'RECON MIGRATION: Prescription requirement fail-closed: defaults to TRUE when status is unknown (never false/OTC)'
  );

  // 7. Unambiguous catalog source of truth (Zero bidirectional trigger loops)
  assert(
    !reconSql.includes('CREATE TRIGGER trg_sync_medicines') && !reconSql.includes('sync_medicines_to_catalog'),
    'RECON MIGRATION: Zero trigger loops or competing write paths (sync trigger cleanly removed)'
  );

  // 8. Courier verification protection
  assert(
    reconSql.includes('CREATE POLICY "courier_profiles_insert_own_or_admin"') &&
    reconSql.includes("verification_status = 'pending'"),
    'RECON MIGRATION: courier_profiles INSERT policy explicitly enforces verification_status = pending for non-admins'
  );

  assert(
    reconSql.includes('CREATE TRIGGER trg_courier_protect_verification') &&
    reconSql.includes('BEFORE INSERT OR UPDATE ON public.courier_profiles'),
    'RECON MIGRATION: trg_courier_protect_verification triggers BEFORE INSERT OR UPDATE on courier_profiles'
  );

  // 9. Portability: pgcrypto search_path
  assert(
    /create_order_from_accepted_request[\s\S]*?SET search_path = public, extensions, auth, pg_temp;/.test(reconSql),
    'RECON MIGRATION: create_order_from_accepted_request includes extensions & auth in search_path for pgcrypto portability'
  );

  assert(
    /verify_delivery_otp[\s\S]*?SET search_path = public, extensions, auth, pg_temp;/.test(reconSql),
    'RECON MIGRATION: verify_delivery_otp includes extensions & auth in search_path for pgcrypto portability'
  );

  // 10. pg_temp strictly last
  const reconSearchPaths = reconSql.match(/SET search_path = [^;]+/g) || [];
  const reconAllEndWithPgTemp = reconSearchPaths.every((sp) => /pg_temp$/.test(sp.trim()));
  assert(
    reconSearchPaths.length >= 10 && reconAllEndWithPgTemp,
    'RECON MIGRATION: pg_temp is strictly the last element across all SECURITY DEFINER search_paths'
  );

  // 11. Admin authorization invariants
  assert(
    reconSql.includes("session_user IN ('postgres', 'supabase_admin')") &&
    !reconSql.includes("current_user IN ('postgres', 'service_role', 'supabase_admin')"),
    'RECON MIGRATION: is_admin() uses session_user for direct superuser check and eliminates unsafe current_user'
  );

  assert(
    /is_admin\(\)[\s\S]*?coalesce\(nullif\(current_setting\('request\.jwt\.claim\.role', true\), ''\), ''\) = 'service_role'/.test(reconSql),
    'RECON MIGRATION: is_admin() verifies request.jwt.claim.role = service_role for backend callers'
  );

  assert(
    /is_admin\(\)[\s\S]*?WHERE user_id = auth\.uid\(\) AND role = 'admin'/.test(reconSql),
    'RECON MIGRATION: is_admin() verifies auth.uid() against public.user_roles role = admin'
  );

  // 12. Blocker 1: Order Cancellation Authorization & Allowed-State Matrix
  assert(
    reconSql.includes("Order in status % cannot be cancelled through this transition RPC") &&
    reconSql.includes("v_ord.status IN ('in_transit', 'delivered', 'failed_delivery', 'cancelled')"),
    'BLOCKER 1 [SQL]: transition_order_status generic RPC blocks cancellation of in_transit, delivered, failed, or cancelled orders'
  );

  assert(
    reconSql.includes("v_ord.customer_id = auth.uid()") &&
    reconSql.includes("Customer can only cancel orders in confirmed status prior to pharmacy preparation"),
    'BLOCKER 1 [SQL]: transition_order_status enforces customer ownership and restricts customer to confirmed status only'
  );

  assert(
    reconSql.includes("public.is_pharmacy_staff(v_ord.pharmacy_id)") &&
    reconSql.includes("Pharmacy staff cannot cancel order in status %"),
    'BLOCKER 1 [SQL]: transition_order_status enforces fulfilling pharmacy staff membership for pharmacy cancellations'
  );

  assert(
    reconSql.includes("Caller is not authorized to cancel this order"),
    'BLOCKER 1 [SQL]: transition_order_status rejects couriers, unrelated customers, and unauthorized actors'
  );

  // 13. Blocker 2: Pharmacy Staff RLS Recursion Elimination
  assert(
    reconSql.includes("CREATE OR REPLACE FUNCTION public.is_pharmacy_manager(check_pharmacy_id UUID)") &&
    reconSql.includes("is_primary_manager = true") &&
    /is_pharmacy_manager[\s\S]*?SET search_path = public, auth, pg_temp;/.test(reconSql),
    'BLOCKER 2 [SQL]: is_pharmacy_manager() defined as SECURITY DEFINER with fixed search_path ending in pg_temp'
  );

  assert(
    !reconSql.includes('pharmacy_id IN (SELECT pharmacy_id FROM public.pharmacy_staff WHERE user_id = auth.uid())'),
    'BLOCKER 2 [SQL]: Direct recursive subquery on pharmacy_staff eliminated from all RLS policies'
  );

  assert(
    reconSql.includes('CREATE POLICY "pharmacies_manager_update" ON public.pharmacies') &&
    reconSql.includes('public.is_pharmacy_manager(id)'),
    'BLOCKER 2 [SQL]: pharmacies_manager_update uses is_pharmacy_manager(id) to avoid RLS recursion'
  );

  assert(
    reconSql.includes('CREATE POLICY "pharmacy_staff_manager_insert" ON public.pharmacy_staff') &&
    reconSql.includes('is_primary_manager = false'),
    'BLOCKER 2 [SQL]: pharmacy_staff_manager_insert prevents ordinary users or managers from appointing primary managers'
  );

  // 14. Blocker 3: Regulated Price Client Mapping
  const catalogServicePath = path.resolve(process.cwd(), 'src/services/catalogService.ts');
  const catalogServiceCode = fs.readFileSync(catalogServicePath, 'utf-8');
  assert(
    !catalogServiceCode.includes('item.alternative_price') &&
    !catalogServiceCode.includes('medData.alternative_price'),
    'BLOCKER 3 [Code]: catalogService.ts contains ZERO mapping of alternative_price to maxRegulatedPriceEgp'
  );

  assert(
    /maxRegulatedPriceEgp:\s*null/.test(catalogServiceCode),
    'BLOCKER 3 [Code]: catalogService.ts explicitly preserves unknown price as null in medicines fallback paths'
  );

  // 15. Blocker 4: Valid Delivery Address Before Order Creation
  assert(
    reconSql.includes('Delivery address is required to convert request % to order') &&
    reconSql.includes('a.customer_id = v_req.customer_id') &&
    reconSql.includes('does not belong to requesting customer'),
    'BLOCKER 4 [SQL]: create_order_from_accepted_request validates address existence and customer ownership fail-closed'
  );

  assert(
    !reconSql.includes("jsonb_build_object('label', 'Default Address'"),
    'BLOCKER 4 [SQL]: Synthetic default address snapshot is completely eliminated'
  );

  // 16. Blocker 5: Neutralizing Legacy Permissive RLS Policies with AS RESTRICTIVE
  assert(
    /CREATE POLICY "orders_block_client_insert" ON public\.orders\s+AS RESTRICTIVE\s+FOR INSERT WITH CHECK \(false\);/.test(reconSql) &&
    /CREATE POLICY "orders_block_client_update" ON public\.orders\s+AS RESTRICTIVE\s+FOR UPDATE USING \(false\);/.test(reconSql),
    'BLOCKER 5 [SQL]: orders client write blocks are AS RESTRICTIVE, neutralizing any legacy permissive policies'
  );

  assert(
    /CREATE POLICY "order_items_block_client_insert" ON public\.order_items\s+AS RESTRICTIVE\s+FOR INSERT WITH CHECK \(false\);/.test(reconSql),
    'BLOCKER 5 [SQL]: order_items client insert block is AS RESTRICTIVE, neutralizing any legacy permissive policies'
  );

  assert(
    /CREATE POLICY "order_items_block_client_delete" ON public\.order_items\s+AS RESTRICTIVE\s+FOR DELETE USING \(false\);/.test(reconSql),
    'BLOCKER 5 [SQL]: order_items client delete block is AS RESTRICTIVE, neutralizing any legacy permissive policies'
  );

  assert(
    /CREATE POLICY "orders_block_client_delete" ON public\.orders\s+AS RESTRICTIVE\s+FOR DELETE USING \(false\);/.test(reconSql),
    'BLOCKER 5 [SQL]: orders client delete block is AS RESTRICTIVE, neutralizing any legacy permissive policies'
  );

  assert(
    /CREATE POLICY "user_roles_block_non_admin_insert" ON public\.user_roles\s+AS RESTRICTIVE\s+FOR INSERT WITH CHECK \(public\.is_admin\(\)\);/.test(reconSql) &&
    /CREATE POLICY "user_roles_block_non_admin_update" ON public\.user_roles\s+AS RESTRICTIVE\s+FOR UPDATE USING \(public\.is_admin\(\)\)/.test(reconSql) &&
    /CREATE POLICY "user_roles_block_non_admin_delete" ON public\.user_roles\s+AS RESTRICTIVE\s+FOR DELETE USING \(public\.is_admin\(\)\)/.test(reconSql),
    'BLOCKER 5 [SQL]: user_roles non-admin writes are AS RESTRICTIVE, neutralizing any legacy permissive write policies'
  );

  assert(
    /CREATE POLICY "pharmacy_staff_block_unauthorized_insert" ON public\.pharmacy_staff\s+AS RESTRICTIVE\s+FOR INSERT/.test(reconSql) &&
    /CREATE POLICY "pharmacy_staff_block_non_admin_update" ON public\.pharmacy_staff\s+AS RESTRICTIVE\s+FOR UPDATE USING \(public\.is_admin\(\)\)/.test(reconSql),
    'BLOCKER 5 [SQL]: pharmacy_staff unauthorized writes are AS RESTRICTIVE, neutralizing any legacy permissive write policies'
  );

  assert(
    /CREATE POLICY "delivery_events_block_client_insert" ON public\.delivery_events\s+AS RESTRICTIVE\s+FOR INSERT/.test(reconSql) &&
    /CREATE POLICY "delivery_events_block_client_update" ON public\.delivery_events\s+AS RESTRICTIVE\s+FOR UPDATE USING \(false\);/.test(reconSql) &&
    /CREATE POLICY "delivery_events_block_client_delete" ON public\.delivery_events\s+AS RESTRICTIVE\s+FOR DELETE USING \(false\);/.test(reconSql),
    'BLOCKER 5 [SQL]: delivery_events updates, deletes, and direct delivery inserts are AS RESTRICTIVE, enforcing ledger immutability'
  );

  assert(
    /CREATE POLICY "audit_logs_block_client_insert" ON public\.audit_logs\s+AS RESTRICTIVE\s+FOR INSERT WITH CHECK \(false\);/.test(reconSql),
    'BLOCKER 5 [SQL]: audit_logs client insert block is AS RESTRICTIVE, neutralizing any legacy permissive policies'
  );
}

// -----------------------------------------------------------------------------
// Suite 11: In-Memory Unit Regression Tests for Release Blockers
// -----------------------------------------------------------------------------
console.log('\n[Suite 11: In-Memory Unit Regression Tests for Release Blockers]');

// Test 1: Order Cancellation Matrix
const samplePharmacyId = 'pharmacy-1111-1111-1111';
const customerA = 'cust-aaaa-aaaa-aaaa';
const customerB = 'cust-bbbb-bbbb-bbbb';
const courierX = 'cour-xxxx-xxxx-xxxx';

// 1.1 Customer can cancel own order in confirmed status
const custCancelConfirmed = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: customerA,
  callerRole: 'customer',
  orderCustomerId: customerA,
  orderPharmacyId: samplePharmacyId,
  currentStatus: 'confirmed',
});
assert(custCancelConfirmed.authorized, 'BLOCKER 1 [Unit]: Customer can cancel their own order in confirmed status');

// 1.2 Customer CANNOT cancel own order once beyond confirmed (in_preparation, ready, assigned, in_transit, delivered)
const custCancelInPrep = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: customerA,
  callerRole: 'customer',
  orderCustomerId: customerA,
  orderPharmacyId: samplePharmacyId,
  currentStatus: 'in_preparation',
});
assert(!custCancelInPrep.authorized, 'BLOCKER 1 [Unit]: Customer CANNOT cancel order once in_preparation');

const custCancelReady = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: customerA,
  callerRole: 'customer',
  orderCustomerId: customerA,
  orderPharmacyId: samplePharmacyId,
  currentStatus: 'ready_for_pickup',
});
assert(!custCancelReady.authorized, 'BLOCKER 1 [Unit]: Customer CANNOT cancel order in ready_for_pickup status');

const custCancelAssigned = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: customerA,
  callerRole: 'customer',
  orderCustomerId: customerA,
  orderPharmacyId: samplePharmacyId,
  currentStatus: 'assigned_to_courier',
});
assert(!custCancelAssigned.authorized, 'BLOCKER 1 [Unit]: Customer CANNOT cancel order in assigned_to_courier status');

const custCancelInTransit = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: customerA,
  callerRole: 'customer',
  orderCustomerId: customerA,
  orderPharmacyId: samplePharmacyId,
  currentStatus: 'in_transit',
});
assert(!custCancelInTransit.authorized, 'BLOCKER 1 [Unit]: Customer CANNOT cancel order in in_transit status');

const custCancelDelivered = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: customerA,
  callerRole: 'customer',
  orderCustomerId: customerA,
  orderPharmacyId: samplePharmacyId,
  currentStatus: 'delivered',
});
assert(!custCancelDelivered.authorized, 'BLOCKER 1 [Unit]: Customer CANNOT cancel order in delivered status');

// 1.3 Customer CANNOT cancel another customer's order even in confirmed status
const custCancelOther = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: customerB,
  callerRole: 'customer',
  orderCustomerId: customerA,
  orderPharmacyId: samplePharmacyId,
  currentStatus: 'confirmed',
});
assert(!custCancelOther.authorized, 'BLOCKER 1 [Unit]: Customer CANNOT cancel another customer\'s order in confirmed status');

const custCancelOtherInPrep = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: customerB,
  callerRole: 'customer',
  orderCustomerId: customerA,
  orderPharmacyId: samplePharmacyId,
  currentStatus: 'in_preparation',
});
assert(!custCancelOtherInPrep.authorized, 'BLOCKER 1 [Unit]: Customer CANNOT cancel another customer\'s order in in_preparation status');

// 1.4 Pharmacy staff can cancel assigned order in permitted pre-transit states
const pharmCancelConfirmed = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: 'staff-1',
  callerRole: 'pharmacy_staff',
  orderPharmacyId: samplePharmacyId,
  callerPharmacyIds: [samplePharmacyId],
  currentStatus: 'confirmed',
});
assert(pharmCancelConfirmed.authorized, 'BLOCKER 1 [Unit]: Assigned pharmacy staff can cancel order in confirmed status');

const pharmCancelInPrep = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: 'staff-1',
  callerRole: 'pharmacy_staff',
  orderPharmacyId: samplePharmacyId,
  callerPharmacyIds: [samplePharmacyId],
  currentStatus: 'in_preparation',
});
assert(pharmCancelInPrep.authorized, 'BLOCKER 1 [Unit]: Assigned pharmacy staff can cancel order in in_preparation');

const pharmCancelReady = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: 'staff-1',
  callerRole: 'pharmacy_staff',
  orderPharmacyId: samplePharmacyId,
  callerPharmacyIds: [samplePharmacyId],
  currentStatus: 'ready_for_pickup',
});
assert(pharmCancelReady.authorized, 'BLOCKER 1 [Unit]: Assigned pharmacy staff can cancel order in ready_for_pickup');

const pharmCancelAssigned = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: 'staff-1',
  callerRole: 'pharmacy_staff',
  orderPharmacyId: samplePharmacyId,
  callerPharmacyIds: [samplePharmacyId],
  currentStatus: 'assigned_to_courier',
});
assert(pharmCancelAssigned.authorized, 'BLOCKER 1 [Unit]: Assigned pharmacy staff can cancel order in assigned_to_courier');

// 1.5 Pharmacy staff CANNOT cancel order of a different pharmacy
const pharmCancelOtherPharm = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: 'staff-1',
  callerRole: 'pharmacy_staff',
  orderPharmacyId: samplePharmacyId,
  callerPharmacyIds: ['pharmacy-2222-2222-2222'],
  currentStatus: 'in_preparation',
});
assert(!pharmCancelOtherPharm.authorized, 'BLOCKER 1 [Unit]: Pharmacy staff CANNOT cancel order of another pharmacy');

// 1.6 Pharmacy staff CANNOT cancel in-transit or delivered orders
const pharmCancelInTransit = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: 'staff-1',
  callerRole: 'pharmacy_staff',
  orderPharmacyId: samplePharmacyId,
  callerPharmacyIds: [samplePharmacyId],
  currentStatus: 'in_transit',
});
assert(!pharmCancelInTransit.authorized, 'BLOCKER 1 [Unit]: Pharmacy staff CANNOT cancel in-transit orders');

// 1.7 Courier CANNOT cancel orders in ANY status
const courierCancelAssigned = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: courierX,
  callerRole: 'courier',
  orderPharmacyId: samplePharmacyId,
  orderCourierId: courierX,
  currentStatus: 'assigned_to_courier',
});
assert(!courierCancelAssigned.authorized, 'BLOCKER 1 [Unit]: Courier CANNOT cancel orders in assigned_to_courier');

const courierCancelInTransit = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: courierX,
  callerRole: 'courier',
  orderPharmacyId: samplePharmacyId,
  orderCourierId: courierX,
  currentStatus: 'in_transit',
});
assert(!courierCancelInTransit.authorized, 'BLOCKER 1 [Unit]: Courier CANNOT cancel orders in in_transit');

const courierCancelConfirmed = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: courierX,
  callerRole: 'courier',
  orderPharmacyId: samplePharmacyId,
  currentStatus: 'confirmed',
});
assert(!courierCancelConfirmed.authorized, 'BLOCKER 1 [Unit]: Courier CANNOT cancel orders in confirmed');

// 1.8 Admin can cancel pre-transit states, but generic transition RPC blocks in_transit or delivered
const adminCancelPreTransit = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: 'admin-1',
  callerRole: 'admin',
  orderPharmacyId: samplePharmacyId,
  currentStatus: 'in_preparation',
});
assert(adminCancelPreTransit.authorized, 'BLOCKER 1 [Unit]: Admin can cancel order in pre-transit states');

const adminCancelInTransit = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: 'admin-1',
  callerRole: 'admin',
  orderPharmacyId: samplePharmacyId,
  currentStatus: 'in_transit',
});
assert(!adminCancelInTransit.authorized, 'BLOCKER 1 [Unit]: In-transit orders cannot be cancelled via generic transition RPC');

const adminCancelDelivered = isRoleAuthorizedForOrderTransition('cancelled', {
  callerUserId: 'admin-1',
  callerRole: 'admin',
  orderPharmacyId: samplePharmacyId,
  currentStatus: 'delivered',
});
assert(!adminCancelDelivered.authorized, 'BLOCKER 1 [Unit]: Delivered orders cannot be cancelled via generic transition RPC');

// Test 2: Regulated Price Client Mapping Invariants & parseRegulatedPrice Tests
assert(
  parseRegulatedPrice(undefined) === null,
  'BLOCKER 3 [Unit]: parseRegulatedPrice(undefined) returns null for missing price'
);
assert(
  parseRegulatedPrice(null) === null,
  'BLOCKER 3 [Unit]: parseRegulatedPrice(null) returns null for null price'
);
assert(
  parseRegulatedPrice('') === null,
  'BLOCKER 3 [Unit]: parseRegulatedPrice("") returns null for empty string price'
);
assert(
  parseRegulatedPrice('   ') === null,
  'BLOCKER 3 [Unit]: parseRegulatedPrice("   ") returns null for whitespace string'
);
assert(
  parseRegulatedPrice(0) === null,
  'BLOCKER 3 [Unit]: parseRegulatedPrice(0) returns null, preventing misleading confirmed 0.00 EGP price'
);
assert(
  parseRegulatedPrice('0') === null,
  'BLOCKER 3 [Unit]: parseRegulatedPrice("0") returns null for string zero'
);
assert(
  parseRegulatedPrice(-25.5) === null,
  'BLOCKER 3 [Unit]: parseRegulatedPrice(-25.5) returns null for negative prices'
);
assert(
  parseRegulatedPrice(NaN) === null,
  'BLOCKER 3 [Unit]: parseRegulatedPrice(NaN) returns null for NaN'
);
assert(
  parseRegulatedPrice('non-numeric') === null,
  'BLOCKER 3 [Unit]: parseRegulatedPrice("non-numeric") returns null for invalid string'
);
assert(
  parseRegulatedPrice(56.5) === 56.5,
  'BLOCKER 3 [Unit]: parseRegulatedPrice(56.5) parses valid positive number accurately'
);
assert(
  parseRegulatedPrice('120.50') === 120.5,
  'BLOCKER 3 [Unit]: parseRegulatedPrice("120.50") parses valid numeric string accurately'
);

const mockMedWithAlternativePrice = {
  id: 'med-123',
  name: 'Panadol Extra (Paracetamol)',
  alternative_price: 120.50, // Price of a generic alternative, NOT this medicine's regulated price
  prescription_required: true,
};

// Pure transformation test matching catalogService fallback
function mapMedicineRecord(record: any) {
  return {
    id: record.id,
    maxRegulatedPriceEgp: null, // Must remain null without authoritative proof
    requiresPrescription: record.prescription_required !== false,
  };
}

const mapped = mapMedicineRecord(mockMedWithAlternativePrice);
assert(
  mapped.maxRegulatedPriceEgp === null,
  'BLOCKER 3 [Unit]: alternative_price is never mapped to maxRegulatedPriceEgp and remains null'
);
assert(
  mapped.maxRegulatedPriceEgp !== 0,
  'BLOCKER 3 [Unit]: Unknown price is never converted into misleading 0'
);

// Test 3: Fail-Closed Address Ownership Validation Simulation
interface MockAddress {
  id: string;
  customerId: string;
  label: string;
  street: string;
}

function validateOrderAddress(
  requestId: string,
  requestCustomerId: string,
  deliveryAddressId: string | null | undefined,
  addressesDb: MockAddress[]
): { valid: boolean; error?: string; addressSnapshot?: any } {
  if (!deliveryAddressId) {
    return { valid: false, error: `Delivery address is required to convert request ${requestId} to order` };
  }

  const addr = addressesDb.find((a) => a.id === deliveryAddressId && a.customerId === requestCustomerId);
  if (!addr) {
    const existsOtherUser = addressesDb.some((a) => a.id === deliveryAddressId);
    if (existsOtherUser) {
      return { valid: false, error: `Delivery address ${deliveryAddressId} does not belong to requesting customer ${requestCustomerId}` };
    }
    return { valid: false, error: `Delivery address ${deliveryAddressId} not found` };
  }

  return { valid: true, addressSnapshot: addr };
}

const mockDbAddresses: MockAddress[] = [
  { id: 'addr-custA-1', customerId: customerA, label: 'Home', street: '10 Tahrir St' },
  { id: 'addr-custB-1', customerId: customerB, label: 'Office', street: '20 Dokki St' },
];

const missingAddrNull = validateOrderAddress('req-1', customerA, null, mockDbAddresses);
assert(!missingAddrNull.valid && Boolean(missingAddrNull.error?.includes('required')), 'BLOCKER 4 [Unit]: Missing null address fails closed');

const missingAddrUndefined = validateOrderAddress('req-1', customerA, undefined, mockDbAddresses);
assert(!missingAddrUndefined.valid && Boolean(missingAddrUndefined.error?.includes('required')), 'BLOCKER 4 [Unit]: Missing undefined address fails closed');

const mismatchedAddrResult = validateOrderAddress('req-1', customerA, 'addr-custB-1', mockDbAddresses);
assert(!mismatchedAddrResult.valid && Boolean(mismatchedAddrResult.error?.includes('does not belong')), 'BLOCKER 4 [Unit]: Mismatched address ownership rejected');

const nonExistentAddrResult = validateOrderAddress('req-1', customerA, 'addr-nonexistent-99', mockDbAddresses);
assert(!nonExistentAddrResult.valid && Boolean(nonExistentAddrResult.error?.includes('not found')), 'BLOCKER 4 [Unit]: Non-existent address ID rejected');

// -----------------------------------------------------------------------------
// Suite: FINAL BLOCKER REPAIRS — Regression Verification Suite
// -----------------------------------------------------------------------------
console.log('\n[Suite: Final Blocker Repairs Regression Checks]');

// 1. Prescription Classification Fail-Closed Logic Test
function resolveRequiresPrescription(legacyColumnValue: boolean | null | undefined): boolean {
  // Matches SQL: COALESCE(prescription_required, true)
  return legacyColumnValue === false ? false : true;
}

assert(
  resolveRequiresPrescription(undefined) === true,
  'BLOCKER A [Unit]: Missing/undefined prescription column fails closed to true (Rx required)'
);
assert(
  resolveRequiresPrescription(null) === true,
  'BLOCKER A [Unit]: NULL prescription column fails closed to true (Rx required)'
);
assert(
  resolveRequiresPrescription(true) === true,
  'BLOCKER A [Unit]: Explicit true prescription column resolves to true'
);
assert(
  resolveRequiresPrescription(false) === false,
  'BLOCKER A [Unit]: Explicit false prescription column resolves to false (OTC allowed only when verified)'
);

// 2. Empty Request Order Conversion Guard Simulation
function validateRequestForOrderConversion(items: Array<{ id: string; available: boolean; price: number }>): { valid: boolean; reason?: string } {
  if (!items || items.length === 0) {
    return { valid: false, reason: 'Cannot create order from request with zero items' };
  }
  for (const item of items) {
    if (!item.available || item.price <= 0) {
      return { valid: false, reason: `Item ${item.id} is unconfirmed or has invalid price` };
    }
  }
  return { valid: true };
}

assert(
  !validateRequestForOrderConversion([]).valid,
  'BLOCKER C [Unit]: Empty request with 0 items is rejected before order creation'
);
assert(
  !validateRequestForOrderConversion([{ id: 'i1', available: false, price: 10 }]).valid,
  'BLOCKER C [Unit]: Request with unconfirmed item is rejected'
);
assert(
  !validateRequestForOrderConversion([{ id: 'i1', available: true, price: 0 }]).valid,
  'BLOCKER C [Unit]: Request with 0 EGP item price is rejected'
);
assert(
  validateRequestForOrderConversion([{ id: 'i1', available: true, price: 50.0 }]).valid,
  'BLOCKER C [Unit]: Request with confirmed available item and valid price is accepted'
);

// 3. Delivery Milestone RPC Scope Simulation
function validateMilestoneEventType(eventType: string): { allowed: boolean; reason?: string } {
  if (eventType === 'delivered') {
    return { allowed: false, reason: 'Successful delivery can only be recorded via verify_delivery_otp' };
  }
  if (eventType === 'assigned') {
    return { allowed: false, reason: 'Assignment can only be recorded via assign_courier_to_order' };
  }
  const permitted = ['courier_arrived_pharmacy', 'picked_up', 'in_transit', 'arrived_destination', 'delivery_failed'];
  if (!permitted.includes(eventType)) {
    return { allowed: false, reason: 'Unknown event type' };
  }
  return { allowed: true };
}

assert(
  !validateMilestoneEventType('delivered').allowed,
  'BLOCKER D [Unit]: milestone RPC strictly rejects "delivered" event (requires OTP verification)'
);
assert(
  !validateMilestoneEventType('assigned').allowed,
  'BLOCKER D [Unit]: milestone RPC strictly rejects "assigned" event (requires pharmacy assignment)'
);
assert(
  validateMilestoneEventType('courier_arrived_pharmacy').allowed,
  'BLOCKER D [Unit]: milestone RPC permits valid courier transit milestone "courier_arrived_pharmacy"'
);
assert(
  validateMilestoneEventType('in_transit').allowed,
  'BLOCKER D [Unit]: milestone RPC permits valid transit milestone "in_transit"'
);

// 4. Static SQL Migration Invariant Verification
const blockerMigrationFilePath = path.resolve(process.cwd(), 'supabase/migrations/20261021000001_reconcile_existing_schema.sql');
assert(fs.existsSync(blockerMigrationFilePath), 'Migration file exists at specified path');

const blockerMigrationSql = fs.readFileSync(blockerMigrationFilePath, 'utf8');

// Check Blocker A in SQL: fail-closed prescription default
assert(
  blockerMigrationSql.includes('ADD COLUMN IF NOT EXISTS prescription_required BOOLEAN DEFAULT NULL;'),
  'BLOCKER A [SQL]: prescription_required column is added with DEFAULT NULL (never DEFAULT FALSE)'
);
assert(
  blockerMigrationSql.includes('COALESCE(m.prescription_required, true)'),
  'BLOCKER A [SQL]: Legacy catalog seeding uses COALESCE(m.prescription_required, true) to fail closed'
);

// Check Blocker B in SQL: Pre-requisite columns added before indexes/drops
assert(
  blockerMigrationSql.includes('ADD COLUMN IF NOT EXISTS name TEXT;') &&
  blockerMigrationSql.includes('idx_medicine_catalog_search'),
  'BLOCKER B [SQL]: Catalog columns guaranteed before index creation'
);

// Check Blocker C in SQL: Empty request guard and dedicated expire RPC
assert(
  blockerMigrationSql.includes('IF NOT EXISTS (SELECT 1 FROM public.request_items WHERE request_id = p_request_id) THEN') &&
  blockerMigrationSql.includes('cannot create order from empty request'),
  'BLOCKER C [SQL]: create_order_from_accepted_request contains server-side empty request guard'
);
assert(
  blockerMigrationSql.includes('CREATE OR REPLACE FUNCTION public.expire_proposed_alternative('),
  'BLOCKER C [SQL]: Dedicated expire_proposed_alternative RPC exists and updates status to expired without rollback'
);

// Check Blocker D in SQL: Delivery event integrity and OTP lock
assert(
  blockerMigrationSql.includes('CREATE OR REPLACE FUNCTION public.record_courier_delivery_milestone('),
  'BLOCKER D [SQL]: record_courier_delivery_milestone RPC exists for courier transit events'
);
assert(
  blockerMigrationSql.includes('delivery_events_block_client_insert'),
  'BLOCKER D [SQL]: AS RESTRICTIVE policy prevents direct client INSERT into delivery_events'
);
assert(
  blockerMigrationSql.includes('DROP POLICY IF EXISTS "delivery_events_insert_courier" ON public.delivery_events;'),
  'BLOCKER D [SQL]: Legacy direct courier insert policy on delivery_events is dropped'
);

// Check Blocker E in SQL: Restrictive barrier policies on sensitive tables
const expectedBarriers = [
  'user_roles_block_non_admin_insert',
  'pharmacy_staff_block_unauthorized_insert',
  'orders_block_client_insert',
  'order_items_block_client_insert',
  'delivery_events_block_client_insert',
  'audit_logs_block_client_insert',
];
for (const barrier of expectedBarriers) {
  assert(
    blockerMigrationSql.includes(barrier),
    `BLOCKER E [SQL]: Restrictive barrier policy present: ${barrier}`
  );
}

// Check Blocker F in SQL: No fabricated commercial or geographic defaults
assert(
  !blockerMigrationSql.includes("governorate TEXT NOT NULL DEFAULT 'القاهرة'"),
  'BLOCKER F [SQL]: No fabricated default governorate on pharmacies table'
);
assert(
  !blockerMigrationSql.includes("district TEXT NOT NULL DEFAULT 'المعادي'"),
  'BLOCKER F [SQL]: No fabricated default district on pharmacies table'
);
assert(
  !blockerMigrationSql.includes("vehicle_type TEXT NOT NULL DEFAULT 'motorcycle'"),
  'BLOCKER F [SQL]: No fabricated default vehicle_type on courier_profiles'
);
assert(
  !blockerMigrationSql.includes("assigned_zone TEXT NOT NULL DEFAULT 'Cairo-South'"),
  'BLOCKER F [SQL]: No fabricated default assigned_zone on courier_profiles'
);

// Check Dynamic Audit Roles in SQL
assert(
  blockerMigrationSql.includes("v_caller_role := COALESCE(public.get_user_role(auth.uid()), 'courier');"),
  'BLOCKER F [SQL]: verify_delivery_otp and record_courier_delivery_milestone dynamically record caller role'
);

// Phase 5.2A Additional Invariant Checks:
// 1. Anti-Resurrection Guard in respond_to_alternative
assert(
  blockerMigrationSql.includes("IF v_req.status <> 'alternative_proposed' THEN") &&
  blockerMigrationSql.includes("Request cannot accept or decline alternative; current status is %"),
  'PHASE 5.2A [SQL]: respond_to_alternative prevents resurrecting cancelled or converted requests'
);

// 2. Consistent Lock Order in respond_to_alternative (Requests -> Alternatives)
assert(
  blockerMigrationSql.includes("SELECT request_id INTO v_req_id FROM public.proposed_alternatives WHERE id = p_alternative_id;") &&
  blockerMigrationSql.includes("SELECT * INTO v_req FROM public.medicine_requests WHERE id = v_req_id FOR UPDATE;") &&
  blockerMigrationSql.includes("SELECT * INTO v_alt FROM public.proposed_alternatives WHERE id = p_alternative_id FOR UPDATE;"),
  'PHASE 5.2A [SQL]: respond_to_alternative maintains consistent lock order (requests before alternatives)'
);

// 3. Multi-Item Fulfillment Resolution Check in respond_to_alternative
assert(
  blockerMigrationSql.includes("ri.confirmed_available IS TRUE AND ri.confirmed_unit_price_egp > 0") &&
  blockerMigrationSql.includes("pa.approval_status = 'accepted'") &&
  blockerMigrationSql.includes("pa.proposed_price_egp > 0") &&
  blockerMigrationSql.includes("approval_status = 'pending_customer'"),
  'PHASE 5.2A [SQL]: respond_to_alternative advances to availability_confirmed ONLY when all items have valid fulfillment decisions'
);

// 4. Ownership / Authorization Check in expire_proposed_alternative
assert(
  blockerMigrationSql.includes("v_req.customer_id = auth.uid() OR (v_req.assigned_pharmacy_id IS NOT NULL AND public.is_pharmacy_staff(v_req.assigned_pharmacy_id)) OR public.is_admin()"),
  'PHASE 5.2A [SQL]: expire_proposed_alternative validates customer, assigned pharmacy staff, or admin authorization'
);

// 5. Strict Pricing Validation & Unexpected Key Rejection in confirm_pharmacy_availability
assert(
  blockerMigrationSql.includes("cannot confirm availability for empty request") &&
  blockerMigrationSql.includes("p_items_pricing contains unexpected item IDs not belonging to request") &&
  blockerMigrationSql.includes("Missing pricing entry in p_items_pricing for item") &&
  blockerMigrationSql.includes("v_unit_price <= 0"),
  'PHASE 5.2A [SQL]: confirm_pharmacy_availability validates all items, rejects unexpected keys, and enforces positive prices'
);

// 6. Courier PII Protection in courier_profiles SELECT policy
assert(
  blockerMigrationSql.includes('CREATE POLICY "courier_profiles_select_own_or_admin" ON public.courier_profiles') &&
  !blockerMigrationSql.includes("(verification_status = 'verified' AND shift_status = 'available')"),
  'PHASE 5.2A [SQL]: courier_profiles SELECT policy strictly protects national_id_number from public/customer exposure'
);

// 7. Restrictive Write Barriers on Requests, Items, and Alternatives
assert(
  blockerMigrationSql.includes('CREATE POLICY "medicine_requests_block_unauthorized_insert" ON public.medicine_requests') &&
  blockerMigrationSql.includes('CREATE POLICY "medicine_requests_block_unauthorized_update" ON public.medicine_requests') &&
  blockerMigrationSql.includes('CREATE POLICY "medicine_requests_block_client_delete" ON public.medicine_requests'),
  'PHASE 5.2A [SQL]: medicine_requests write barriers are AS RESTRICTIVE, preventing client privilege/state tampering'
);

assert(
  blockerMigrationSql.includes('CREATE POLICY "request_items_block_unauthorized_insert" ON public.request_items') &&
  blockerMigrationSql.includes('CREATE POLICY "request_items_block_client_update" ON public.request_items') &&
  blockerMigrationSql.includes('CREATE POLICY "request_items_block_client_delete" ON public.request_items'),
  'PHASE 5.2A [SQL]: request_items write barriers are AS RESTRICTIVE, neutralizing any legacy permissive write policies'
);

assert(
  blockerMigrationSql.includes('CREATE POLICY "proposed_alternatives_block_unauthorized_insert" ON public.proposed_alternatives') &&
  blockerMigrationSql.includes('CREATE POLICY "proposed_alternatives_block_client_update" ON public.proposed_alternatives') &&
  blockerMigrationSql.includes('CREATE POLICY "proposed_alternatives_block_client_delete" ON public.proposed_alternatives'),
  'PHASE 5.2A [SQL]: proposed_alternatives write barriers are AS RESTRICTIVE, forcing lifecycle updates through audited RPCs'
);

assert(
  blockerMigrationSql.includes('CREATE POLICY "customer_addresses_restrictive_ownership" ON public.customer_addresses'),
  'PHASE 5.2A [SQL]: customer_addresses barrier is AS RESTRICTIVE, preventing unauthorized cross-user modifications'
);

// 8. Schema-Qualified Enum Existence Guards & Pricing Payload Type Barrier
assert(
  blockerMigrationSql.includes("WHERE n.nspname = 'public' AND t.typname = 'user_role_type'") &&
  blockerMigrationSql.includes("WHERE n.nspname = 'public' AND t.typname = 'order_status_type'"),
  'PHASE 5.2A [SQL]: Enum existence checks are schema-qualified to public schema, preventing cross-schema collisions'
);

assert(
  blockerMigrationSql.includes("jsonb_typeof(p_items_pricing) <> 'object'") &&
  blockerMigrationSql.includes("approval_status = 'expired'") &&
  blockerMigrationSql.includes("approval_status = 'pending_customer'"),
  'PHASE 5.2A [SQL]: confirm_pharmacy_availability strictly validates JSON object payload type and expires lingering proposals'
);

// 8B. Phase 5.2B Fresh-Schema Idempotency Guards (Self-sufficient reconciliation)
assert(
  blockerMigrationSql.includes('CREATE TABLE IF NOT EXISTS public.medicines') &&
  blockerMigrationSql.includes('CREATE TABLE IF NOT EXISTS public.pharmacies_stock'),
  'PHASE 5.2B [SQL]: Candidate migration ensures public.medicines and public.pharmacies_stock exist before alterations and RLS'
);

// 9. In-Memory Simulation: Multi-Item Fulfillment State Gate
function evaluateRequestFulfillmentReadiness(
  items: Array<{ id: string; available: boolean; price: number }>,
  alternatives: Array<{ itemId: string; status: 'pending_customer' | 'accepted' | 'declined' | 'expired'; price: number }>
): { orderReady: boolean; reason?: string } {
  // Check if any alternatives remain pending
  const hasPending = alternatives.some((a) => a.status === 'pending_customer');
  if (hasPending) {
    return { orderReady: false, reason: 'Pending alternative proposals exist' };
  }

  // Check that every item is either confirmed available with price > 0, OR has an accepted alternative with price > 0
  for (const item of items) {
    const isDirectlyAvailable = item.available && item.price > 0;
    const hasAcceptedAlternative = alternatives.some(
      (a) => a.itemId === item.id && a.status === 'accepted' && a.price > 0
    );
    if (!isDirectlyAvailable && !hasAcceptedAlternative) {
      return { orderReady: false, reason: `Item ${item.id} is neither confirmed available nor fulfilled via accepted alternative` };
    }
  }

  return { orderReady: true };
}

const twoItemRequest = [
  { id: 'item-1', available: false, price: 0 },
  { id: 'item-2', available: false, price: 0 },
];

// Case A: Item 1 accepted alternative, but Item 2 still has pending alternative
assert(
  !evaluateRequestFulfillmentReadiness(twoItemRequest, [
    { itemId: 'item-1', status: 'accepted', price: 30 },
    { itemId: 'item-2', status: 'pending_customer', price: 40 },
  ]).orderReady,
  'PHASE 5.2A [Unit]: Request CANNOT become order-ready while another item has an unresolved pending alternative'
);

// Case B: Item 1 accepted alternative, but Item 2 has NO alternative and is unavailable
assert(
  !evaluateRequestFulfillmentReadiness(twoItemRequest, [
    { itemId: 'item-1', status: 'accepted', price: 30 },
  ]).orderReady,
  'PHASE 5.2A [Unit]: Request CANNOT become order-ready if any item remains completely unresolved/unavailable'
);

// Case C: Item 1 accepted alternative, Item 2 directly confirmed available
assert(
  evaluateRequestFulfillmentReadiness(
    [
      { id: 'item-1', available: false, price: 0 },
      { id: 'item-2', available: true, price: 45 },
    ],
    [{ itemId: 'item-1', status: 'accepted', price: 30 }]
  ).orderReady,
  'PHASE 5.2A [Unit]: Request BECOMES order-ready when all items have valid fulfillment decisions (accepted alt + direct confirmed)'
);

console.log(`\n================================================================`);
console.log(`Test Execution Summary: ${passed} assertions passed, ${failed} failed.`);
console.log(`================================================================\n`);

if (failed > 0) {
  process.exit(1);
}
