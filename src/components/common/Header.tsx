import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { DatabaseStatusNotice } from './DatabaseStatusNotice';
import { UserMenu } from './UserMenu';
import { Shield, Menu, X, Users, Building2, Bike, ShieldAlert } from 'lucide-react';

interface HeaderProps {
  currentRole: string;
}

export const Header: React.FC<HeaderProps> = ({ currentRole }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-xs border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 h-16">
          {/* Zone 1: Single text wordmark & Mobile Menu Trigger */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 -mr-2 text-slate-600 hover:text-slate-900 focus:outline-hidden"
              aria-label="تبديل القائمة"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <NavLink
              to="/"
              className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 hover:text-emerald-700 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-bold text-base shadow-xs">
                ع
              </div>
              <span className="font-semibold text-slate-900">علاجك</span>
              <span className="text-xs text-slate-400 font-normal">| ElajX</span>
            </NavLink>
          </div>

          {/* Zone 2: 4 concise single-line portal links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <NavLink
              to="/customer"
              className={({ isActive }) =>
                `whitespace-nowrap shrink-0 py-1 transition-colors ${
                  isActive ? 'text-emerald-700 font-semibold border-b-2 border-emerald-600' : 'hover:text-slate-900'
                }`
              }
            >
              بوابة المرضى
            </NavLink>
            <NavLink
              to="/pharmacy"
              className={({ isActive }) =>
                `whitespace-nowrap shrink-0 py-1 transition-colors ${
                  isActive ? 'text-emerald-700 font-semibold border-b-2 border-emerald-600' : 'hover:text-slate-900'
                }`
              }
            >
              بوابة الصيدليات
            </NavLink>
            <NavLink
              to="/courier"
              className={({ isActive }) =>
                `whitespace-nowrap shrink-0 py-1 transition-colors ${
                  isActive ? 'text-emerald-700 font-semibold border-b-2 border-emerald-600' : 'hover:text-slate-900'
                }`
              }
            >
              بوابة المناديب
            </NavLink>
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `whitespace-nowrap shrink-0 py-1 transition-colors ${
                  isActive ? 'text-emerald-700 font-semibold border-b-2 border-emerald-600' : 'hover:text-slate-900'
                }`
              }
            >
              الإدارة الرقابية
            </NavLink>
          </nav>

          {/* Zone 3: Database status & user session menu */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <Shield className="w-3.5 h-3.5 text-emerald-600" />
              <span>مطابق لهيئة الدواء المصرية</span>
            </div>
            <DatabaseStatusNotice />
            <UserMenu />
          </div>
        </div>

        {/* Mobile Dropdown Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden py-3 border-t border-slate-100 space-y-1">
            <NavLink
              to="/customer"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700 hover:bg-slate-50'
                }`
              }
            >
              <Users className="w-4 h-4 text-emerald-600" />
              <span>بوابة المرضى (طلب الأدوية والبدائل)</span>
            </NavLink>
            <NavLink
              to="/pharmacy"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700 hover:bg-slate-50'
                }`
              }
            >
              <Building2 className="w-4 h-4 text-emerald-600" />
              <span>بوابة الصيدليات المرخصة (الطلبات والتغليف)</span>
            </NavLink>
            <NavLink
              to="/courier"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700 hover:bg-slate-50'
                }`
              }
            >
              <Bike className="w-4 h-4 text-emerald-600" />
              <span>بوابة المناديب والتوصيل (التسليم ورمز OTP)</span>
            </NavLink>
            <NavLink
              to="/admin"
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700 hover:bg-slate-50'
                }`
              }
            >
              <ShieldAlert className="w-4 h-4 text-emerald-600" />
              <span>لوحة الإدارة والرقابة التشغيلية</span>
            </NavLink>
          </div>
        )}
      </div>
    </header>
  );
};
