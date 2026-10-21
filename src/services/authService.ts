import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { UserRole, UserProfile } from '../types';
import type { Session, User } from '@supabase/supabase-js';

/**
 * Normalizes Egyptian mobile phone numbers to E.164 international format (+20...).
 * Matches regex: ^\+?[0-9]{10,15}$ from baseline migration.
 */
export function normalizeEgyptianPhone(input: string): string | null {
  const cleaned = input.trim().replace(/[\s\-\(\)]/g, '');
  if (!cleaned) return null;

  // Case 1: Already has +20 prefix (+201012345678)
  if (/^\+201[0125][0-9]{8}$/.test(cleaned)) {
    return cleaned;
  }

  // Case 2: Starts with 0020 (00201012345678)
  if (/^00201[0125][0-9]{8}$/.test(cleaned)) {
    return `+${cleaned.substring(2)}`;
  }

  // Case 3: Local Egyptian number starting with 01 (01012345678)
  if (/^01[0125][0-9]{8}$/.test(cleaned)) {
    return `+20${cleaned.substring(1)}`;
  }

  // Generic fallback if valid international phone format
  if (/^\+[1-9][0-9]{9,14}$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

export interface AuthResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  isUnconfigured?: boolean;
}

/**
 * Signs in with email or Egyptian phone number and password.
 */
export async function signInWithPassword(
  identifier: string,
  password: string
): Promise<AuthResult<{ user: User; session: Session }>> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'الاتصال بقاعدة البيانات غير مهيأ حالياً. يرجى إعداد متغيرات البيئة في .env.local',
      isUnconfigured: true,
    };
  }

  const trimmed = identifier.trim();
  const normalizedPhone = normalizeEgyptianPhone(trimmed);
  const isEmail = isValidEmail(trimmed);

  try {
    let result;
    if (isEmail) {
      result = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
    } else if (normalizedPhone) {
      result = await supabase.auth.signInWithPassword({
        phone: normalizedPhone,
        password,
      });
    } else {
      return {
        success: false,
        error: 'يرجى إدخال بريد إلكتروني صالح أو رقم هاتف مصري صحيح (مثال: 01012345678)',
      };
    }

    if (result.error) {
      // Localize common Supabase Auth errors into Arabic
      let message = result.error.message;
      if (message.includes('Invalid login credentials')) {
        message = 'بيانات الدخول غير صحيحة. يرجى التأكد من البريد/الهاتف وكلمة المرور.';
      } else if (message.includes('Email not confirmed')) {
        message = 'البريد الإلكتروني لم يتم تأكيده بعد.';
      } else if (message.includes('Too many requests')) {
        message = 'تم تجاوز عدد محاولات الدخول المسموح بها. يرجى الانتظار والمحاولة لاحقاً.';
      }
      return { success: false, error: message };
    }

    if (!result.data.user || !result.data.session) {
      return { success: false, error: 'فشل في استرداد بيانات الجلسة.' };
    }

    return {
      success: true,
      data: {
        user: result.data.user,
        session: result.data.session,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء تسجيل الدخول.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Registers a new account with email or Egyptian phone number and password.
 */
export async function signUpWithPassword(
  identifier: string,
  password: string,
  fullName: string,
  role: UserRole = 'customer'
): Promise<AuthResult<{ user: User | null; session: Session | null }>> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'الاتصال بقاعدة البيانات غير مهيأ حالياً. يرجى إعداد متغيرات البيئة في .env.local',
      isUnconfigured: true,
    };
  }

  const trimmed = identifier.trim();
  const normalizedPhone = normalizeEgyptianPhone(trimmed);
  const isEmail = isValidEmail(trimmed);

  if (!fullName || fullName.trim().length < 3) {
    return {
      success: false,
      error: 'يرجى إدخال الاسم بالكامل (3 أحرف على الأقل).',
    };
  }

  if (!password || password.length < 6) {
    return {
      success: false,
      error: 'كلمة المرور يجب أن لا تقل عن 6 أحرف أو أرقام.',
    };
  }

  try {
    let result;
    if (isEmail) {
      result = await supabase.auth.signUp({
        email: trimmed,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            role,
          },
        },
      });
    } else if (normalizedPhone) {
      result = await supabase.auth.signUp({
        phone: normalizedPhone,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            role,
          },
        },
      });
    } else {
      return {
        success: false,
        error: 'يرجى إدخال بريد إلكتروني صالح أو رقم هاتف مصري صحيح (مثال: 01012345678)',
      };
    }

    if (result.error) {
      let message = result.error.message;
      if (message.includes('User already registered')) {
        message = 'هذا الحساب مسجل بالفعل، يرجى تسجيل الدخول.';
      } else if (message.includes('Password should be')) {
        message = 'كلمة المرور ضعيفة، يرجى استخدام كلمة مرور أقوى.';
      }
      return { success: false, error: message };
    }

    return {
      success: true,
      data: {
        user: result.data.user,
        session: result.data.session,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء إنشاء الحساب.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Initiates Account Login OTP (Preserving Option A: account authentication OTP).
 */
export async function signInWithOtp(identifier: string): Promise<AuthResult<void>> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'الاتصال بقاعدة البيانات غير مهيأ حالياً. يرجى إعداد متغيرات البيئة في .env.local',
      isUnconfigured: true,
    };
  }

  const trimmed = identifier.trim();
  const normalizedPhone = normalizeEgyptianPhone(trimmed);
  const isEmail = isValidEmail(trimmed);

  try {
    let result;
    if (isEmail) {
      result = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { shouldCreateUser: false },
      });
    } else if (normalizedPhone) {
      result = await supabase.auth.signInWithOtp({
        phone: normalizedPhone,
        options: { shouldCreateUser: false },
      });
    } else {
      return {
        success: false,
        error: 'يرجى إدخال رقم هاتف مصري مسجل (01xxxxxxxxx) أو بريد إلكتروني صالح.',
      };
    }

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'حدث خطأ أثناء إرسال رمز التحقق.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Verifies Account Login OTP for a phone or email.
 */
