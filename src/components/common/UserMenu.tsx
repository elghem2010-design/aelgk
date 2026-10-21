import React, { useState, useRef, useEffect } from 'react';
import {
  User,
  LogOut,
  ChevronDown,
  Shield,
  Building2,
  Bike,
  Sparkles,
  Phone,
  Check,
} from 'lucide-react';
import { useAuth, DEMO_PERSONAS } from '../../contexts/AuthContext';
import { UserRole } from '../../types';
import { AuthModal } from './AuthModal';

export const UserMenu: React.FC = () => {
  const {
    profile,
    roles,
    activeRole,
    switchActiveRole,
    logout,
    isAuthenticated,
    isDemoMode,
  } = useAuth();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getRoleLabel = (r: UserRole) => {
    switch (r) {
      case 'customer':
        return 'مريض / عميل';
      case 'pharmacy_staff':
        return 'صيدلي مرخص';
      case 'courier':
        return 'مندوب توصيل';
      case 'admin':
        return 'مسؤول رقابي';
      default:
        return r;
    }
  };

  const getRoleIcon = (r: UserRole) => {
    switch (r) {
      case 'pharmacy_staff':
        return <Building2 className="w-3.5 h-3.5 text-blue-600" />;
      case 'courier':
        return <Bike className="w-3.5 h-3.5 text-amber-600" />;
      case 'admin':
        return <Shield className="w-3.5 h-3.5 text-purple-600" />;
      default:
        return <User className="w-3.5 h-3.5 text-emerald-600" />;
    }
  };

  if (!isAuthenticated || !profile) {
    return (
      <>
        <button
          onClick={() => setAuthModalOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white transition-colors cursor-pointer shadow-2xs"
        >
          <User className="w-3.5 h-3.5" />
          <span>تسجيل الدخول</span>
        </button>
        <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      </>
    );
  }

  return (
    <div className="relative" ref={dropdownRef} dir="rtl">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium transition-colors cursor-pointer shadow-2xs"
      >
        <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-xs">
          {profile.fullName.charAt(0)}
        </div>
        <div className="flex flex-col text-right hidden sm:block">
          <span className="font-semibold text-slate-900 leading-tight line-clamp-1">{profile.fullName}</span>
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            {getRoleIcon(activeRole)}
            <span>{getRoleLabel(activeRole)}</span>
          </div>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {dropdownOpen && (
        <div className="absolute left-0 mt-2 w-64 rounded-xl bg-white shadow-xl border border-slate-200 py-2 z-50 text-right animate-in fade-in duration-150">
          {/* User Details */}
          <div className="px-3 py-2 border-b border-slate-100">
            <p className="font-semibold text-xs text-slate-900">{profile.fullName}</p>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5" dir="ltr">{profile.phone || profile.email}</p>
            {profile.nationalIdMasked && (
              <p className="text-[10px] text-slate-400 mt-0.5">الرقم القومي: {profile.nationalIdMasked}</p>
            )}
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 font-medium border border-emerald-200">
                الدور النشط: {getRoleLabel(activeRole)}
              </span>
              {isDemoMode && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 font-mono border border-amber-200">
                  تجريبي
                </span>
              )}
            </div>
          </div>

          {/* Role Switcher if multi-role or demo */}
          {(roles.length > 1 || isDemoMode) && (
            <div className="px-3 py-2 border-b border-slate-100">
              <span className="text-[11px] font-semibold text-slate-600 block mb-1.5">
                {isDemoMode ? 'تبديل الشخصية التجريبية السريعة:' : 'الأدوار المصرح بها للمستخدم:'}
              </span>
              <div className="space-y-1">
                {(isDemoMode
                  ? (['customer', 'pharmacy_staff', 'courier', 'admin'] as UserRole[])
                  : roles
                ).map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      switchActiveRole(r);
                      setDropdownOpen(false);
                    }}
                    className={`w-full text-right px-2 py-1.5 rounded-md text-xs flex items-center justify-between transition-colors cursor-pointer ${
                      activeRole === r
                        ? 'bg-emerald-50 text-emerald-900 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {getRoleIcon(r)}
                      <span>{getRoleLabel(r)}</span>
                    </div>
                    {activeRole === r && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="pt-1">
            <button
              onClick={() => {
                setDropdownOpen(false);
                setAuthModalOpen(true);
              }}
              className="w-full text-right px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>إدارة الحسابات والشخصيات</span>
            </button>
            <button
              onClick={async () => {
                setDropdownOpen(false);
                await logout();
              }}
              className="w-full text-right px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      )}

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
};
