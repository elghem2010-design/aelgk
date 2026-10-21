/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { Header } from './components/common/Header';
import { CustomerPortal } from './components/customer/CustomerPortal';
import { PharmacyPortal } from './components/pharmacy/PharmacyPortal';
import { CourierPortal } from './components/courier/CourierPortal';
import { AdminPortal } from './components/admin/AdminPortal';
import { AuthProvider } from './contexts/AuthContext';
import { RoleProtectedRoute } from './components/common/RoleProtectedRoute';
import { Shield, HeartHandshake, PhoneCall, FileText } from 'lucide-react';

const PortalContainer: React.FC = () => {
  const location = useLocation();

  const getPortalTitle = () => {
    if (location.pathname.startsWith('/pharmacy')) return 'بوابة الصيدليات المرخصة';
    if (location.pathname.startsWith('/courier')) return 'بوابة المناديب والتوصيل';
    if (location.pathname.startsWith('/admin')) return 'لوحة الإدارة والرقابة';
    return 'بوابة المرضى وطلب الأدوية';
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900" dir="rtl">
      {/* Top Header conforming to 3-zone contract */}
      <Header currentRole={location.pathname} />

      {/* Main Viewport Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Quick Portal Switcher Banner for Development & Evaluation */}
        <div className="mb-6 p-3 bg-white border border-slate-200 rounded-xl shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">البيئة الحالية:</span>
            <span className="font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              {getPortalTitle()}
            </span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="text-slate-500 ml-1">الانتقال السريع للبوابات:</span>
            <Link
              to="/customer"
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                location.pathname.startsWith('/customer') || location.pathname === '/'
                  ? 'bg-slate-900 text-white font-medium'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              المرضى
            </Link>
            <Link
              to="/pharmacy"
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                location.pathname.startsWith('/pharmacy')
                  ? 'bg-slate-900 text-white font-medium'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              الصيدليات
            </Link>
            <Link
              to="/courier"
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                location.pathname.startsWith('/courier')
                  ? 'bg-slate-900 text-white font-medium'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              المناديب
            </Link>
            <Link
              to="/admin"
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                location.pathname.startsWith('/admin')
                  ? 'bg-slate-900 text-white font-medium'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              الإدارة
            </Link>
          </div>
        </div>

        {/* Portal Routes with Sub-path Support & Role Guarding */}
        <Routes>
          <Route path="/" element={<CustomerPortal />} />
          <Route path="/customer" element={<CustomerPortal />} />
          <Route path="/customer/*" element={<CustomerPortal />} />

          <Route
            path="/pharmacy"
            element={
              <RoleProtectedRoute requiredRole="pharmacy_staff" portalNameAr="الصيدليات المرخصة">
                <PharmacyPortal />
              </RoleProtectedRoute>
            }
          />
          <Route
            path="/pharmacy/*"
            element={
              <RoleProtectedRoute requiredRole="pharmacy_staff" portalNameAr="الصيدليات المرخصة">
                <PharmacyPortal />
              </RoleProtectedRoute>
            }
          />

          <Route
            path="/courier"
            element={
              <RoleProtectedRoute requiredRole="courier" portalNameAr="المناديب والتوصيل">
                <CourierPortal />
              </RoleProtectedRoute>
            }
          />
          <Route
            path="/courier/*"
            element={
              <RoleProtectedRoute requiredRole="courier" portalNameAr="المناديب والتوصيل">
                <CourierPortal />
              </RoleProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <RoleProtectedRoute requiredRole="admin" portalNameAr="الإدارة والرقابة التشغيلية">
                <AdminPortal />
              </RoleProtectedRoute>
            }
          />
          <Route
            path="/admin/*"
            element={
              <RoleProtectedRoute requiredRole="admin" portalNameAr="الإدارة والرقابة التشغيلية">
                <AdminPortal />
              </RoleProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/customer" replace />} />
        </Routes>
      </main>

      {/* Clean Health-Tech Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-12 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">علاجك (ElajX)</span>
            <span>· منصة التنسيق والطلب الصيدلاني والتوصيل في جمهورية مصر العربية</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>جميع الأدوية تصرف بواسطة صيدليات مرخصة من وزارة الصحة ونقابة الصيادلة المصرية</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PortalContainer />
      </AuthProvider>
    </BrowserRouter>
  );
}
