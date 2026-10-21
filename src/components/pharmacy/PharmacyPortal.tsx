import React, { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Building2,
  CheckCircle,
  AlertTriangle,
  Clock,
  PackageCheck,
  Check,
  X,
  FileCheck,
  ShieldCheck,
  HelpCircle,
  Pill,
  Boxes,
  Truck,
  Award,
  AlertCircle,
  Search,
  Filter,
  FileText,
  UserCheck,
  Phone,
} from 'lucide-react';
import {
  FIXTURE_PHARMACIES,
  FIXTURE_REQUESTS,
  FIXTURE_ORDERS,
  FIXTURE_CATALOG,
  FIXTURE_COURIERS,
} from '../../data/developmentFixtures';
import { MedicineRequest, Order, MedicineCatalogItem, CourierProfile } from '../../types';
import { PrototypeNoticeBanner } from '../common/PrototypeNoticeBanner';

interface InventoryItem extends MedicineCatalogItem {
  inStock: boolean;
  batchNumber: string;
  shelfUnits: number;
  expiryDate: string;
}

export const PharmacyPortal: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const getInitialTab = (): 'inbound' | 'packaging' | 'inventory' | 'history' | 'credentials' => {
    if (location.pathname.includes('/packaging')) return 'packaging';
    if (location.pathname.includes('/inventory')) return 'inventory';
    if (location.pathname.includes('/history')) return 'history';
    if (location.pathname.includes('/credentials')) return 'credentials';
    return 'inbound';
  };

  const [activeTab, setActiveTab] = useState<'inbound' | 'packaging' | 'inventory' | 'history' | 'credentials'>(getInitialTab());

  const handleTabChange = (tab: 'inbound' | 'packaging' | 'inventory' | 'history' | 'credentials') => {
    setActiveTab(tab);
    if (tab === 'inbound') navigate('/pharmacy');
    else navigate(`/pharmacy/${tab}`);
  };

  const pharmacy = FIXTURE_PHARMACIES[0]; // Elite Pharmacy Maadi
  const [requests, setRequests] = useState<MedicineRequest[]>(FIXTURE_REQUESTS);
  const [orders, setOrders] = useState<Order[]>(FIXTURE_ORDERS);
  const [couriers] = useState<CourierProfile[]>(FIXTURE_COURIERS);

  // Search in inventory
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryStockFilter, setInventoryStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');

  // Realistic mock pharmacy stock
  const [inventory, setInventory] = useState<InventoryItem[]>([
    {
      ...FIXTURE_CATALOG[0],
      inStock: false,
      batchNumber: 'B-2025-991',
      shelfUnits: 0,
      expiryDate: '12/2026',
    },
    {
      ...FIXTURE_CATALOG[1],
      inStock: true,
      batchNumber: 'B-2026-104',
      shelfUnits: 45,
      expiryDate: '08/2027',
    },
    {
      ...FIXTURE_CATALOG[2],
      inStock: true,
      batchNumber: 'P-99214',
      shelfUnits: 80,
      expiryDate: '03/2028',
    },
    {
      ...FIXTURE_CATALOG[3],
      inStock: true,
      batchNumber: 'C-8812',
      shelfUnits: 120,
      expiryDate: '11/2027',
    },
    {
      ...FIXTURE_CATALOG[4],
      inStock: false,
      batchNumber: 'A-2210',
      shelfUnits: 0,
      expiryDate: '05/2026',
    },
    {
      ...FIXTURE_CATALOG[5],
      inStock: true,
      batchNumber: 'H-9182',
      shelfUnits: 34,
      expiryDate: '09/2027',
    },
  ]);

  // Proposal Modal State
  const [proposeModalOpen, setProposeModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<MedicineRequest | null>(null);
  const [proposedCatalogId, setProposedCatalogId] = useState(FIXTURE_CATALOG[1].id); // Bisocard
  const [pharmacistRationale, setPharmacistRationale] = useState(
    'الصنف المطلوب غير متوفر حالياً بالمخازن؛ والبديل المقترح معتمد ومكافئ بيولوجياً في المادة الفعالة والشكل الصيدلي.'
  );

  // Confirm Availability Modal State
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmingRequest, setConfirmingRequest] = useState<MedicineRequest | null>(null);
  const [confirmedDeliveryFee, setConfirmedDeliveryFee] = useState<number>(25);

  // Assign Courier Modal State
  const [assignCourierModalOpen, setAssignCourierModalOpen] = useState(false);
  const [selectedOrderForCourier, setSelectedOrderForCourier] = useState<Order | null>(null);
  const [selectedCourierId, setSelectedCourierId] = useState<string>(FIXTURE_COURIERS[0].id);

  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Filtered inventory
  const filteredInventory = useMemo(() => {
    return inventory.filter((item) => {
      const q = inventorySearch.toLowerCase().trim();
      const matchesSearch =
        q === '' ||
        item.brandNameAr.toLowerCase().includes(q) ||
        item.brandNameEn.toLowerCase().includes(q) ||
        item.activeIngredient.toLowerCase().includes(q) ||
        item.batchNumber.toLowerCase().includes(q);

      const matchesStock =
        inventoryStockFilter === 'all' ||
        (inventoryStockFilter === 'in_stock' && item.inStock) ||
        (inventoryStockFilter === 'out_of_stock' && !item.inStock);

      return matchesSearch && matchesStock;
    });
  }, [inventory, inventorySearch, inventoryStockFilter]);

  // Pharmacist opens confirm availability modal
  const openConfirmModal = (req: MedicineRequest) => {
    setConfirmingRequest(req);
    setConfirmedDeliveryFee(req.confirmedDeliveryFeeEgp || 25);
    setConfirmModalOpen(true);
  };

  // Submit confirmed availability
  const handleConfirmAvailabilitySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmingRequest) return;

    setRequests((prev) =>
      prev.map((r) =>
        r.id === confirmingRequest.id
          ? {
              ...r,
              status: 'availability_confirmed',
              confirmedDeliveryFeeEgp: confirmedDeliveryFee,
              items: r.items.map((it) => ({
                ...it,
                confirmedAvailable: true,
                confirmedUnitPriceEgp: 56.50, // EDA official price
              })),
            }
          : r
      )
    );

    setConfirmModalOpen(false);
    setConfirmingRequest(null);
    setActionNotice('تم تأكيد التوفر الفعلي والسعر الجبري وتحديد رسوم التوصيل وإشعار المريض للتأكيد.');
    setTimeout(() => setActionNotice(null), 5000);
  };

  // Pharmacist submits alternative proposal
  const handleSubmitAlternative = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest) return;

    if (pharmacistRationale.trim().length < 10) {
      alert('يجب تقديم مبرر صيدلاني لا يقل عن 10 أحرف يوضح التطابق الدوائي.');
      return;
    }

    const proposedMed = FIXTURE_CATALOG.find((m) => m.id === proposedCatalogId) || FIXTURE_CATALOG[1];

    setRequests((prev) =>
      prev.map((r) => {
        if (r.id === selectedRequest.id) {
          return {
            ...r,
            status: 'alternative_proposed',
            proposedAlternative: {
              id: `alt-${Date.now()}`,
              requestId: r.id,
              originalCatalogId: r.items[0]?.medicineCatalogId || '',
              proposedCatalogId: proposedMed.id,
              originalName: r.items[0]?.rawMedicineName || 'الصنف الأصلي',
              proposedName: `${proposedMed.brandNameAr} (${proposedMed.brandNameEn})`,
              activeIngredientMatch: true,
              pharmacistRationaleAr: pharmacistRationale,
              originalPriceEgp: 56.50,
              proposedPriceEgp: proposedMed.maxRegulatedPriceEgp ?? 0,
              approvalStatus: 'pending_customer',
              reviewedByPharmacistId: pharmacy.id,
              offerVersion: 1,
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
          };
        }
        return r;
      })
    );

    setProposeModalOpen(false);
    setSelectedRequest(null);
    setActionNotice('تم إرسال اقتراح البديل للمريض مع التقرير الصيدلاني بانتظار موافقته الصريحة.');
    setTimeout(() => setActionNotice(null), 5000);
  };

  // Packaging seal verification
  const handleVerifySeal = (orderId: string) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: 'ready_for_pickup', tamperSealVerified: true } : o))
    );
    setActionNotice('تم فحص الدواء وتطبيق شريط الأمان الشمعي (Tamper-Seal Verified) وتجهيز الطرد للاستلام.');
    setTimeout(() => setActionNotice(null), 5000);
  };

  // Assign courier to ready order
  const handleAssignCourier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderForCourier) return;

    const courier = couriers.find((c) => c.id === selectedCourierId);

    setOrders((prev) =>
      prev.map((o) =>
        o.id === selectedOrderForCourier.id
          ? {
              ...o,
              courierId: courier?.id,
              courierName: courier?.fullName,
              courierPhone: courier?.phone,
              status: 'assigned_to_courier',
            }
          : o
      )
    );

    setAssignCourierModalOpen(false);
    setSelectedOrderForCourier(null);
    setActionNotice(`تم إسناد الطلب للمندوب المعتمد (${courier?.fullName}) وإشعاره بالاستلام.`);
    setTimeout(() => setActionNotice(null), 5000);
  };

  // Toggle stock in inventory
  const handleToggleStock = (medId: string) => {
    setInventory((prev) =>
      prev.map((item) => {
        if (item.id === medId) {
          const nextStock = !item.inStock;
          return {
            ...item,
            inStock: nextStock,
            shelfUnits: nextStock ? 25 : 0,
          };
        }
        return item;
      })
    );
  };

  return (
    <div className="space-y-6">
      {/* Reusable Prototype State Notice */}
      <PrototypeNoticeBanner portalName="بوابة الصيدليات المرخصة" />

      {/* Pharmacy Header & Verification Credentials */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0 font-bold">
              <Building2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900">{pharmacy.commercialName}</h1>
                <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  صيدلية مرخصة معتمدة
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                ترخيص وزارة الصحة: <span className="font-mono text-slate-700">{pharmacy.licenseNumber}</span> · السجل التجاري: <span className="font-mono text-slate-700">{pharmacy.commercialRegister}</span> · النطاق: <strong className="text-slate-700">{pharmacy.district}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleTabChange('inbound')}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              مراجعة الطلبات الواردة ({requests.length})
            </button>
          </div>
        </div>

        {/* Tab Switcher / Sub-navigation */}
        <div className="flex items-center gap-2 border-t border-slate-100 mt-5 pt-4 overflow-x-auto">
          <button
            onClick={() => handleTabChange('inbound')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'inbound'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>الطلبات الواردة للمراجعة</span>
            <span className="text-[11px] tabular-nums font-mono px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded">
              {requests.filter((r) => r.status === 'submitted' || r.status === 'under_pharmacy_review' || r.status === 'alternative_proposed').length}
            </span>
          </button>
          <button
            onClick={() => handleTabChange('packaging')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'packaging'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>التجهيز وختم الأمان (Packaging)</span>
            <span className="text-[11px] tabular-nums font-mono px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded">
              {orders.length}
            </span>
          </button>
          <button
            onClick={() => handleTabChange('inventory')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'inventory'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>المخزون وأرفف الأدوية</span>
          </button>
          <button
            onClick={() => handleTabChange('history')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'history'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            سجل الصرف والفواتير ({orders.length})
          </button>
          <button
            onClick={() => handleTabChange('credentials')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'credentials'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            بيانات الاعتماد والترخيص الحكومي
          </button>
        </div>
      </div>

      {/* Action Notification */}
      {actionNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <p className="font-medium">{actionNotice}</p>
        </div>
      )}

      {/* VIEW 1: INBOUND REQUESTS & PHARMACIST WORKFLOW */}
      {activeTab === 'inbound' && (
        <div className="space-y-4">
          <div className="bg-slate-100/70 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              مسؤولية الصيدلي القانونية: يجب التحقق الفعلي من توفر العبوات على الأرفف وتطبيق التسعيرة الجبرية الرسمية قبل قبول الطلب.
            </span>
          </div>

          {requests.map((req) => (
            <div key={req.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-900">{req.id}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-xs text-slate-600">
                    المريض: <strong className="text-slate-800">{req.customerName}</strong> ({req.customerPhone})
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-500">
                    {new Date(req.createdAt).toLocaleDateString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                    {req.status === 'submitted'
                      ? 'بانتظار فحص الأرفف'
                      : req.status === 'under_pharmacy_review'
                      ? 'قيد الفحص المخبري'
                      : req.status === 'alternative_proposed'
                      ? 'تم اقتراح بديل'
                      : req.status === 'availability_confirmed'
                      ? 'تم تأكيد التوفر'
                      : req.status}
                  </span>
                </div>
              </div>

              {/* Items in Request */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700">الأصناف المطلوبة من المريض:</p>
                {req.items.map((item) => (
                  <div key={item.id} className="p-3 bg-slate-50 rounded-lg text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">{item.rawMedicineName}</p>
                      <p className="text-slate-500">الكمية المطلوبة: {item.requestedQuantity} عبوة</p>
                      {item.customerNotes && (
                        <p className="text-slate-500 mt-1 italic">ملاحظة المريض: {item.customerNotes}</p>
                      )}
                      {item.prescriptionAttachmentUrl && (
                        <p className="text-emerald-700 text-[11px] font-semibold mt-1 flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5" />
                          <span>مرفق روشتة طبية معتمدة: {item.prescriptionAttachmentUrl}</span>
                        </p>
                      )}
                    </div>
                    <div className="text-left">
                      <span className="text-[11px] text-slate-400 block">التسعيرة الجبرية الرسمية</span>
                      <span className="font-bold text-slate-900 text-sm">
                        {item.confirmedUnitPriceEgp
                          ? `${(item.confirmedUnitPriceEgp * item.requestedQuantity).toFixed(2)} ج.م`
                          : '56.50 ج.م'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Workflow Actions */}
              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="text-slate-500">
                  عنوان التوصيل: {req.deliveryAddress.district} — {req.deliveryAddress.street}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setSelectedRequest(req);
                      setProposeModalOpen(true);
                    }}
                    className="px-3.5 py-1.5 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    اقتراح بديل مكافئ بيولوجياً
                  </button>
                  <button
                    onClick={() => openConfirmModal(req)}
                    className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    تأكيد التوفر والسعر الجبري
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* VIEW 2: PACKAGING & TAMPER SEAL */}
      {activeTab === 'packaging' && (
        <div className="space-y-4">
          <div className="bg-slate-100/70 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 flex items-center gap-2">
            <PackageCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              إلزامية ختم الأمان (Tamper-Evident Seal): يُحظر تسليم أي طرد دوائي للمندوب بدون وضع شريط الأمان المعتمد لمنع التلاعب وضمان خصوصية المريض.
            </span>
          </div>

          {orders.map((ord) => (
            <div key={ord.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <span className="font-bold text-slate-900 text-sm font-mono">{ord.orderNumber}</span>
                  <span className="text-slate-400 text-xs mr-2">المريض: {ord.customerName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded ${
                      ord.tamperSealVerified
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {ord.tamperSealVerified ? 'ختم الأمان موثق ومطابق' : 'بانتظار وضع ختم الأمان'}
                  </span>
                </div>
              </div>

              {/* Items in Order */}
              <div className="space-y-1">
                {ord.items.map((item) => (
                  <div key={item.id} className="flex justify-between text-xs py-1">
                    <span className="text-slate-700">
                      {item.name} × {item.quantity}
                    </span>
                    <span className="font-bold text-slate-900 tabular-nums">{item.totalPriceEgp.toFixed(2)} ج.م</span>
                  </div>
                ))}
              </div>

              {/* Packaging Actions */}
              <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  {ord.courierName ? (
                    <p className="text-slate-600">
                      المندوب المسند: <strong className="text-slate-900">{ord.courierName}</strong> ({ord.courierPhone})
                    </p>
                  ) : (
                    <p className="text-amber-800 font-medium">لم يتم إسناد مندوب توصيل بعد</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {!ord.tamperSealVerified && (
                    <button
                      onClick={() => handleVerifySeal(ord.id)}
                      className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>تأكيد وضع ختم الأمان (Tamper-Seal)</span>
                    </button>
                  )}
                  {ord.tamperSealVerified && !ord.courierId && (
                    <button
                      onClick={() => {
                        setSelectedOrderForCourier(ord);
                        setAssignCourierModalOpen(true);
                      }}
                      className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <Truck className="w-4 h-4" />
                      <span>إسناد للمندوب للاستلام</span>
                    </button>
                  )}
                  {ord.tamperSealVerified && ord.courierId && (
                    <span className="text-emerald-700 font-semibold flex items-center gap-1">
                      <Check className="w-4 h-4" />
                      <span>جاهز للاستلام الميداني بواسطة المندوب</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* VIEW 3: INVENTORY */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">حالة أرفف ومخزون الصيدلية المعتمد</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                تحديث حالة توفر الأدوية على الأرفف يتيح توجيه المرضى مباشرة وتقديم البدائل دون إهدار للوقت.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                <input
                  type="text"
                  placeholder="بحث في المخزون أو رقم التشغيلة..."
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  className="pl-3 pr-9 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <select
                value={inventoryStockFilter}
                onChange={(e) => setInventoryStockFilter(e.target.value as any)}
                className="text-xs p-1.5 border border-slate-200 rounded-lg bg-white"
              >
                <option value="all">كل الحالات</option>
                <option value="in_stock">المتوفر فقط</option>
                <option value="out_of_stock">غير المتوفر</option>
              </select>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="p-3">الصنف الدوائي</th>
                    <th className="p-3">المادة الفعالة</th>
                    <th className="p-3">التشغيلة (Batch)</th>
                    <th className="p-3">تاريخ الصلاحية</th>
                    <th className="p-3">التسعيرة الجبرية</th>
                    <th className="p-3">حالة الرصيد</th>
                    <th className="p-3 text-left">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInventory.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="p-3">
                        <strong className="text-slate-900 block">{item.brandNameAr}</strong>
                        <span className="text-slate-500 text-[11px]">{item.brandNameEn}</span>
                      </td>
                      <td className="p-3 text-slate-600">{item.activeIngredient}</td>
                      <td className="p-3 font-mono text-slate-600">{item.batchNumber}</td>
                      <td className="p-3 text-slate-600">{item.expiryDate}</td>
                      <td className="p-3 font-bold text-slate-900 tabular-nums">
                        {item.maxRegulatedPriceEgp != null ? `${item.maxRegulatedPriceEgp.toFixed(2)} ج.م` : 'غير مسجل'}
                      </td>
                      <td className="p-3">
                        {item.inStock ? (
                          <span className="text-emerald-700 font-semibold">
                            متوفر ({item.shelfUnits} عبوة)
                          </span>
                        ) : (
                          <span className="text-rose-700 font-semibold">
                            غير متوفر بالمخزن
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-left">
                        <button
                          onClick={() => handleToggleStock(item.id)}
                          className={`px-3 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                            item.inStock
                              ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                              : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
                          }`}
                        >
                          {item.inStock ? 'تعيين كغير متوفر' : 'تأكيد توفر عبوات'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4: HISTORY */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
            <h3 className="font-bold text-slate-900 text-sm mb-3">سجل عمليات الصرف والفواتير المعتمدة</h3>
            <div className="space-y-3">
              {orders.map((ord) => (
                <div key={ord.id} className="p-3 bg-slate-50 rounded-lg flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-900 font-mono">{ord.orderNumber}</span>
                    <span className="text-slate-400 mr-2">· المريض: {ord.customerName}</span>
                    <p className="text-slate-500 mt-1">تاريخ المعاملة: {new Date(ord.createdAt).toLocaleDateString('ar-EG')}</p>
                  </div>
                  <div className="text-left">
                    <span className="font-bold text-emerald-800 text-sm tabular-nums">{ord.totalEgp.toFixed(2)} ج.م</span>
                    <span className="block text-[11px] text-slate-400">مكتمل بالختم الرسمي</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 5: CREDENTIALS */}
      {activeTab === 'credentials' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4 text-xs">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Award className="w-5 h-5 text-emerald-700" />
            <h3 className="font-bold text-slate-900 text-sm">بيانات الاعتماد والترخيص الحكومي</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-slate-600">
            <div className="p-3 bg-slate-50 rounded-lg space-y-1">
              <span className="text-slate-400">الاسم التجاري المسجل:</span>
              <p className="font-bold text-slate-900 text-sm">{pharmacy.commercialName}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg space-y-1">
              <span className="text-slate-400">رقم ترخيص وزارة الصحة المصرية:</span>
              <p className="font-bold text-slate-900 text-sm font-mono">{pharmacy.licenseNumber}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg space-y-1">
              <span className="text-slate-400">رقم السجل التجاري:</span>
              <p className="font-bold text-slate-900 text-sm font-mono">{pharmacy.commercialRegister}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg space-y-1">
              <span className="text-slate-400">حالة التحقق لدى هيئة الدواء المصرية (EDA):</span>
              <p className="font-bold text-emerald-800">موثق ومعتمد رسمياً</p>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg text-slate-500 leading-relaxed">
            ملاحظة أمنية وقانونية: وفقاً لضوابط PostgreSQL Triggers في نظام علاجك، لا يمكن للصيدلية تعديل رقم الترخيص أو السجل التجاري أو حالة التوثيق بشكل ذاتي؛ وتقتصر تلك الصلاحية حصرياً على مدير النظام (Admin) بعد الفحص الميداني والوثائقي.
          </div>
        </div>
      )}

      {/* PROPOSE ALTERNATIVE MODAL */}
      {proposeModalOpen && selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-200 text-right">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <button
                onClick={() => setProposeModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 text-sm font-semibold rounded-md cursor-pointer"
              >
                إغلاق ✕
              </button>
              <h3 className="font-semibold text-slate-900 text-base">اقتراح بديل مكافئ بيولوجياً</h3>
            </div>

            <form onSubmit={handleSubmitAlternative} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">الصنف المطلوب من المريض</label>
                <div className="p-3 bg-slate-50 rounded-lg text-xs">
                  <p className="font-bold text-slate-900">{selectedRequest.items[0]?.rawMedicineName}</p>
                  <p className="text-rose-600 mt-1">الحالة على الأرفف: غير متوفر حالياً</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">اختيار البديل المكافئ المصرح</label>
                <select
                  value={proposedCatalogId}
                  onChange={(e) => setProposedCatalogId(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg bg-white"
                >
                  {FIXTURE_CATALOG.filter((m) => m.id !== selectedRequest.items[0]?.medicineCatalogId).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.brandNameAr} ({m.brandNameEn}) — {m.maxRegulatedPriceEgp != null ? `${m.maxRegulatedPriceEgp.toFixed(2)} ج.م` : 'السعر غير مسجل'} (المادة: {m.activeIngredient})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  المبرر الصيدلاني الإلزامي (Clinical Rationale)
                </label>
                <textarea
                  rows={3}
                  required
                  value={pharmacistRationale}
                  onChange={(e) => setPharmacistRationale(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
                <span className="text-[11px] text-slate-400 block mt-1">
                  شرط قاعدة البيانات: ألا يقل المبرر عن 10 أحرف ويوضح تطابق المادة الفعالة والشكل الصيدلي.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setProposeModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  إرسال المقترح للمريض
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM AVAILABILITY MODAL */}
      {confirmModalOpen && confirmingRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-200 text-right">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <button
                onClick={() => setConfirmModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 text-sm font-semibold rounded-md cursor-pointer"
              >
                إغلاق ✕
              </button>
              <h3 className="font-semibold text-slate-900 text-base">تأكيد توفر الأصناف وتحديد رسوم التوصيل</h3>
            </div>

            <form onSubmit={handleConfirmAvailabilitySubmit} className="mt-4 space-y-4">
              <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1">
                <p className="font-bold text-slate-900">طلب المريض: {confirmingRequest.customerName}</p>
                <p className="text-slate-500">عنوان التوصيل: {confirmingRequest.deliveryAddress.district}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  تأكيد سعر العبوة الجبري (EGP)
                </label>
                <input
                  type="number"
                  step="0.5"
                  disabled
                  value={56.5}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg bg-slate-100 font-bold"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  مقيد بالسعر الجبري الرسمي لهيئة الدواء المصرية (EDA Cap: 56.50 ج.م).
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  رسوم التوصيل المحددة بواسطة الصيدلية (EGP)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  required
                  value={confirmedDeliveryFee}
                  onChange={(e) => setConfirmedDeliveryFee(Number(e.target.value))}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  اعتماد التوفر وإشعار المريض
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ASSIGN COURIER MODAL */}
      {assignCourierModalOpen && selectedOrderForCourier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-200 text-right">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <button
                onClick={() => setAssignCourierModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 text-sm font-semibold rounded-md cursor-pointer"
              >
                إغلاق ✕
              </button>
              <h3 className="font-semibold text-slate-900 text-base">إسناد الطلب المختوم إلى مندوب معتمد</h3>
            </div>

            <form onSubmit={handleAssignCourier} className="mt-4 space-y-4">
              <div className="p-3 bg-slate-50 rounded-lg text-xs">
                <p className="font-bold text-slate-900">رقم الطلب: {selectedOrderForCourier.orderNumber}</p>
                <p className="text-slate-500">حالة ختم الأمان: موثق ومطابق</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  اختر من المناديب المعتمدين والمتاحين في نطاق {pharmacy.district}
                </label>
                <select
                  value={selectedCourierId}
                  onChange={(e) => setSelectedCourierId(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg bg-white"
                >
                  {couriers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName} — {c.vehicleType === 'motorcycle' ? 'دراجة نارية' : 'سيارة'} ({c.currentZone})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAssignCourierModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  تأكيد الإسناد وإشعار المندوب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
