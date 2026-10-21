import React, { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ShieldAlert,
  Building2,
  Bike,
  Pill,
  History,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Search,
  Filter,
  Users,
  ShieldCheck,
  Lock,
  FileCheck,
  Check,
  Eye,
  X,
  FileText,
  BadgeAlert,
  Shield,
  Clock,
} from 'lucide-react';
import {
  FIXTURE_PHARMACIES,
  FIXTURE_COURIERS,
  FIXTURE_CATALOG,
  FIXTURE_AUDIT_LOGS,
} from '../../data/developmentFixtures';
import { Pharmacy, CourierProfile, AuditLogEntry, MedicineCatalogItem, UserRole } from '../../types';
import { PrototypeNoticeBanner } from '../common/PrototypeNoticeBanner';

interface SystemUser {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  role: UserRole;
  verifiedAt: string;
}

export const AdminPortal: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const getInitialTab = (): 'overview' | 'pharmacies' | 'couriers' | 'catalog' | 'roles' | 'audit' => {
    if (location.pathname.includes('/pharmacies')) return 'pharmacies';
    if (location.pathname.includes('/couriers')) return 'couriers';
    if (location.pathname.includes('/catalog')) return 'catalog';
    if (location.pathname.includes('/roles')) return 'roles';
    if (location.pathname.includes('/audit')) return 'audit';
    return 'overview';
  };

  const [activeTab, setActiveTab] = useState<'overview' | 'pharmacies' | 'couriers' | 'catalog' | 'roles' | 'audit'>(getInitialTab());

  const handleTabChange = (tab: 'overview' | 'pharmacies' | 'couriers' | 'catalog' | 'roles' | 'audit') => {
    setActiveTab(tab);
    if (tab === 'overview') navigate('/admin');
    else navigate(`/admin/${tab}`);
  };

  const [pharmacies, setPharmacies] = useState<Pharmacy[]>(FIXTURE_PHARMACIES);
  const [couriers, setCouriers] = useState<CourierProfile[]>(FIXTURE_COURIERS);
  const [catalog] = useState<MedicineCatalogItem[]>(FIXTURE_CATALOG);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(FIXTURE_AUDIT_LOGS);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);

  // Filters
  const [pharmacyFilter, setPharmacyFilter] = useState<'all' | 'verified' | 'pending' | 'suspended'>('all');
  const [courierFilter, setCourierFilter] = useState<'all' | 'verified' | 'pending' | 'suspended'>('all');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [auditSearch, setAuditSearch] = useState('');

  // Pharmacy inspection modal
  const [inspectPharmacy, setInspectPharmacy] = useState<Pharmacy | null>(null);

  // System users for Role Management screen
  const [users] = useState<SystemUser[]>([
    {
      id: 'usr-admin-01',
      fullName: 'م. أحمد الخولي',
      phone: '+20 10 0001 9922',
      email: 'admin.supervision@elajx.eg',
      role: 'admin',
      verifiedAt: '2026-01-15',
    },
    {
      id: 'usr-pharm-01',
      fullName: 'د. سارة المنشاوي (مدير صيدلية النخبة)',
      phone: '+20 2 2358 1190',
      email: 'elite.maadi@elajx.eg',
      role: 'pharmacy_staff',
      verifiedAt: '2026-02-01',
    },
    {
      id: 'usr-cour-01',
      fullName: 'أحمد محمود رضوان (مندوب معتمد)',
      phone: '+20 10 1829 3301',
      email: 'ahmed.courier@elajx.eg',
      role: 'courier',
      verifiedAt: '2026-02-10',
    },
    {
      id: 'usr-cust-01',
      fullName: 'طارق عبد السلام (مريض مسجل)',
      phone: '+20 12 2841 9022',
      email: 'tarek.patient@gmail.com',
      role: 'customer',
      verifiedAt: '2026-02-20',
    },
  ]);

  const handleVerifyPharmacy = (pharmacyId: string) => {
    setPharmacies((prev) =>
      prev.map((p) => (p.id === pharmacyId ? { ...p, verificationStatus: 'verified', isActive: true } : p))
    );
    const newAudit: AuditLogEntry = {
      id: `aud-${Date.now()}`,
      actorId: 'admin-01',
      actorRole: 'admin',
      action: 'APPROVE_PHARMACY_LICENSE',
      entityType: 'pharmacy',
      entityId: pharmacyId,
      timestamp: new Date().toISOString(),
      metadata: { status: 'verified', verifiedBy: 'admin-01' },
    };
    setAuditLogs([newAudit, ...auditLogs]);
    setAdminNotice('تم اعتماد ترخيص الصيدلية وتفعيلها على شبكة علاجك بنجاح وتوثيق ذلك بسجل التدقيق.');
    setTimeout(() => setAdminNotice(null), 5000);
  };

  const handleSuspendPharmacy = (pharmacyId: string) => {
    setPharmacies((prev) =>
      prev.map((p) => (p.id === pharmacyId ? { ...p, verificationStatus: 'suspended', isActive: false } : p))
    );
    const newAudit: AuditLogEntry = {
      id: `aud-${Date.now()}`,
      actorId: 'admin-01',
      actorRole: 'admin',
      action: 'SUSPEND_PHARMACY_LICENSE',
      entityType: 'pharmacy',
      entityId: pharmacyId,
      timestamp: new Date().toISOString(),
      metadata: { status: 'suspended', reason: 'Audit compliance review' },
    };
    setAuditLogs([newAudit, ...auditLogs]);
    setAdminNotice('تم تعليق ترخيص الصيدلية وإيقاف استلام الطلبات احترازياً.');
    setTimeout(() => setAdminNotice(null), 5000);
  };

  const handleVerifyCourier = (courierId: string) => {
    setCouriers((prev) =>
      prev.map((c) => (c.id === courierId ? { ...c, verificationStatus: 'verified' } : c))
    );
    const newAudit: AuditLogEntry = {
      id: `aud-${Date.now()}`,
      actorId: 'admin-01',
      actorRole: 'admin',
      action: 'VERIFY_COURIER_NATIONAL_ID',
      entityType: 'courier',
      entityId: courierId,
      timestamp: new Date().toISOString(),
      metadata: { verificationStatus: 'verified' },
    };
    setAuditLogs([newAudit, ...auditLogs]);
    setAdminNotice('تم توثيق الرقم القومي للمندوب وفحص السجل الجنائي بنجاح.');
    setTimeout(() => setAdminNotice(null), 5000);
  };

  const handleSuspendCourier = (courierId: string) => {
    setCouriers((prev) =>
      prev.map((c) => (c.id === courierId ? { ...c, verificationStatus: 'suspended' } : c))
    );
    const newAudit: AuditLogEntry = {
      id: `aud-${Date.now()}`,
      actorId: 'admin-01',
      actorRole: 'admin',
      action: 'SUSPEND_COURIER_ACCOUNT',
      entityType: 'courier',
      entityId: courierId,
      timestamp: new Date().toISOString(),
    };
    setAuditLogs([newAudit, ...auditLogs]);
    setAdminNotice('تم تعليق حساب المندوب ومنع إسناد أي شحنات جديدة إليه.');
    setTimeout(() => setAdminNotice(null), 5000);
  };

  // Filtered pharmacies
  const filteredPharmacies = useMemo(() => {
    if (pharmacyFilter === 'all') return pharmacies;
    return pharmacies.filter((p) => p.verificationStatus === pharmacyFilter);
  }, [pharmacies, pharmacyFilter]);

  // Filtered couriers
  const filteredCouriers = useMemo(() => {
    if (courierFilter === 'all') return couriers;
    return couriers.filter((c) => c.verificationStatus === courierFilter);
  }, [couriers, courierFilter]);

  // Filtered catalog
  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.toLowerCase().trim();
    if (!q) return catalog;
    return catalog.filter(
      (m) =>
        m.brandNameAr.toLowerCase().includes(q) ||
        m.brandNameEn.toLowerCase().includes(q) ||
        m.activeIngredient.toLowerCase().includes(q) ||
        m.manufacturer.toLowerCase().includes(q)
    );
  }, [catalog, catalogSearch]);

  // Filtered audit logs
  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.toLowerCase().trim();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.actorId.toLowerCase().includes(q) ||
        l.entityType.toLowerCase().includes(q) ||
        l.entityId.toLowerCase().includes(q)
    );
  }, [auditLogs, auditSearch]);

  return (
    <div className="space-y-6">
      {/* Reusable Prototype State Notice */}
      <PrototypeNoticeBanner portalName="لوحة الإدارة والرقابة التشغيلية" />

      {/* Admin Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900">لوحة الإدارة والرقابة التشغيلية</h1>
                <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  صلاحيات الإشراف والامتثال التنظيمي
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                الإشراف على تراخيص الصيدليات، توثيق المناديب، رقابة التسعيرة الجبرية (EDA)، وتدقيق سجلات الأمان المشفرة.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Switcher / Sub-navigation */}
        <div className="flex items-center gap-2 border-t border-slate-100 mt-5 pt-4 overflow-x-auto">
          <button
            onClick={() => handleTabChange('overview')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            مؤشرات النزاهة والعمليات
          </button>
          <button
            onClick={() => handleTabChange('pharmacies')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'pharmacies'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>مراجعة تراخيص الصيدليات</span>
            <span className="text-[11px] tabular-nums font-mono px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded">
              {pharmacies.length}
            </span>
          </button>
          <button
            onClick={() => handleTabChange('couriers')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'couriers'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>توثيق المناديب والأرقام القومية</span>
            <span className="text-[11px] tabular-nums font-mono px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded">
              {couriers.length}
            </span>
          </button>
          <button
            onClick={() => handleTabChange('catalog')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'catalog'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            التسعيرة الجبرية (EDA Cap)
          </button>
          <button
            onClick={() => handleTabChange('roles')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'roles'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            إدارة الأدوار وصلاحيات RBAC
          </button>
          <button
            onClick={() => handleTabChange('audit')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'audit'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span>سجلات التدقيق المشفرة</span>
            <span className="text-[11px] tabular-nums font-mono px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded">
              {auditLogs.length}
            </span>
          </button>
        </div>
      </div>

      {/* Admin Action Notice */}
      {adminNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <p className="font-medium">{adminNotice}</p>
        </div>
      )}

      {/* VIEW 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
              <span className="text-xs text-slate-500 font-medium">الصيدليات المعتمدة</span>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {pharmacies.filter((p) => p.verificationStatus === 'verified').length} / {pharmacies.length}
              </p>
              <span className="text-[11px] text-emerald-700 mt-1 block">تراخيص وزارة الصحة سارية</span>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
              <span className="text-xs text-slate-500 font-medium">المناديب الموثقين جنائياً</span>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {couriers.filter((c) => c.verificationStatus === 'verified').length} / {couriers.length}
              </p>
              <span className="text-[11px] text-emerald-700 mt-1 block">تحقق بالرقم القومي معتمد</span>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
              <span className="text-xs text-slate-500 font-medium">التسعيرة الجبرية (EDA Cap)</span>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">100%</p>
              <span className="text-[11px] text-emerald-700 mt-1 block">صفر مخالفات سعرية</span>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
              <span className="text-xs text-slate-500 font-medium">عمليات التدقيق المحمية</span>
              <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{auditLogs.length}</p>
              <span className="text-[11px] text-emerald-700 mt-1 block">سجلات غير قابلة للحذف</span>
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-2">
            <h3 className="font-bold text-slate-900 text-sm">مبادئ العزل الخادمي في منصة علاجك (Zero-Trust Security):</h3>
            <ul className="list-disc list-inside space-y-1 text-slate-600 leading-relaxed">
              <li>عزل كامل لأسرار التوصيل ورموز OTP داخل جدول <code className="text-slate-800 font-mono">private.order_delivery_secrets</code> الممنوع عن كافة أدوار التطبيق.</li>
              <li>حظر التعديل الذاتي لتراخيص الصيدليات والمناديب عبر مشغلات قواعد البيانات (BEFORE UPDATE Triggers).</li>
              <li>إلزامية التحقق من الصلاحيات الإدارية عبر جدول <code className="text-slate-800 font-mono">public.user_roles</code> المستند إلى الهوية الخادمية فقط.</li>
            </ul>
          </div>
        </div>
      )}

      {/* VIEW 2: PHARMACIES */}
      {activeTab === 'pharmacies' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">مراجعة تراخيص واعتمادات الصيدليات</h2>
              <p className="text-xs text-slate-500">فحص وتوثيق الصيدليات الأهلية قبل السماح لها بتلقي طلبات المرضى.</p>
            </div>
            <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200 text-xs">
              <span className="text-slate-400 px-2">الحالة:</span>
              <button
                onClick={() => setPharmacyFilter('all')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  pharmacyFilter === 'all' ? 'bg-white font-bold shadow-xs text-slate-900' : 'text-slate-600'
                }`}
              >
                الكل
              </button>
              <button
                onClick={() => setPharmacyFilter('verified')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  pharmacyFilter === 'verified' ? 'bg-white font-bold shadow-xs text-slate-900' : 'text-slate-600'
                }`}
              >
                المعتمدة
              </button>
              <button
                onClick={() => setPharmacyFilter('pending')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  pharmacyFilter === 'pending' ? 'bg-white font-bold shadow-xs text-slate-900' : 'text-slate-600'
                }`}
              >
                قيد المراجعة
              </button>
              <button
                onClick={() => setPharmacyFilter('suspended')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  pharmacyFilter === 'suspended' ? 'bg-white font-bold shadow-xs text-slate-900' : 'text-slate-600'
                }`}
              >
                المعلقة
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="p-3">اسم الصيدلية</th>
                    <th className="p-3">رقم ترخيص وزارة الصحة</th>
                    <th className="p-3">السجل التجاري</th>
                    <th className="p-3">الموقع الجغرافي</th>
                    <th className="p-3">حالة الاعتماد</th>
                    <th className="p-3 text-left">الإجراءات الرقابية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPharmacies.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="p-3 font-bold text-slate-900">{p.commercialName}</td>
                      <td className="p-3 font-mono text-slate-700">{p.licenseNumber}</td>
                      <td className="p-3 font-mono text-slate-700">{p.commercialRegister}</td>
                      <td className="p-3 text-slate-600">{p.district} ({p.governorate})</td>
                      <td className="p-3">
                        {p.verificationStatus === 'verified' ? (
                          <span className="text-emerald-700 font-semibold flex items-center gap-1">
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>معتمد ونشط</span>
                          </span>
                        ) : p.verificationStatus === 'pending' ? (
                          <span className="text-amber-700 font-semibold flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>قيد المراجعة</span>
                          </span>
                        ) : (
                          <span className="text-rose-700 font-semibold flex items-center gap-1">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>معلق احترازياً</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-left">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setInspectPharmacy(p)}
                            className="px-2.5 py-1 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded text-xs cursor-pointer"
                          >
                            التفاصيل
                          </button>
                          {p.verificationStatus === 'pending' ? (
                            <button
                              onClick={() => handleVerifyPharmacy(p.id)}
                              className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-xs font-semibold cursor-pointer"
                            >
                              اعتماد الترخيص
                            </button>
                          ) : p.verificationStatus === 'verified' ? (
                            <button
                              onClick={() => handleSuspendPharmacy(p.id)}
                              className="px-3 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded text-xs font-medium cursor-pointer"
                            >
                              تعليق احترازي
                            </button>
                          ) : (
                            <button
                              onClick={() => handleVerifyPharmacy(p.id)}
                              className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold cursor-pointer"
                            >
                              إعادة التفعيل
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 3: COURIERS */}
      {activeTab === 'couriers' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">توثيق المناديب والتحقق الجنائي</h2>
              <p className="text-xs text-slate-500">حماية شبكة التوصيل بفحص السجل الجنائي وتوثيق بطاقة الرقم القومي.</p>
            </div>
            <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200 text-xs">
              <span className="text-slate-400 px-2">الحالة:</span>
              <button
                onClick={() => setCourierFilter('all')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  courierFilter === 'all' ? 'bg-white font-bold shadow-xs text-slate-900' : 'text-slate-600'
                }`}
              >
                الكل
              </button>
              <button
                onClick={() => setCourierFilter('verified')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  courierFilter === 'verified' ? 'bg-white font-bold shadow-xs text-slate-900' : 'text-slate-600'
                }`}
              >
                الموثقين
              </button>
              <button
                onClick={() => setCourierFilter('pending')}
                className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
                  courierFilter === 'pending' ? 'bg-white font-bold shadow-xs text-slate-900' : 'text-slate-600'
                }`}
              >
                قيد الفحص
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="p-3">اسم المندوب</th>
                    <th className="p-3">الرقم القومي (محمي)</th>
                    <th className="p-3">رقم الهاتف</th>
                    <th className="p-3">وسيلة النقل</th>
                    <th className="p-3">النطاق الجغرافي</th>
                    <th className="p-3">حالة التوثيق</th>
                    <th className="p-3 text-left">الإجراء الإداري</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCouriers.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/70">
                      <td className="p-3 font-bold text-slate-900">{c.fullName}</td>
                      <td className="p-3 font-mono text-slate-700">29010101******</td>
                      <td className="p-3 font-mono text-slate-600">{c.phone}</td>
                      <td className="p-3 text-slate-600">
                        {c.vehicleType === 'motorcycle' ? 'دراجة نارية' : 'سيارة'}
                      </td>
                      <td className="p-3 text-slate-600">{c.currentZone}</td>
                      <td className="p-3">
                        {c.verificationStatus === 'verified' ? (
                          <span className="text-emerald-700 font-semibold flex items-center gap-1">
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>موثق بالرقم القومي</span>
                          </span>
                        ) : c.verificationStatus === 'pending' ? (
                          <span className="text-amber-700 font-semibold flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>بانتظار الفحص الجنائي</span>
                          </span>
                        ) : (
                          <span className="text-rose-700 font-semibold flex items-center gap-1">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>موقوف</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-left">
                        {c.verificationStatus === 'pending' ? (
                          <button
                            onClick={() => handleVerifyCourier(c.id)}
                            className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-xs font-semibold cursor-pointer"
                          >
                            توثيق واعتماد
                          </button>
                        ) : c.verificationStatus === 'verified' ? (
                          <button
                            onClick={() => handleSuspendCourier(c.id)}
                            className="px-3 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded text-xs font-medium cursor-pointer"
                          >
                            إيقاف الحساب
                          </button>
                        ) : (
                          <button
                            onClick={() => handleVerifyCourier(c.id)}
                            className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold cursor-pointer"
                          >
                            إعادة التوثيق
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4: CATALOG & PRICE CAPS */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">سجل التسعيرة الجبرية الرسمية (EDA Price Caps)</h2>
              <p className="text-xs text-slate-500">مراقبة الأسعار المقيدة جبرياً بموجب قرارات هيئة الدواء المصرية وحظر أي مغالاة.</p>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                placeholder="ابحث بالاسم التجاري أو المادة..."
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                className="pl-3 pr-9 py-1.5 text-xs border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="p-3">الاسم التجاري</th>
                    <th className="p-3">المادة الفعالة</th>
                    <th className="p-3">الشكل والتركيز</th>
                    <th className="p-3">الشركة المصنعة</th>
                    <th className="p-3">التسعيرة الجبرية القصوى</th>
                    <th className="p-3">شرط الروشتة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCatalog.map((med) => (
                    <tr key={med.id} className="hover:bg-slate-50/70">
                      <td className="p-3">
                        <strong className="text-slate-900 block">{med.brandNameAr}</strong>
                        <span className="text-slate-500 text-[11px]">{med.brandNameEn}</span>
                      </td>
                      <td className="p-3 text-slate-700 font-medium">{med.activeIngredient}</td>
                      <td className="p-3 text-slate-600">{med.dosageForm} · {med.strength}</td>
                      <td className="p-3 text-slate-600">{med.manufacturer}</td>
                      <td className="p-3 font-bold text-emerald-800 tabular-nums">
                        {med.maxRegulatedPriceEgp != null ? `${med.maxRegulatedPriceEgp.toFixed(2)} ج.م` : 'غير مسجل'}
                      </td>
                      <td className="p-3">
                        {med.requiresPrescription ? (
                          <span className="text-amber-800 font-medium">يلزم روشتة طبية (Rx)</span>
                        ) : (
                          <span className="text-slate-500">صرف مباشر (OTC)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 5: ROLES & RBAC OVERSIGHT */}
      {activeTab === 'roles' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Users className="w-5 h-5 text-emerald-700" />
              <div>
                <h3 className="font-bold text-slate-900 text-sm">مصفوفة الصلاحيات وفصل المسؤوليات (RBAC Architecture)</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  تدار الصلاحيات حصرياً عبر جدول <code className="font-mono text-slate-700">public.user_roles</code> المدعوم بسياسات RLS، ولا يمكن لأي مستخدم تعيين دور لنفسه بالمتصفح.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="p-3">المستخدم</th>
                    <th className="p-3">الدور المعتمد</th>
                    <th className="p-3">رقم الهاتف</th>
                    <th className="p-3">البريد الإلكتروني</th>
                    <th className="p-3">حدود الصلاحيات المطبقة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="p-3 font-bold text-slate-900">{u.fullName}</td>
                      <td className="p-3">
                        <span className="font-mono font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                          {u.role}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-slate-600">{u.phone}</td>
                      <td className="p-3 font-mono text-slate-600">{u.email}</td>
                      <td className="p-3 text-slate-500">
                        {u.role === 'admin' && 'رقابة التراخيص، التسعيرة الجبرية، فحص سجلات التدقيق المشفرة'}
                        {u.role === 'pharmacy_staff' && 'مراجعة طلبات المرضى، فحص الأرفف، اقتراح البدائل، وضع ختم الأمان'}
                        {u.role === 'courier' && 'استلام الطرود المختومة، تحديث خط السير، إدخال كود OTP للتسليم'}
                        {u.role === 'customer' && 'استكشاف الأدوية، تقديم الطلبات، مراجعة واعتماد البديل، تتبع الطلب'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-lg text-xs text-amber-950 space-y-1">
              <p className="font-bold">تنبيه أمني معماري (Security Boundary Notice):</p>
              <p>
                أزرار التنقل السريع بين البوابات في الواجهة هي أدوات للمعاينة والتطوير؛ ولا تمنح أي صلاحية خادمية. أي محاولة من عميل للوصول إلى جداول أو إجراءات بدون الدور المسجل في جدول <code className="font-mono">user_roles</code> تواجه رفضاً فورياً بواسطة سياسات أمان مستوى الصفوف (Row Level Security).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 6: AUDIT LOGS */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-slate-400" />
                <h3 className="font-bold text-slate-900 text-xs">سجل الحركات الإدارية والأمنية غير القابل للحذف (Audit Ledger)</h3>
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2" />
                <input
                  type="text"
                  placeholder="بحث في السجلات..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className="pl-3 pr-8 py-1 text-xs border border-slate-200 rounded-md"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="p-3">التوقيت (UTC)</th>
                    <th className="p-3">معرّف الفاعل (Actor)</th>
                    <th className="p-3">الدور</th>
                    <th className="p-3">الحدث الأمني</th>
                    <th className="p-3">الكيان المتأثر</th>
                    <th className="p-3">معرّف الكيان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {filteredAuditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="p-3 text-slate-500 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString('ar-EG')}
                      </td>
                      <td className="p-3 text-slate-700">{log.actorId}</td>
                      <td className="p-3">
                        <span className="text-slate-800 font-semibold">{log.actorRole}</span>
                      </td>
                      <td className="p-3 text-emerald-800 font-bold">{log.action}</td>
                      <td className="p-3 text-slate-600">{log.entityType}</td>
                      <td className="p-3 text-slate-400 text-[11px]">{log.entityId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PHARMACY INSPECTION MODAL */}
      {inspectPharmacy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-200 text-right">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <button
                onClick={() => setInspectPharmacy(null)}
                className="text-slate-400 hover:text-slate-600 p-1 text-sm font-semibold rounded-md cursor-pointer"
              >
                إغلاق ✕
              </button>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900 text-base">{inspectPharmacy.commercialName}</h3>
                <Building2 className="w-4 h-4 text-emerald-700" />
              </div>
            </div>

            <div className="mt-4 space-y-3 text-xs text-slate-600">
              <div className="p-3 bg-slate-50 rounded-lg space-y-1">
                <p><span className="text-slate-400">رقم ترخيص وزارة الصحة:</span> <strong className="font-mono text-slate-900">{inspectPharmacy.licenseNumber}</strong></p>
                <p><span className="text-slate-400">رقم السجل التجاري:</span> <strong className="font-mono text-slate-900">{inspectPharmacy.commercialRegister}</strong></p>
                <p><span className="text-slate-400">العنوان:</span> {inspectPharmacy.streetAddress}، {inspectPharmacy.district}، {inspectPharmacy.governorate}</p>
                <p><span className="text-slate-400">الهاتف المسجل:</span> <strong className="font-mono text-slate-900">{inspectPharmacy.phone}</strong></p>
                <p><span className="text-slate-400">حالة الاعتماد الحالية:</span> <span className="font-semibold text-emerald-800">{inspectPharmacy.verificationStatus}</span></p>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg text-slate-500 leading-relaxed text-[11px]">
                ملاحظة أمنية: لا يمكن تعديل بيانات الترخيص إلا بقرار من موظف الإدارة المخول، ويتم تسجيل كل حركة بسجل التدقيق الرقمي.
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setInspectPharmacy(null)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
