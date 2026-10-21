import React, { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Search,
  PlusCircle,
  FileText,
  Clock,
  CheckCircle,
  AlertCircle,
  MapPin,
  Check,
  X,
  Package,
  ShieldCheck,
  ChevronLeft,
  Info,
  Pill,
  Upload,
  Eye,
  EyeOff,
  Trash2,
  Filter,
  Phone,
  Building2,
  ArrowRight,
} from 'lucide-react';
import {
  FIXTURE_CATALOG,
  FIXTURE_REQUESTS,
  FIXTURE_ORDERS,
  FIXTURE_ADDRESSES,
} from '../../data/developmentFixtures';
import { MedicineCatalogItem, MedicineRequest, Order, CustomerAddress } from '../../types';
import { PrototypeNoticeBanner } from '../common/PrototypeNoticeBanner';

export const CustomerPortal: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // Determine active tab from URL or fallback
  const getInitialTab = (): 'discovery' | 'requests' | 'orders' | 'addresses' => {
    if (location.pathname.includes('/requests')) return 'requests';
    if (location.pathname.includes('/orders')) return 'orders';
    if (location.pathname.includes('/addresses')) return 'addresses';
    return 'discovery';
  };

  const [activeTab, setActiveTab] = useState<'discovery' | 'requests' | 'orders' | 'addresses'>(getInitialTab());

  const handleTabChange = (tab: 'discovery' | 'requests' | 'orders' | 'addresses') => {
    setActiveTab(tab);
    if (tab === 'discovery') navigate('/customer');
    else navigate(`/customer/${tab}`);
  };

  // Medicine search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [prescriptionFilter, setPrescriptionFilter] = useState<'all' | 'otc' | 'rx'>('all');
  const [sortBy, setSortBy] = useState<'default' | 'price_asc' | 'price_desc' | 'name'>('default');

  // Interactive client state
  const [requests, setRequests] = useState<MedicineRequest[]>(FIXTURE_REQUESTS);
  const [orders, setOrders] = useState<Order[]>(FIXTURE_ORDERS);
  const [addresses, setAddresses] = useState<CustomerAddress[]>(FIXTURE_ADDRESSES);

  // Modals state
  const [newRequestModalOpen, setNewRequestModalOpen] = useState(false);
  const [selectedMedicineForRequest, setSelectedMedicineForRequest] = useState<MedicineCatalogItem | null>(null);
  const [requestQuantity, setRequestQuantity] = useState<number>(1);
  const [requestNotes, setRequestNotes] = useState('');
  const [selectedAddressId, setSelectedAddressId] = useState<string>(addresses[0]?.id || 'addr-cairo-01');
  const [simulatedPrescriptionFile, setSimulatedPrescriptionFile] = useState<string | null>(null);
  const [requestSuccessMessage, setRequestSuccessMessage] = useState<string | null>(null);

  // Medicine detail modal
  const [inspectMedicine, setInspectMedicine] = useState<MedicineCatalogItem | null>(null);

  // New address modal
  const [newAddressModalOpen, setNewAddressModalOpen] = useState(false);
  const [addressLabel, setAddressLabel] = useState('');
  const [addressGovernorate, setAddressGovernorate] = useState('القاهرة');
  const [addressDistrict, setAddressDistrict] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressBuilding, setAddressBuilding] = useState('');
  const [addressFloor, setAddressFloor] = useState('');
  const [addressApartment, setAddressApartment] = useState('');
  const [addressLandmark, setAddressLandmark] = useState('');

  // Show/Hide OTP in orders
  const [showOtpOrderId, setShowOtpOrderId] = useState<string | null>(null);

  const categories = ['all', 'أدوية القلب والضغط', 'مسكنات وخافض للحرارة', 'مضادات حيوية'];

  // Filtered and sorted catalog
  const filteredCatalog = useMemo(() => {
    let result = FIXTURE_CATALOG.filter((item) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        q === '' ||
        item.brandNameAr.toLowerCase().includes(q) ||
        item.brandNameEn.toLowerCase().includes(q) ||
        item.activeIngredient.toLowerCase().includes(q) ||
        item.manufacturer.toLowerCase().includes(q);

      const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;

      const matchesPrescription =
        prescriptionFilter === 'all' ||
        (prescriptionFilter === 'rx' && item.requiresPrescription) ||
        (prescriptionFilter === 'otc' && !item.requiresPrescription);

      return matchesSearch && matchesCategory && matchesPrescription;
    });

    if (sortBy === 'price_asc') {
      result = [...result].sort((a, b) => (a.maxRegulatedPriceEgp ?? Infinity) - (b.maxRegulatedPriceEgp ?? Infinity));
    } else if (sortBy === 'price_desc') {
      result = [...result].sort((a, b) => (b.maxRegulatedPriceEgp ?? -Infinity) - (a.maxRegulatedPriceEgp ?? -Infinity));
    } else if (sortBy === 'name') {
      result = [...result].sort((a, b) => a.brandNameAr.localeCompare(b.brandNameAr, 'ar'));
    }

    return result;
  }, [searchQuery, selectedCategory, prescriptionFilter, sortBy]);

  const handleAcceptAlternative = (requestId: string) => {
    setRequests((prev) =>
      prev.map((r) => {
        if (r.id === requestId && r.proposedAlternative) {
          return {
            ...r,
            status: 'availability_confirmed',
            proposedAlternative: {
              ...r.proposedAlternative,
              approvalStatus: 'accepted',
              respondedAt: new Date().toISOString(),
            },
          };
        }
        return r;
      })
    );
    setRequestSuccessMessage('تم اعتماد البديل الدوائي بنجاح. ستبدأ الصيدلية في تجهيز طلبك فوراً وفق التسعيرة المعتمدة.');
    setTimeout(() => setRequestSuccessMessage(null), 5000);
  };

  const handleDeclineAlternative = (requestId: string) => {
    setRequests((prev) =>
      prev.map((r) => {
        if (r.id === requestId && r.proposedAlternative) {
          return {
            ...r,
            status: 'cancelled',
            proposedAlternative: {
              ...r.proposedAlternative,
              approvalStatus: 'declined',
              respondedAt: new Date().toISOString(),
            },
          };
        }
        return r;
      })
    );
    setRequestSuccessMessage('تم إلغاء الطلب بناءً على رفض البديل المقترح. لم يتم سحب أو حجز أي مبالغ.');
    setTimeout(() => setRequestSuccessMessage(null), 5000);
  };

  const handleCreateRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMedicineForRequest) return;

    const chosenAddress = addresses.find((a) => a.id === selectedAddressId) || addresses[0] || FIXTURE_ADDRESSES[0];

    const newReq: MedicineRequest = {
      id: `req-${Date.now().toString().slice(-6)}`,
      customerId: 'cust-demo-1',
      customerName: 'طارق عبد السلام',
      customerPhone: '+20 12 2841 9022',
      deliveryAddress: chosenAddress,
      status: 'submitted',
      assignedPharmacyName: 'جاري التوجيه لأقرب صيدلية مرخصة بالمنطقة',
      items: [
        {
          id: `item-${Date.now()}`,
          requestId: `req-${Date.now().toString().slice(-6)}`,
          medicineCatalogId: selectedMedicineForRequest.id,
          rawMedicineName: `${selectedMedicineForRequest.brandNameAr} (${selectedMedicineForRequest.brandNameEn})`,
          requestedQuantity: requestQuantity,
          customerNotes: requestNotes,
          prescriptionAttachmentUrl: simulatedPrescriptionFile || undefined,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setRequests([newReq, ...requests]);
    setNewRequestModalOpen(false);
    setSelectedMedicineForRequest(null);
    setRequestNotes('');
    setRequestQuantity(1);
    setSimulatedPrescriptionFile(null);
    handleTabChange('requests');
    setRequestSuccessMessage('تم إرسال طلب الدواء بنجاح للصيدلية للمراجعة والتسعير الرسمي.');
    setTimeout(() => setRequestSuccessMessage(null), 6000);
  };

  const handleSaveAddress = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressLabel || !addressDistrict || !addressStreet) return;

    const newAddr: CustomerAddress = {
      id: `addr-${Date.now()}`,
      customerId: 'cust-demo-1',
      label: addressLabel,
      governorate: addressGovernorate,
      district: addressDistrict,
      street: addressStreet,
      building: addressBuilding || 'عمارة 1',
      floor: addressFloor,
      apartment: addressApartment,
      landmark: addressLandmark,
      isDefault: addresses.length === 0,
    };

    setAddresses([...addresses, newAddr]);
    setNewAddressModalOpen(false);
    setAddressLabel('');
    setAddressDistrict('');
    setAddressStreet('');
    setAddressBuilding('');
    setAddressFloor('');
    setAddressApartment('');
    setAddressLandmark('');
    setRequestSuccessMessage('تمت إضافة عنوان التوصيل بنجاح.');
    setTimeout(() => setRequestSuccessMessage(null), 4000);
  };

  const handleDeleteAddress = (id: string) => {
    if (addresses.length <= 1) {
      alert('يجب الإبقاء على عنوان توصيل واحد على الأقل.');
      return;
    }
    setAddresses(addresses.filter((a) => a.id !== id));
  };

  const handleSetDefaultAddress = (id: string) => {
    setAddresses(
      addresses.map((a) => ({
        ...a,
        isDefault: a.id === id,
      }))
    );
  };

  return (
    <div className="space-y-6">
      {/* Reusable Prototype State Notice */}
      <PrototypeNoticeBanner portalName="بوابة المرضى وطلب الأدوية" />

      {/* Top Banner / Portal Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">بوابة المرضى — منصة علاجك</h1>
              <span className="text-xs text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-medium">
                بيئة مريض معتمدة
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              استكشف الأدوية المعتمدة بالتسعيرة الجبرية الرسمية (EDA)، قدّم طلباتك للصيدليات المرخصة، وراجع البدائل الدوائية المكافئة بشفافية كاملة.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setSelectedMedicineForRequest(FIXTURE_CATALOG[0]);
                setRequestQuantity(1);
                setNewRequestModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer shadow-xs whitespace-nowrap"
            >
              <PlusCircle className="w-4 h-4" />
              <span>طلب دواء جديد</span>
            </button>
          </div>
        </div>

        {/* Tab Switcher / Sub-navigation */}
        <div className="flex items-center gap-2 border-t border-slate-100 mt-5 pt-4 overflow-x-auto">
          <button
            onClick={() => handleTabChange('discovery')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'discovery'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            دليل الأدوية والتسعيرة الرسمية
          </button>
          <button
            onClick={() => handleTabChange('requests')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'requests'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>طلباتي ومراجعة البدائل</span>
            <span className="text-[11px] tabular-nums font-mono px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded">
              {requests.length}
            </span>
          </button>
          <button
            onClick={() => handleTabChange('orders')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'orders'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>الطلبات والتتبع الميداني</span>
            <span className="text-[11px] tabular-nums font-mono px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded">
              {orders.length}
            </span>
          </button>
          <button
            onClick={() => handleTabChange('addresses')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'addresses'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            عناوين التوصيل ({addresses.length})
          </button>
        </div>
      </div>

      {/* Notification Toast */}
      {requestSuccessMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <p className="font-medium">{requestSuccessMessage}</p>
        </div>
      )}

      {/* VIEW 1: MEDICINE DISCOVERY */}
      {activeTab === 'discovery' && (
        <div className="space-y-4">
          {/* Search, Category, Rx Filter, and Sorting Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
                <input
                  type="text"
                  placeholder="ابحث بالاسم التجاري (مثال: Concor أو كونكور)، المادة الفعالة (Bisoprolol)، أو الشركة..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-3 pr-9 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200 text-xs">
                  <span className="text-slate-400 px-2">الروشتة:</span>
                  <button
                    onClick={() => setPrescriptionFilter('all')}
                    className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                      prescriptionFilter === 'all'
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    الكل
                  </button>
                  <button
                    onClick={() => setPrescriptionFilter('otc')}
                    className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                      prescriptionFilter === 'otc'
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    بدون روشتة (OTC)
                  </button>
                  <button
                    onClick={() => setPrescriptionFilter('rx')}
                    className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                      prescriptionFilter === 'rx'
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    يلزم روشتة (Rx)
                  </button>
                </div>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="text-xs p-2 border border-slate-200 rounded-lg bg-white text-slate-700"
                >
                  <option value="default">الترتيب الافتراضي</option>
                  <option value="price_asc">السعر: من الأقل للأعلى</option>
                  <option value="price_desc">السعر: من الأعلى للأقل</option>
                  <option value="name">الاسم الأبجدي</option>
                </select>
              </div>
            </div>

            {/* Category Segmented Buttons */}
            <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-slate-100">
              <span className="text-xs text-slate-400 ml-1">الفئة:</span>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 text-xs rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-emerald-50 text-emerald-800 font-semibold border border-emerald-200'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {cat === 'all' ? 'جميع الفئات الدوائية' : cat}
                </button>
              ))}
              {(searchQuery || selectedCategory !== 'all' || prescriptionFilter !== 'all' || sortBy !== 'default') && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedCategory('all');
                    setPrescriptionFilter('all');
                    setSortBy('default');
                  }}
                  className="text-xs text-rose-600 hover:text-rose-700 mr-auto px-2 py-1 cursor-pointer"
                >
                  إعادة تعيين الفلاتر
                </button>
              )}
            </div>
          </div>

          {/* Catalog Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCatalog.map((med) => (
              <div
                key={med.id}
                className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs hover:border-slate-300 transition-colors flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm leading-snug">{med.brandNameAr}</h3>
                      <p className="text-xs text-slate-500 font-medium">{med.brandNameEn}</p>
                    </div>
                    <span className="text-[11px] text-slate-500 font-medium shrink-0">
                      {med.requiresPrescription ? 'يلزم روشتة' : 'بدون روشتة'}
                    </span>
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-slate-600">
                    <p>
                      <span className="text-slate-400">المادة الفعالة:</span> {med.activeIngredient}
                    </p>
                    <p>
                      <span className="text-slate-400">الشكل والتركيز:</span> {med.dosageForm} · {med.strength}
                    </p>
                    <p>
                      <span className="text-slate-400">الشركة المصنعة:</span> {med.manufacturer}
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-slate-400 block">التسعيرة الجبرية (EDA)</span>
                    <span className="text-base font-bold text-slate-900 tabular-nums">
                      {med.maxRegulatedPriceEgp != null ? (
                        <>
                          {med.maxRegulatedPriceEgp.toFixed(2)}{' '}
                          <span className="text-xs font-normal text-slate-500">ج.م</span>
                        </>
                      ) : (
                        <span className="text-xs font-normal text-slate-400">غير مسجل</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setInspectMedicine(med)}
                      className="px-2.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                    >
                      التفاصيل
                    </button>
                    <button
                      onClick={() => {
                        setSelectedMedicineForRequest(med);
                        setRequestQuantity(1);
                        setNewRequestModalOpen(true);
                      }}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
                    >
                      طلب الصنف
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredCatalog.length === 0 && (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200 p-6">
              <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">لم يتم العثور على أدوية مطابقة للبحث أو الفلتر المحدد</p>
              <p className="text-xs text-slate-500 mt-1">تأكد من كتابة الاسم بصورة صحيحة أو أعد تعيين الفلاتر للرجوع للدليل الكامل.</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                  setPrescriptionFilter('all');
                  setSortBy('default');
                }}
                className="mt-3 px-3 py-1.5 bg-slate-100 text-slate-700 text-xs rounded-md hover:bg-slate-200 cursor-pointer"
              >
                إلغاء الفلاتر وعرض الكل
              </button>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: REQUESTS & ALTERNATIVE APPROVALS */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          <div className="bg-slate-100/70 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              ميثاق حماية المريض: أي اقتراح لبديل دوائي مكافئ يخضع لموافقتك الصريحة بعد مراجعة الصيدلي المرخص وتقديم المبرر الصيدلاني المعتمد.
            </span>
          </div>

          {requests.map((req) => (
            <div
              key={req.id}
              className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-800">{req.id}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-xs font-semibold text-slate-700">
                    {req.assignedPharmacyName || 'صيدلية قيد المراجعة'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      req.status === 'submitted'
                        ? 'bg-slate-100 text-slate-700'
                        : req.status === 'under_pharmacy_review'
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : req.status === 'alternative_proposed'
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : req.status === 'availability_confirmed'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : req.status === 'converted_to_order'
                        ? 'bg-emerald-100 text-emerald-900 font-bold'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}
                  >
                    {req.status === 'submitted'
                      ? 'تم التقديم'
                      : req.status === 'under_pharmacy_review'
                      ? 'قيد فحص الأرفف بالصيدلية'
                      : req.status === 'alternative_proposed'
                      ? 'بانتظار موافقتك على البديل'
                      : req.status === 'availability_confirmed'
                      ? 'تم تأكيد التوفر'
                      : req.status === 'converted_to_order'
                      ? 'تحول إلى طلب توصيل'
                      : 'ملغي'}
                  </span>
                  <div className="flex items-center gap-1 text-slate-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {new Date(req.createdAt).toLocaleDateString('ar-EG', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Items in Request */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700">الأصناف المطلوبة:</p>
                {req.items.map((item) => (
                  <div key={item.id} className="p-3 bg-slate-50 rounded-lg text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">{item.rawMedicineName}</p>
                      <p className="text-slate-500 mt-0.5">الكمية: {item.requestedQuantity} عبوة</p>
                      {item.customerNotes && (
                        <p className="text-slate-500 mt-1 italic">ملاحظة: {item.customerNotes}</p>
                      )}
                      {item.prescriptionAttachmentUrl && (
                        <p className="text-emerald-700 text-[11px] font-medium mt-1 flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5" />
                          <span>تم إرفاق صورة الروشتة الطبية ({item.prescriptionAttachmentUrl})</span>
                        </p>
                      )}
                    </div>
                    <div className="text-left">
                      <span className="text-[11px] text-slate-400 block">السعر المؤكد</span>
                      {item.confirmedUnitPriceEgp ? (
                        <span className="font-bold text-slate-900 tabular-nums">
                          {(item.confirmedUnitPriceEgp * item.requestedQuantity).toFixed(2)} ج.م
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">بانتظار تأكيد الصيدلية</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Interactive Alternative Proposal Banner */}
              {req.proposedAlternative && (
                <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      <span>اقتراح بديل مكافئ بيولوجياً من الصيدلي المرخص</span>
                    </div>
                    <span className="text-[11px] font-semibold text-amber-800 bg-amber-100/60 px-2 py-0.5 rounded">
                      {req.proposedAlternative.approvalStatus === 'pending_customer'
                        ? 'بانتظار قرارك'
                        : req.proposedAlternative.approvalStatus === 'accepted'
                        ? 'تمت الموافقة'
                        : 'تم الرفض'}
                    </span>
                  </div>

                  <p className="text-xs text-amber-950 leading-relaxed">
                    <span className="font-semibold">المبرر الصيدلاني المعتمد:</span>{' '}
                    {req.proposedAlternative.pharmacistRationaleAr}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-white p-3 rounded-lg border border-amber-100">
                    <div>
                      <span className="text-slate-400 block text-[11px]">الصنف الأصلي غير المتوفر</span>
                      <span className="font-medium text-slate-700 line-through">
                        {req.proposedAlternative.originalName} ({req.proposedAlternative.originalPriceEgp.toFixed(2)} ج.م)
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-emerald-700 font-semibold block text-[11px]">
                          البديل المقترح بنفس المادة الفعالة
                        </span>
                        {req.proposedAlternative.originalPriceEgp > req.proposedAlternative.proposedPriceEgp && (
                          <span className="text-[11px] text-emerald-800 font-bold">
                            توفير: {(req.proposedAlternative.originalPriceEgp - req.proposedAlternative.proposedPriceEgp).toFixed(2)} ج.م
                          </span>
                        )}
                      </div>
                      <span className="font-bold text-slate-900">
                        {req.proposedAlternative.proposedName} ({req.proposedAlternative.proposedPriceEgp.toFixed(2)} ج.م)
                      </span>
                    </div>
                  </div>

                  {req.proposedAlternative.approvalStatus === 'pending_customer' && (
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        onClick={() => handleDeclineAlternative(req.id)}
                        className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-rose-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>رفض البديل وإلغاء الطلب</span>
                      </button>
                      <button
                        onClick={() => handleAcceptAlternative(req.id)}
                        className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>موافق على صرف البديل المعتمد</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {requests.length === 0 && (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200 p-6">
              <Package className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">لا توجد طلبات أدوية مسجلة حتى الآن</p>
              <p className="text-xs text-slate-500 mt-1">تصفح دليل الأدوية وقدّم أول طلب دواء للصيدليات المرخصة في منطقتك.</p>
              <button
                onClick={() => handleTabChange('discovery')}
                className="mt-3 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                تصفح دليل الأدوية
              </button>
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: ORDERS */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          {orders.map((ord) => {
            const isDelivered = ord.status === 'delivered';
            const isInTransit = ord.status === 'in_transit';

            return (
              <div key={ord.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div>
                    <span className="font-bold text-slate-900 text-sm font-mono">{ord.orderNumber}</span>
                    <span className="text-slate-400 text-xs mr-2">صيدلية: {ord.pharmacyName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                      {ord.status === 'confirmed'
                        ? 'تم التأكيد'
                        : ord.status === 'in_preparation'
                        ? 'قيد التجهيز بالصيدلية'
                        : ord.status === 'ready_for_pickup'
                        ? 'مختوم وجاهز للاستلام'
                        : ord.status === 'in_transit'
                        ? 'مع المندوب في الطريق'
                        : 'تم التسليم بنجاح'}
                    </span>
                  </div>
                </div>

                {/* Visual Progress Stepper */}
                <div className="bg-slate-50 p-4 rounded-xl">
                  <div className="grid grid-cols-5 text-center text-[11px] font-medium gap-1">
                    <div className="text-emerald-700">
                      <div className="w-5 h-5 mx-auto mb-1 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">
                        ✓
                      </div>
                      <span>تأكيد الصيدلية</span>
                    </div>
                    <div className="text-emerald-700">
                      <div className="w-5 h-5 mx-auto mb-1 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">
                        ✓
                      </div>
                      <span>التجهيز الصيدلاني</span>
                    </div>
                    <div className="text-emerald-700">
                      <div className="w-5 h-5 mx-auto mb-1 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">
                        ✓
                      </div>
                      <span>ختم الأمان</span>
                    </div>
                    <div className={isInTransit || isDelivered ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                      <div
                        className={`w-5 h-5 mx-auto mb-1 rounded-full flex items-center justify-center text-[10px] ${
                          isInTransit || isDelivered ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        4
                      </div>
                      <span>في الطريق</span>
                    </div>
                    <div className={isDelivered ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                      <div
                        className={`w-5 h-5 mx-auto mb-1 rounded-full flex items-center justify-center text-[10px] ${
                          isDelivered ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        5
                      </div>
                      <span>تم التسليم</span>
                    </div>
                  </div>
                </div>

                {/* Items in Order */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700">محتويات الطرد الدوائي:</p>
                  {ord.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-xs py-1">
                      <span className="text-slate-700">
                        {item.name} × {item.quantity}
                      </span>
                      <span className="font-bold text-slate-900 tabular-nums">
                        {item.totalPriceEgp.toFixed(2)} ج.م
                      </span>
                    </div>
                  ))}
                </div>

                {/* Price Breakdown */}
                <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="space-y-1 text-slate-500">
                    <p>المجموع الفرعي للأدوية: {ord.subtotalEgp.toFixed(2)} ج.م</p>
                    <p>رسوم التوصيل المعتمدة: {ord.deliveryFeeEgp.toFixed(2)} ج.م</p>
                    <p>عنوان التسليم: {ord.deliveryAddress.district} — {ord.deliveryAddress.street}</p>
                    {ord.courierName && (
                      <p className="text-slate-700 font-medium">
                        المندوب المعين: {ord.courierName} ({ord.courierPhone})
                      </p>
                    )}
                  </div>
                  <div className="text-left">
                    <span className="text-slate-400 text-[11px] block">الإجمالي النهائي المسدد</span>
                    <span className="text-lg font-bold text-slate-900 tabular-nums">
                      {ord.totalEgp.toFixed(2)} ج.م
                    </span>
                  </div>
                </div>

                {/* Secure Delivery OTP Notice */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start sm:items-center gap-2 text-slate-700">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
                    <div>
                      <p className="font-semibold text-slate-900">كود استلام الطلب الآمن (Secure OTP):</p>
                      <p className="text-slate-500 text-[11px]">
                        لا تشارك هذا الرمز إلا بعد فحص شريط الأمان الشمعي واستلام الطرد الدوائي يداً بيد.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono font-bold text-slate-900 text-sm tracking-widest bg-white px-3 py-1 rounded border border-slate-200">
                      {showOtpOrderId === ord.id ? '849201' : '••••••'}
                    </span>
                    <button
                      onClick={() => setShowOtpOrderId(showOtpOrderId === ord.id ? null : ord.id)}
                      className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
                      title={showOtpOrderId === ord.id ? 'إخفاء الرمز' : 'إظهار الرمز'}
                    >
                      {showOtpOrderId === ord.id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 4: ADDRESSES */}
      {activeTab === 'addresses' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-slate-900">عناوين التوصيل المسجلة</h2>
              <p className="text-xs text-slate-500">العناوين التي يتم توجيه الصيدليات والمناديب المعتمدين إليها لتوصيل الأدوية.</p>
            </div>
            <button
              onClick={() => setNewAddressModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>إضافة عنوان جديد</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {addresses.map((addr) => (
              <div key={addr.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-emerald-600" />
                    <span className="font-bold text-slate-900 text-sm">{addr.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {addr.isDefault ? (
                      <span className="text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded font-medium">
                        العنوان الافتراضي
                      </span>
                    ) : (
                      <button
                        onClick={() => handleSetDefaultAddress(addr.id)}
                        className="text-[11px] text-slate-500 hover:text-slate-800 underline cursor-pointer"
                      >
                        تعيين كافتراضي
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteAddress(addr.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                      title="حذف العنوان"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {addr.governorate} — {addr.district} — {addr.street}، {addr.building} ({addr.floor}، {addr.apartment})
                </p>
                {addr.landmark && (
                  <p className="text-[11px] text-slate-500">علامة مميزة: {addr.landmark}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MEDICINE INSPECTION MODAL */}
      {inspectMedicine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-200 text-right">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <button
                onClick={() => setInspectMedicine(null)}
                className="text-slate-400 hover:text-slate-600 p-1 text-sm font-semibold rounded-md cursor-pointer"
              >
                إغلاق ✕
              </button>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900 text-base">{inspectMedicine.brandNameAr}</h3>
                <Pill className="w-4 h-4 text-emerald-700" />
              </div>
            </div>

            <div className="mt-4 space-y-3 text-xs text-slate-600">
              <div className="p-3 bg-slate-50 rounded-lg space-y-1">
                <p><span className="text-slate-400">الاسم التجاري:</span> <strong className="text-slate-900">{inspectMedicine.brandNameEn}</strong></p>
                <p><span className="text-slate-400">المادة الفعالة:</span> <strong className="text-slate-900">{inspectMedicine.activeIngredient}</strong></p>
                <p><span className="text-slate-400">الشكل الصيدلي:</span> {inspectMedicine.dosageForm} ({inspectMedicine.strength})</p>
                <p><span className="text-slate-400">حجم العبوة:</span> {inspectMedicine.packSize}</p>
                <p><span className="text-slate-400">الشركة المصنعة:</span> {inspectMedicine.manufacturer}</p>
                <p><span className="text-slate-400">نوع الصرف:</span> {inspectMedicine.requiresPrescription ? 'يلزم روشتة طبية (Rx)' : 'صرف مباشر (OTC)'}</p>
              </div>

              <div className="p-3 bg-emerald-50 text-emerald-950 rounded-lg space-y-1 border border-emerald-200">
                <p className="font-semibold">التسعيرة الجبرية الرسمية (هيئة الدواء المصرية EDA):</p>
                <p className="text-base font-bold text-emerald-900 tabular-nums">
                  {inspectMedicine.maxRegulatedPriceEgp != null
                    ? `${inspectMedicine.maxRegulatedPriceEgp.toFixed(2)} ج.م`
                    : 'غير مسجل (تحدده الصيدلية)'}
                </p>
                <p className="text-[11px] text-emerald-800">يحظر قانوناً على الصيدليات بيع هذا الصنف بسعر أعلى من التسعيرة الجبرية المحددة.</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg text-[11px] text-slate-500 space-y-1">
                <p className="font-semibold text-slate-800">ملاحظة البدائل المكافئة بيولوجياً (Bioequivalent Generics):</p>
                <p>في حال عدم توفر هذا الصنف بالصيدلية، يمكن للصيدلي المرخص اقتراح بديل مصري مسجل يحتوي على نفس المادة الفعالة والشكل الصيدلي بتكلفة مناسبة، شريطة موافقتك الصريحة.</p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setInspectMedicine(null)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 cursor-pointer"
              >
                إغلاق
              </button>
              <button
                onClick={() => {
                  setSelectedMedicineForRequest(inspectMedicine);
                  setRequestQuantity(1);
                  setInspectMedicine(null);
                  setNewRequestModalOpen(true);
                }}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                طلب هذا الصنف الآن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW REQUEST MODAL */}
      {newRequestModalOpen && selectedMedicineForRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-200 text-right">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <button
                onClick={() => setNewRequestModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 text-sm font-semibold rounded-md cursor-pointer"
              >
                إغلاق ✕
              </button>
              <h3 className="font-semibold text-slate-900 text-base">تقديم طلب دواء للصيدليات المرخصة</h3>
            </div>

            <form onSubmit={handleCreateRequest} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">الدواء المختار من الدليل</label>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                  <p className="font-bold text-slate-900">{selectedMedicineForRequest.brandNameAr}</p>
                  <p className="text-slate-500">{selectedMedicineForRequest.brandNameEn} · {selectedMedicineForRequest.activeIngredient}</p>
                  <p className="text-emerald-700 font-semibold mt-1 tabular-nums">
                    {selectedMedicineForRequest.maxRegulatedPriceEgp != null
                      ? `السعر الرسمي المحدد: ${selectedMedicineForRequest.maxRegulatedPriceEgp.toFixed(2)} ج.م للعبوة`
                      : 'السعر الرسمي: غير مسجل (تحدده الصيدلية لاحقاً)'}
                  </p>
                </div>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">عدد العبوات المطلوبة</label>
                <div className="flex items-center gap-3">
                  <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setRequestQuantity(Math.max(1, requestQuantity - 1))}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                    >
                      -
                    </button>
                    <span className="px-4 py-1.5 text-xs font-bold font-mono tabular-nums">{requestQuantity}</span>
                    <button
                      type="button"
                      onClick={() => setRequestQuantity(Math.min(10, requestQuantity + 1))}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {selectedMedicineForRequest.maxRegulatedPriceEgp != null
                      ? `الإجمالي التقديري: ${(selectedMedicineForRequest.maxRegulatedPriceEgp * requestQuantity).toFixed(2)} ج.م`
                      : 'الإجمالي التقديري: يحدد بعد مراجعة الصيدلية'}
                  </span>
                </div>
              </div>

              {/* Prescription Attachment Simulation */}
              {selectedMedicineForRequest.requiresPrescription && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs space-y-2">
                  <div className="flex items-center gap-1.5 text-amber-900 font-semibold">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    <span>مطلوب روشتة طبية سارية لهذا الصنف</span>
                  </div>
                  <p className="text-[11px] text-amber-800">
                    يلزم رفع صورة الروشتة الطبية الصادرة من الطبيب المعالج للتحقق الصيدلاني.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSimulatedPrescriptionFile('prescription_rx_2026.pdf')}
                      className="px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 rounded-md text-xs font-medium flex items-center gap-1 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{simulatedPrescriptionFile ? 'تم إرفاق الروشتة بنجاح' : 'إرفاق صورة الروشتة (محاكاة)'}</span>
                    </button>
                    {simulatedPrescriptionFile && (
                      <span className="text-[11px] text-emerald-700 font-semibold">✓ مرفق: prescription_rx_2026.pdf</span>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">عنوان التوصيل المعتمد</label>
                <select
                  value={selectedAddressId}
                  onChange={(e) => setSelectedAddressId(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg bg-white"
                >
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} — {a.district} ({a.street})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ملاحظات للمريض أو تعليمات الاستخدام (اختياري)
                </label>
                <textarea
                  rows={2}
                  value={requestNotes}
                  onChange={(e) => setRequestNotes(e.target.value)}
                  placeholder="مثال: يرجى التحقق من توفر الصنف أو اقتراح بديل مكافئ بنفس الفاعلية..."
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              <div className="p-3 bg-slate-50 rounded-lg text-[11px] text-slate-500 leading-normal">
                ملاحظة رقابية: ستقوم الصيدلية بمراجعة الوصفة والتحقق الفعلي من توفر العبوات على الأرفف وتأكيد السعر النهائي قبل خصم أي مستحقات.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewRequestModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                >
                  إرسال الطلب للصيدلية
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NEW ADDRESS MODAL */}
      {newAddressModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-200 text-right">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <button
                onClick={() => setNewAddressModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 text-sm font-semibold rounded-md cursor-pointer"
              >
                إغلاق ✕
              </button>
              <h3 className="font-semibold text-slate-900 text-base">إضافة عنوان توصيل جديد</h3>
            </div>

            <form onSubmit={handleSaveAddress} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">اسم العنوان (مثال: المنزل، العمل، منزل الوالد)</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: المنزل"
                  value={addressLabel}
                  onChange={(e) => setAddressLabel(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">المحافظة</label>
                  <select
                    value={addressGovernorate}
                    onChange={(e) => setAddressGovernorate(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="القاهرة">القاهرة</option>
                    <option value="الجيزة">الجيزة</option>
                    <option value="الإسكندرية">الإسكندرية</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">الحي / المنطقة</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: المعادي، الدقي، مدينة نصر"
                    value={addressDistrict}
                    onChange={(e) => setAddressDistrict(e.target.value)}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">اسم الشارع</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: شارع النصر"
                  value={addressStreet}
                  onChange={(e) => setAddressStreet(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">رقم المبنى</label>
                  <input
                    type="text"
                    placeholder="عمارة 12"
                    value={addressBuilding}
                    onChange={(e) => setAddressBuilding(e.target.value)}
                    className="w-full text-xs p-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">الدور</label>
                  <input
                    type="text"
                    placeholder="الدور 3"
                    value={addressFloor}
                    onChange={(e) => setAddressFloor(e.target.value)}
                    className="w-full text-xs p-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">رقم الشقة</label>
                  <input
                    type="text"
                    placeholder="شقة 8"
                    value={addressApartment}
                    onChange={(e) => setAddressApartment(e.target.value)}
                    className="w-full text-xs p-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">علامة مميزة (اختياري)</label>
                <input
                  type="text"
                  placeholder="بجوار مسجد أو بنك..."
                  value={addressLandmark}
                  onChange={(e) => setAddressLandmark(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setNewAddressModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  حفظ العنوان
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
