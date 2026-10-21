import React, { useState } from 'react';
import { Database, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { getSupabaseConfigStatus } from '../../lib/supabase';

export const DatabaseStatusNotice: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const status = getSupabaseConfigStatus();

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer text-slate-700 bg-white border-slate-300 hover:bg-slate-50"
        title="حالة اتصال قاعدة البيانات"
      >
        <Database className={`w-3.5 h-3.5 ${status.configured ? 'text-emerald-600' : 'text-amber-600'}`} />
        <span className="whitespace-nowrap">
          {status.configured ? 'قاعدة البيانات: متصلة' : 'بيئة تجريبية معزولة'}
        </span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-200 text-right">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 text-sm font-semibold rounded-md cursor-pointer"
              >
                إغلاق ✕
              </button>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900 text-base">حالة بيئة البيانات والتشغيل</h3>
                <Database className="w-5 h-5 text-emerald-700" />
              </div>
            </div>

            <div className="mt-4 space-y-4 text-sm text-slate-600 leading-relaxed">
              {status.configured ? (
                <div className="flex items-start gap-3 p-3 bg-emerald-50 text-emerald-900 rounded-lg border border-emerald-200">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-emerald-950">تم الاتصال بمشروع Supabase بنجاح</p>
                    <p className="text-xs text-emerald-800 mt-1">تطبيق ElajX متصل بقاعدة بيانات PostgreSQL الحية.</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-3 bg-amber-50 text-amber-900 rounded-lg border border-amber-200">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-950">وضع المحاكاة التجريبية (Prototype Demonstration Mode)</p>
                    <p className="text-xs text-amber-800 mt-1">
                      يعمل التطبيق حالياً بنماذج محاكاة تفاعلية محلية معزولة تماماً. لا توجد أي اتصالات نشطة بقواعد بيانات خارجية لحماية البيانات، ويتم عزل العمليات التجريبية داخل المتصفح.
                    </p>
                  </div>
                </div>
              )}

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-2">
                <p className="font-semibold text-slate-800">ضوابط السلامة المطبقة:</p>
                <ul className="list-disc list-inside space-y-1 text-slate-600">
                  <li>عدم تمرير أي بيانات حساسة أو مفاتيح سرية للواجهة الأمامية.</li>
                  <li>عزل البوابات الأربع تفاعلياً بدون منح صلاحيات برمجية غير موثقة.</li>
                  <li>تنفيذ التحقق من الصلاحيات عبر سياسات RLS الخادمية فقط عند التفعيل.</li>
                </ul>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700 space-y-1.5">
                <p className="font-semibold text-slate-900">جاهزية الترحيل وسياسات الأمان (PostgreSQL):</p>
                <p>تم تصميم سياسات أمان مستوى الصفوف (RLS) ودوال فحص الصلاحيات داخل ملف الترحيل المعتمد:</p>
                <code className="text-emerald-700 font-mono text-[11px] block mt-1">supabase/migrations/20261019000001_initial_schema.sql</code>
                <p className="text-slate-500 mt-1">يتم التحقق من الصلاحيات والتحويلات الخادمية بشكل مستقل عبر بيئة اختبارات معزولة.</p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
