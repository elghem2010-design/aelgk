import React from 'react';
import { AlertCircle, ShieldAlert } from 'lucide-react';

interface PrototypeNoticeBannerProps {
  portalName: string;
}

export const PrototypeNoticeBanner: React.FC<PrototypeNoticeBannerProps> = ({ portalName }) => {
  return (
    <div className="mb-6 bg-slate-900 text-slate-100 rounded-xl p-3.5 border border-slate-800 shadow-xs">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-start sm:items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
            <AlertCircle className="w-4 h-4" />
          </div>
          <div>
            <span className="font-semibold text-amber-400 ml-1.5">
              نموذج تجريبي تفاعلي ({portalName})
            </span>
            <span className="text-slate-300">
              البيانات المعروضة توضيحية للمسار التشغيلي. العمليات والتفاعلات تعمل على ذاكرة المتصفح ولا تمثل حالة موثقة بقاعدة البيانات الحية لحين اكتمال الربط الخادمي الآمن.
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded-md shrink-0 border border-slate-700/50">
          <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
          <span>عزل خادمي كامل (Zero Live DB Impact)</span>
        </div>
      </div>
    </div>
  );
};
