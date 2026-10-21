import React, { useState } from 'react';
import { ShieldAlert, Lock, UserCheck, ArrowRight, Sparkles } from 'lucide-react';
import { useAuth, DEMO_PERSONAS } from '../../contexts/AuthContext';
import { UserRole } from '../../types';
import { AuthModal } from './AuthModal';
import { useNavigate } from 'react-router-dom';

interface RoleProtectedRouteProps {
  requiredRole: UserRole;
  portalNameAr: string;
  children: React.ReactNode;
}

export const RoleProtectedRoute: React.FC<RoleProtectedRouteProps> = ({
  requiredRole,
  portalNameAr,
  children,
}) => {
  const { profile, roles, activeRole, switchActiveRole, isAuthenticated, isDemoMode } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const navigate = useNavigate();

  // Admin has access to all portals
  const hasAccess = roles.includes('admin') || roles.includes(requiredRole) || (isDemoMode && activeRole === requiredRole);

  if (hasAccess && (!isDemoMode || activeRole === requiredRole || roles.includes('admin'))) {
    return <>{children}</>;
  }

  const getRoleLabel = (r: UserRole) => {
    switch (r) {
      case 'customer': return 'مريض / عميل';
      case 'pharmacy_staff': return 'صيدلي مرخص';
      case 'courier': return 'مندوب توصيل';
      case 'admin': return 'مسؤول رقابي';
      default: return r;
    }
  };

  const canSwitchToRequired = roles.includes(requiredRole) || isDemoMode;

  return (
    <div className="max-w-2xl mx-auto my-12 p-8 bg-white rounded-2xl border border-slate-200 shadow-md text-center" dir="rtl">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-700 mx-auto flex items-center justify-center mb-4 border border-amber-200">
        <ShieldAlert className="w-8 h-8" />
      </div>

      <h2 className="text-xl font-bold text-slate-900 mb-2">صلاحية الدخول مقيدة</h2>
      <p className="text-sm text-slate-600 mb-6 leading-relaxed">
        بوابة <span className="font-semibold text-emerald-800">«{portalNameAr}»</span> مخصصة للمصرح لهم فقط بصفتهم{' '}
        <span className="font-semibold text-slate-900">({getRoleLabel(requiredRole)})</span>، وفقاً لضوابط أمن وتداول الأدوية المعمول بها.
      </p>

      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 max-w-md mx-auto mb-6 text-right space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-slate-500">حالة الجلسة:</span>
          <span className="font-medium text-emerald-700">{isAuthenticated ? 'مسجل الدخول' : 'زائر غير مسجل'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">المستخدم الحالي:</span>
          <span className="font-medium text-slate-900">{profile?.fullName || 'غير محدد'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-500">الدور النشط الحالي:</span>
          <span className="font-medium text-amber-800 bg-amber-100/60 px-2 py-0.5 rounded">
            {getRoleLabel(activeRole)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {canSwitchToRequired && (
          <button
            onClick={() => switchActiveRole(requiredRole)}
            className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors shadow-2xs"
          >
            <UserCheck className="w-4 h-4" />
            <span>التبديل إلى دور ({getRoleLabel(requiredRole)})</span>
          </button>
        )}

        <button
          onClick={() => setAuthModalOpen(true)}
          className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors"
        >
          <Lock className="w-4 h-4" />
          <span>تسجيل الدخول بحساب مصرح</span>
        </button>

        <button
          onClick={() => navigate('/customer')}
          className="px-4 py-2.5 rounded-xl text-slate-500 hover:text-slate-800 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
        >
          <span>العودة لبوابة المرضى</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        defaultRole={requiredRole}
      />
    </div>
  );
};
