import React, { useState } from 'react';
import {
  X,
  Phone,
  Mail,
  Lock,
  User,
  Shield,
  CheckCircle2,
  AlertCircle,
  Building2,
  Bike,
  Sparkles,
  ArrowRight,
  KeyRound,
  RotateCw,
} from 'lucide-react';
import { useAuth, DEMO_PERSONAS } from '../../contexts/AuthContext';
import { UserRole } from '../../types';
import { normalizeEgyptianPhone, isValidEmail } from '../../services/authService';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultRole?: UserRole;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, defaultRole }) => {
  const {
    loginWithPassword,
    signUpWithPassword,
    loginWithOtp,
    verifyOtp,
    loginAsDemo,
    isSupabaseConnected,
    isDemoMode,
  } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup' | 'demo'>('signin');
  const [authMethod, setAuthMethod] = useState<'password' | 'otp'>('password');
  
  // Form fields
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>(defaultRole || 'customer');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // Status & error handling
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const resetMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (!identifier.trim()) {
      setErrorMessage('يرجى إدخال رقم الهاتف المصري أو البريد الإلكتروني');
      return;
    }

    if (authMethod === 'password') {
      if (!password) {
        setErrorMessage('يرجى إدخال كلمة المرور');
        return;
      }
      setLoading(true);
      const res = await loginWithPassword(identifier, password);
      setLoading(false);
      if (res.success) {
        setSuccessMessage('تم تسجيل الدخول بنجاح!');
        setTimeout(() => onClose(), 600);
      } else {
        setErrorMessage(res.error || 'فشل تسجيل الدخول');
      }
    } else {
      // OTP Method
      if (!otpSent) {
        setLoading(true);
        const res = await loginWithOtp(identifier);
        setLoading(false);
        if (res.success) {
          setOtpSent(true);
          setSuccessMessage('تم إرسال رمز التحقق في رسالة SMS.');
        } else {
          setErrorMessage(res.error || 'فشل إرسال رمز التحقق');
        }
      } else {
        if (!otpCode || otpCode.length < 6) {
          setErrorMessage('يرجى إدخال رمز التحقق المكون من 6 أرقام');
          return;
        }
        setLoading(true);
        const res = await verifyOtp(identifier, otpCode);
        setLoading(false);
        if (res.success) {
          setSuccessMessage('تم التحقق بنجاح وتأكيد الجلسة!');
          setTimeout(() => onClose(), 600);
        } else {
          setErrorMessage(res.error || 'رمز التحقق غير صحيح أو منتهي الصلاحية');
        }
      }
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (!fullName.trim() || fullName.trim().length < 3) {
      setErrorMessage('يرجى إدخال الاسم الثلاثي بالكامل (3 أحرف على الأقل)');
      return;
    }
    if (!identifier.trim()) {
      setErrorMessage('يرجى إدخال رقم هاتف مصري أو بريد إلكتروني');
      return;
    }
    if (!password || password.length < 6) {
      setErrorMessage('كلمة المرور يجب أن لا تقل عن 6 أحرف أو أرقام');
      return;
    }

    setLoading(true);
    const res = await signUpWithPassword(identifier, password, fullName, selectedRole);
    setLoading(false);

    if (res.success) {
      setSuccessMessage('تم إنشاء الحساب بنجاح! يمكنك الآن تسجيل الدخول.');
      setTimeout(() => {
        setMode('signin');
        resetMessages();
      }, 1000);
    } else {
      setErrorMessage(res.error || 'فشل إنشاء الحساب');
    }
  };

  const handleSelectDemoPersona = (role: UserRole) => {
    loginAsDemo(role);
    setSuccessMessage(`تم تسجيل الدخول بصفتك: ${DEMO_PERSONAS[role].fullName} (${DEMO_PERSONAS[role].descriptionAr})`);
    setTimeout(() => onClose(), 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs" dir="rtl">
      <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-200">
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-700 flex items-center justify-center text-white font-bold text-lg shadow-inner">
              ع
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-100">منصة علاجك (ElajX)</h3>
              <p className="text-xs text-slate-400">بوابة الدخول الموحدة والأمان الصيدلاني</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Database Connectivity Banner */}
        <div className={`px-5 py-2.5 text-xs flex items-center justify-between border-b ${
          isSupabaseConnected ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : 'bg-amber-50 text-amber-900 border-amber-200'
        }`}>
          <div className="flex items-center gap-1.5">
            {isSupabaseConnected ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-medium">متصل بقاعدة بيانات Supabase الحية</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>بيئة تجريبية معزولة — الحسابات التجريبية متاحة فوراً</span>
              </>
            )}
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/80 border border-slate-200">
            {isSupabaseConnected ? 'Live Auth' : 'Demo Mode'}
          </span>
        </div>

        {/* Nav Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 text-xs font-medium">
          <button
            onClick={() => { setMode('signin'); resetMessages(); }}
            className={`flex-1 py-3 text-center transition-colors cursor-pointer ${
              mode === 'signin'
                ? 'bg-white text-emerald-700 font-semibold border-b-2 border-emerald-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            تسجيل الدخول
          </button>
          <button
            onClick={() => { setMode('signup'); resetMessages(); }}
            className={`flex-1 py-3 text-center transition-colors cursor-pointer ${
              mode === 'signup'
                ? 'bg-white text-emerald-700 font-semibold border-b-2 border-emerald-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            إنشاء حساب جديد
          </button>
          <button
            onClick={() => { setMode('demo'); resetMessages(); }}
            className={`flex-1 py-3 text-center transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
              mode === 'demo'
                ? 'bg-white text-emerald-700 font-semibold border-b-2 border-emerald-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>حسابات تجريبية سريعة</span>
          </button>
        </div>

        {/* Alerts */}
        <div className="p-5 pb-0">
          {errorMessage && (
            <div className="p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>{errorMessage}</div>
            </div>
          )}
          {successMessage && (
            <div className="p-3 mb-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>{successMessage}</div>
            </div>
          )}
        </div>

        {/* Tab Content */}
        <div className="p-5 pt-3">
          {mode === 'signin' && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="flex bg-slate-100 p-1 rounded-lg text-xs font-medium">
                <button
                  type="button"
                  onClick={() => { setAuthMethod('password'); setOtpSent(false); resetMessages(); }}
                  className={`flex-1 py-1.5 rounded-md transition-colors ${
                    authMethod === 'password' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600'
                  }`}
                >
                  كلمة المرور
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthMethod('otp'); resetMessages(); }}
                  className={`flex-1 py-1.5 rounded-md transition-colors ${
                    authMethod === 'otp' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600'
                  }`}
                >
                  رمز التحقق (OTP للرقم المصري)
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  رقم الهاتف المصري أو البريد الإلكتروني:
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="01012345678 أو user@example.com"
                    dir="ltr"
                    className="w-full text-right px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                    disabled={loading || otpSent}
                  />
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  يدعم صيغ الهواتف المصرية (010 / 011 / 012 / 015) مع التحويل التلقائي لـ +20
                </p>
              </div>

              {authMethod === 'password' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    كلمة المرور:
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      dir="ltr"
                      className="w-full text-right px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                      disabled={loading}
                    />
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  </div>
                </div>
              )}

              {authMethod === 'otp' && otpSent && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    أدخل رمز التحقق (6 أرقام):
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="123456"
                      dir="ltr"
                      className="w-full text-center tracking-widest text-lg font-mono font-bold px-3.5 py-2.5 rounded-xl border border-emerald-500 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      disabled={loading}
                      autoFocus
                    />
                    <KeyRound className="w-4 h-4 text-emerald-600 absolute left-3 top-3" />
                  </div>
                  <div className="flex justify-between items-center mt-1.5 text-xs">
                    <span className="text-slate-500">تم إرسال الرمز لرقمك</span>
                    <button
                      type="button"
                      onClick={() => setOtpSent(false)}
                      className="text-emerald-700 hover:underline font-medium"
                    >
                      تغيير الرقم أو إعادة الإرسال
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <RotateCw className="w-4 h-4 animate-spin" />
                    <span>جارٍ المعالجة...</span>
                  </>
                ) : authMethod === 'otp' && !otpSent ? (
                  <span>إرسال رمز التحقق OTP</span>
                ) : (
                  <span>دخول إلى حسابي</span>
                )}
              </button>
            </form>
          )}

          {mode === 'signup' && (
            <form onSubmit={handleSignUp} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الاسم بالكامل:
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="مثال: د. طارق عبد السلام"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:border-emerald-600"
                    disabled={loading}
                  />
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  رقم الهاتف المصري أو البريد:
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="01012345678 أو email@example.com"
                    dir="ltr"
                    className="w-full text-right px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:border-emerald-600"
                    disabled={loading}
                  />
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  نوع الحساب المطلوب:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedRole('customer')}
                    className={`p-2 rounded-lg border text-xs text-center transition-colors cursor-pointer ${
                      selectedRole === 'customer'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    مريض / عميل
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedRole('pharmacy_staff')}
                    className={`p-2 rounded-lg border text-xs text-center transition-colors cursor-pointer ${
                      selectedRole === 'pharmacy_staff'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    صيدلي مرخص
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedRole('courier')}
                    className={`p-2 rounded-lg border text-xs text-center transition-colors cursor-pointer ${
                      selectedRole === 'courier'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    مندوب توصيل
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  حسابات الصيدليات والمناديب تتطلب مراجعة واعتماد الوثائق من الإدارة الرقابية.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  تعيين كلمة المرور:
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    dir="ltr"
                    className="w-full text-right px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:border-emerald-600"
                    disabled={loading}
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer mt-2"
              >
                {loading ? (
                  <>
                    <RotateCw className="w-4 h-4 animate-spin" />
                    <span>جارٍ إنشاء الحساب...</span>
                  </>
                ) : (
                  <span>تأكيد إنشاء الحساب</span>
                )}
              </button>
            </form>
          )}

          {mode === 'demo' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-600 mb-2">
                اختر إحدى الشخصيات النموذجية المجهزة لاختبار صلاحيات البوابات والتحقق من RLS وسياسات الأمان:
              </p>

              {(Object.keys(DEMO_PERSONAS) as UserRole[]).map((r) => {
                const persona = DEMO_PERSONAS[r];
                return (
                  <button
                    key={r}
                    onClick={() => handleSelectDemoPersona(r)}
                    className="w-full text-right p-3 rounded-xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/50 transition-all flex items-start justify-between gap-3 group cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-emerald-100 flex items-center justify-center text-slate-700 group-hover:text-emerald-700 shrink-0">
                        {r === 'customer' && <User className="w-4 h-4" />}
                        {r === 'pharmacy_staff' && <Building2 className="w-4 h-4" />}
                        {r === 'courier' && <Bike className="w-4 h-4" />}
                        {r === 'admin' && <Shield className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-slate-900">{persona.fullName}</span>
                          <span className="text-[10px] bg-slate-100 group-hover:bg-emerald-200/60 text-slate-700 px-1.5 py-0.5 rounded">
                            {r}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{persona.descriptionAr}</p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 shrink-0 mt-1 transform group-hover:-translate-x-1 transition-transform" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 px-5 py-3 border-t border-slate-200 text-center text-xs text-slate-500">
          <span>نظام مشفر ومطابق لضوابط حماية البيانات الصحية المصرية</span>
        </div>
      </div>
    </div>
  );
};