export async function verifyOtp(
  identifier: string,
  token: string
): Promise<AuthResult<{ user: User; session: Session }>> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'الاتصال بقاعدة البيانات غير مهيأ حالياً.',
      isUnconfigured: true,
    };
  }

  const trimmed = identifier.trim();
  const tokenClean = token.trim();
  const normalizedPhone = normalizeEgyptianPhone(trimmed);
  const isEmail = isValidEmail(trimmed);

  try {
    let result;
    if (isEmail) {
      result = await supabase.auth.verifyOtp({
        email: trimmed,
        token: tokenClean,
        type: 'email',
      });
    } else if (normalizedPhone) {
      result = await supabase.auth.verifyOtp({
        phone: normalizedPhone,
        token: tokenClean,
        type: 'sms',
      });
    } else {
      return { success: false, error: 'معرّف الحساب غير صالح.' };
    }

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    if (!result.data.user || !result.data.session) {
      return { success: false, error: 'رمز التحقق غير صحيح أو منتهي الصلاحية.' };
    }

    return {
      success: true,
      data: {
        user: result.data.user,
        session: result.data.session,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'حدث خطأ أثناء التحقق من رمز OTP.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Signs out current user and clears session tokens.
 */
export async function signOut(): Promise<AuthResult<void>> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: true };
  }
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.warn('[ElajX Auth] Sign out notice:', error.message);
    }
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'فشل تسجيل الخروج.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Fetches user profile from public.profiles table.
 */
export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  if (!isSupabaseConfigured || !supabase || !userId) {
    return null;
  }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, national_id_masked, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      fullName: data.full_name,
      phone: data.phone,
      nationalIdMasked: data.national_id_masked,
      role: 'customer', // default; actual roles fetched from user_roles
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches authorized roles from public.user_roles.
 * SECURITY INVARIANT: Roles are strictly derived from the database, never from client input.
 */
export async function fetchUserRoles(userId: string): Promise<UserRole[]> {
  if (!isSupabaseConfigured || !supabase || !userId) {
    return [];
  }
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

    if (error || !data || data.length === 0) {
      // Every authenticated user has at least customer role
      return ['customer'];
    }

    const roles = data.map((r) => r.role as UserRole);
    if (!roles.includes('customer')) {
      roles.push('customer');
    }
    return roles;
  } catch {
    return ['customer'];
  }
}

/**
 * Enforces role-based authorization hierarchy.
 * Fail-closed: returns false if roles are empty or requiredRole is not authorized.
 */
export function isUserAuthorizedForRole(
  userRoles: UserRole[],
  requiredRole: UserRole
): boolean {
  if (!userRoles || userRoles.length === 0) {
    return false;
  }

  // System administrator is authorized across all portals
  if (userRoles.includes('admin')) {
    return true;
  }

  // Exact role match
  if (userRoles.includes(requiredRole)) {
    return true;
  }

  // Customer portal is accessible to all authenticated users
  if (requiredRole === 'customer') {
    return true;
  }

  return false;
}
