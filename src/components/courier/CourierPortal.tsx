import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bike,
  MapPin,
  CheckCircle,
  AlertTriangle,
  Phone,
  ShieldCheck,
  Check,
  PackageCheck,
  Navigation,
  Clock,
  AlertCircle,
  Truck,
  RotateCcw,
  Shield,
  FileText,
  BadgeAlert,
  ArrowRight,
} from 'lucide-react';
import { FIXTURE_COURIERS, FIXTURE_ORDERS } from '../../data/developmentFixtures';
import { Order } from '../../types';
import { PrototypeNoticeBanner } from '../common/PrototypeNoticeBanner';

export const CourierPortal: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const getInitialTab = (): 'active' | 'pickups' | 'shift' | 'history' => {
    if (location.pathname.includes('/pickups')) return 'pickups';
    if (location.pathname.includes('/shift')) return 'shift';
    if (location.pathname.includes('/history')) return 'history';
    return 'active';
  };

  const [activeTab, setActiveTab] = useState<'active' | 'pickups' | 'shift' | 'history'>(getInitialTab());

  const handleTabChange = (tab: 'active' | 'pickups' | 'shift' | 'history') => {
    setActiveTab(tab);
    if (tab === 'active') navigate('/courier');
    else navigate(`/courier/${tab}`);
  };

  const courier = FIXTURE_COURIERS[0]; // Ahmed Mahmoud Radwan
  const [shiftStatus, setShiftStatus] = useState<'available' | 'offline'>(courier.shiftStatus as 'available' | 'offline');
  const [orders, setOrders] = useState<Order[]>(FIXTURE_ORDERS);

  // Proof of delivery modal state
  const [podModalOpen, setPodModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [customerOtp, setCustomerOtp] = useState('');
  const [exceptionReason, setExceptionReason] = useState<string>('none');
  const [courierNotice, setCourierNotice] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);

  // Pickup confirmation from pharmacy
  const handleConfirmPickup = (orderId: string) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: 'in_transit' } : o))
    );
    setCourierNotice('تم فحص ختم الأمان واستلام الطرد من الصيدلية بنجاح، وتحويل حالة الطلب إلى "جاري التوصيل".');
    handleTabChange('active');
    setTimeout(() => setCourierNotice(null), 5000);
  };

  // Delivery completion via OTP or reporting exception
  const handleCompleteDelivery = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;

    if (exceptionReason !== 'none') {
      setOrders((prev) =>
        prev.map((o) => (o.id === selectedOrder.id ? { ...o, status: 'failed_delivery' } : o))
      );
      setCourierNotice(`تم تسجيل تعذر التوصيل: (${exceptionReason}). يجب إعادة الطرد للصيدلية فوراً.`);
      setPodModalOpen(false);
      setSelectedOrder(null);
      setCustomerOtp('');
      setExceptionReason('none');
      setOtpError(null);
      setTimeout(() => setCourierNotice(null), 5000);
      return;
    }

    // OTP validation simulation (requires 6 digits)
    if (!/^\d{6}$/.test(customerOtp)) {
      setOtpError('كود الاستلام المشفر يجب أن يتكون من 6 أرقام تماماً مطابقة لرمز العميل.');
      return;
    }

    // Success via secure OTP
    setOrders((prev) =>
      prev.map((o) => (o.id === selectedOrder.id ? { ...o, status: 'delivered' } : o))
    );
    setCourierNotice('تم تسليم الطلب للمريض بنجاح والتحقق من كود الاستلام المشفر (OTP Verified).');
    setPodModalOpen(false);
    setSelectedOrder(null);
    setCustomerOtp('');
    setExceptionReason('none');
    setOtpError(null);
    setTimeout(() => setCourierNotice(null), 5000);
  };

  const activeOrders = orders.filter((o) => o.status === 'in_transit');
  const pickupOrders = orders.filter((o) => o.status === 'ready_for_pickup' || o.status === 'assigned_to_courier');
  const completedOrders = orders.filter((o) => o.status === 'delivered' || o.status === 'failed_delivery');

  return (
    <div className="space-y-6">
      {/* Reusable Prototype State Notice */}
      <PrototypeNoticeBanner portalName="بوابة المناديب والتوصيل" />

      {/* Courier Header & Shift Control */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
              <Bike className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900">{courier.fullName}</h1>
                <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  مندوب موثق بالرقم القومي
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                وسيلة النقل: دراجة نارية (لوحات: ق ج ط 4921) · النطاق الميداني المعتمد: <strong className="text-slate-700">{courier.currentZone}</strong> · الهاتف: <span className="font-mono">{courier.phone}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-600">حالة الوردية الميدانية:</span>
            <button
              onClick={() => setShiftStatus(shiftStatus === 'available' ? 'offline' : 'available')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                shiftStatus === 'available'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
              }`}
            >
              {shiftStatus === 'available' ? 'متاح لتلقي التوصيل' : 'غير متصل (أوفلاين)'}
            </button>
          </div>
        </div>

        {/* Tab Switcher / Sub-navigation */}
        <div className="flex items-center gap-2 border-t border-slate-100 mt-5 pt-4 overflow-x-auto">
          <button
            onClick={() => handleTabChange('active')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'active'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>التوصيل النشط (في الطريق)</span>
            <span className="text-[11px] tabular-nums font-mono px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded">
              {activeOrders.length}
            </span>
          </button>
          <button
            onClick={() => handleTabChange('pickups')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'pickups'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>طلبات جاهزة للاستلام بالصيدلية</span>
            <span className="text-[11px] tabular-nums font-mono px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded">
              {pickupOrders.length}
            </span>
          </button>
          <button
            onClick={() => handleTabChange('shift')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'shift'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            بيانات الوردية والمركبة
          </button>
          <button
            onClick={() => handleTabChange('history')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'history'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            سجل الرحلات المكتملة ({completedOrders.length})
          </button>
        </div>
      </div>

      {/* Courier Action Notice */}
      {courierNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <p className="font-medium">{courierNotice}</p>
        </div>
      )}

      {/* VIEW 1: ACTIVE DELIVERY (IN TRANSIT) */}
      {activeTab === 'active' && (
        <div className="space-y-4">
          <div className="bg-slate-100/70 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              قاعدة التسليم المشفر: لا يتم تسليم الطرد إلا بعد طلب كود التحقق السري (OTP) المكون من 6 أرقام من المريض وإدخاله بالنظام.
            </span>
          </div>

          {activeOrders.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200 p-6">
              <Truck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">لا توجد طلبات جارية في الطريق حالياً</p>
              <p className="text-xs text-slate-500 mt-1">انتقل إلى تبويب "طلبات جاهزة للاستلام" لبدء استلام طرد جديد من الصيدلية بعد التأكد من ختم الأمان.</p>
              <button
                onClick={() => handleTabChange('pickups')}
                className="mt-3 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                عرض الطلبات الجاهزة بالصيدليات
              </button>
            </div>
          ) : (
            activeOrders.map((ord) => (
              <div key={ord.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div>
                    <span className="font-bold text-slate-900 text-sm font-mono">{ord.orderNumber}</span>
                    <span className="text-slate-400 text-xs mr-2">من صيدلية: {ord.pharmacyName}</span>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                    جاري التوصيل للمريض
                  </span>
                </div>

                {/* Customer Address & Contact */}
                <div className="p-4 bg-slate-50 rounded-xl space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 text-xs">
                      <MapPin className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-bold text-slate-900">{ord.customerName}</p>
                        <p className="text-slate-600 mt-0.5">
                          {ord.deliveryAddress.district} — {ord.deliveryAddress.street}، {ord.deliveryAddress.building} ({ord.deliveryAddress.floor}، {ord.deliveryAddress.apartment})
                        </p>
                        {ord.deliveryAddress.landmark && (
                          <p className="text-[11px] text-slate-400 mt-0.5">علامة مميزة: {ord.deliveryAddress.landmark}</p>
                        )}
                      </div>
                    </div>

                    <a
                      href={`tel:${ord.customerPhone}`}
                      className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <Phone className="w-3.5 h-3.5 text-emerald-600" />
                      <span>اتصال بالمريض</span>
                    </a>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200 text-slate-600">
                    <span>رسوم التوصيل المستحقة للتحصيل:</span>
                    <strong className="text-slate-900 font-bold tabular-nums">{ord.deliveryFeeEgp.toFixed(2)} ج.م</strong>
                  </div>
                </div>

                {/* Finish Delivery Trigger */}
                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-slate-500">
                    حالة ختم الأمان: <span className="text-emerald-700 font-semibold">مختوم وسليم (Tamper Seal Intact)</span>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedOrder(ord);
                      setPodModalOpen(true);
                    }}
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    <span>تأكيد التسليم برمز OTP</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* VIEW 2: PICKUPS AT PHARMACY */}
      {activeTab === 'pickups' && (
        <div className="space-y-4">
          <div className="bg-slate-100/70 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 flex items-center gap-2">
            <PackageCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              إجراءات استلام الطرد: تأكد من تطابق رقم الطلب ووجود شريط الأمان الشمعي أو اللاصق غير الممزق قبل توقيع الاستلام.
            </span>
          </div>

          {pickupOrders.map((ord) => (
            <div key={ord.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <span className="font-bold text-slate-900 text-sm font-mono">{ord.orderNumber}</span>
                  <span className="text-slate-400 text-xs mr-2">صيدلية التسليم: {ord.pharmacyName}</span>
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                  جاهز للاستلام الميداني
                </span>
              </div>

              <div className="text-xs text-slate-600 space-y-1">
                <p>عنوان الصيدلية: 42 شارع دجلة، المعادي</p>
                <p>هاتف الصيدلية: {ord.pharmacyPhone}</p>
                <p>وجهة العميل: {ord.deliveryAddress.district} ({ord.customerName})</p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-emerald-800 font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-4 h-4" />
                  <span>تم توثيق ختم الأمان بواسطة الصيدلي</span>
                </span>
                <button
                  onClick={() => handleConfirmPickup(ord.id)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Navigation className="w-4 h-4" />
                  <span>استلام الطرد وبدء الرحلة</span>
                </button>
              </div>
            </div>
          ))}

          {pickupOrders.length === 0 && (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200 p-6">
              <PackageCheck className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">لا توجد طلبات جديدة بانتظار الاستلام</p>
              <p className="text-xs text-slate-500 mt-1">عند قيام الصيدلية بختم طرد وإسناده لك، سيظهر هنا فوراً.</p>
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: SHIFT & COURIER PROFILE */}
      {activeTab === 'shift' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4 text-xs">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Bike className="w-5 h-5 text-emerald-700" />
            <h3 className="font-bold text-slate-900 text-sm">بيانات المندوب والمركبة المسجلة</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-slate-600">
            <div className="p-3 bg-slate-50 rounded-lg space-y-1">
              <span className="text-slate-400">اسم المندوب الرباعي:</span>
              <p className="font-bold text-slate-900 text-sm">{courier.fullName}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg space-y-1">
              <span className="text-slate-400">الرقم القومي (المحمي والمشفر):</span>
              <p className="font-bold text-slate-900 text-sm font-mono">29010101****** (تم التحقق الجنائي)</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg space-y-1">
              <span className="text-slate-400">وسيلة الانتقال:</span>
              <p className="font-bold text-slate-900 text-sm">دراجة نارية (لوحات: ق ج ط 4921)</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg space-y-1">
              <span className="text-slate-400">النطاق الجغرافي النشط:</span>
              <p className="font-bold text-emerald-800 text-sm">{courier.currentZone}</p>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg text-slate-500 leading-relaxed">
            ملاحظة تنظيمية: تخضع حركة المناديب في منصة علاجك لبروتوكول رقابة التسليم الآمن؛ ولا يتم تحرير مستحقات رحلة التوصيل إلا بعد تسجيل كود الاستلام المشفر (OTP) أو توثيق تقرير تعذر التسليم المعتمد من الصيدلية.
          </div>
        </div>
      )}

      {/* VIEW 4: COMPLETED DELIVERIES */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-3">
            <h3 className="font-bold text-slate-900 text-sm mb-3">سجل المهام والرحلات المكتملة</h3>
            {completedOrders.length === 0 ? (
              <p className="text-xs text-slate-500">لا توجد رحلات مسجلة في هذه الوردية حتى الآن.</p>
            ) : (
              completedOrders.map((ord) => (
                <div key={ord.id} className="p-3 bg-slate-50 rounded-lg flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-900 font-mono">{ord.orderNumber}</span>
                    <span className="text-slate-400 mr-2">· العميل: {ord.customerName}</span>
                    <p className="text-slate-500 mt-1">
                      الحالة النهائية: {ord.status === 'delivered' ? 'تم التسليم بنجاح (OTP Verified)' : 'تعذر التسليم (معاد للصيدلية)'}
                    </p>
                  </div>
                  <div className="text-left">
                    <span className="font-bold text-emerald-800 text-sm tabular-nums">{ord.deliveryFeeEgp.toFixed(2)} ج.م</span>
                    <span className="block text-[11px] text-slate-400">رسوم التوصيل المعتمدة</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SECURE PROOF OF DELIVERY (POD) MODAL */}
      {podModalOpen && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-200 text-right">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <button
                onClick={() => setPodModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 text-sm font-semibold rounded-md cursor-pointer"
              >
                إغلاق ✕
              </button>
              <h3 className="font-semibold text-slate-900 text-base">توثيق تسليم الطرد الدوائي (Secure POD)</h3>
            </div>

            <form onSubmit={handleCompleteDelivery} className="mt-4 space-y-4">
              <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1">
                <p className="font-bold text-slate-900 font-mono">رقم الطلب: {selectedOrder.orderNumber}</p>
                <p className="text-slate-500">العميل المستلم: {selectedOrder.customerName}</p>
                <p className="text-slate-500">العنوان: {selectedOrder.deliveryAddress.district} — {selectedOrder.deliveryAddress.street}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  إدخال كود الاستلام المشفر من المريض (6 أرقام)
                </label>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="مثال: 849201"
                  value={customerOtp}
                  onChange={(e) => {
                    setCustomerOtp(e.target.value.replace(/\D/g, ''));
                    setOtpError(null);
                  }}
                  className="w-full text-center tracking-widest text-lg font-mono font-bold p-2.5 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
                />
                <span className="text-[11px] text-slate-400 block mt-1">
                  يحصل المريض على هذا الرمز عند إنشاء الطلب لتأكيد الاستلام اليدوي.
                </span>
                {otpError && (
                  <p className="text-xs text-rose-600 font-medium mt-1">{otpError}</p>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  في حال تعذر التسليم (تسجيل استثناء):
                </label>
                <select
                  value={exceptionReason}
                  onChange={(e) => setExceptionReason(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg bg-white"
                >
                  <option value="none">لا يوجد استثناء (تسليم ناجح بالكود)</option>
                  <option value="customer_unreachable">العميل لم يستجب للهاتف / العنوان مغلق</option>
                  <option value="customer_refused">رفض العميل استلام الطلب</option>
                  <option value="damaged_seal">تلف في ختم الأمان أثناء النقل (إعادة فورية)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPodModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  {exceptionReason === 'none' ? 'توثيق التسليم وإنهاء الرحلة' : 'تسجيل تعذر التسليم'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
