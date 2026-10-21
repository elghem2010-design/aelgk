import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { UserRole, UserProfile } from '../types';
import {
  signInWithPassword as apiSignInWithPassword,
  signUpWithPassword as apiSignUpWithPassword,
  signInWithOtp as apiSignInWithOtp,
  verifyOtp as apiVerifyOtp,
  signOut as apiSignOut,
  fetchUserProfile,
  fetchUserRoles,
  isUserAuthorizedForRole,
  AuthResult,
} from '../services/authService';

export interface DemoPersona {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  nationalIdMasked?: string;
  role: UserRole;
  roles: UserRole[];
  descriptionAr: string;
}

export const DEMO_PERSONAS: Record<UserRole, DemoPersona> = {
  customer: {
    id: 'cust-demo-1',
    fullName: 'طارق عبد السلام',
    phone: '+201228419022',
    email: 'tarek.patient@example.com',
    nationalIdMasked: '289•••••••1042',
    role: 'customer',
    roles: ['customer'],
    descriptionAr: 'مريض مسجل — طلب الأدوية، تتبع التوصيل، وقبول البدائل العلاجية',
  },
  pharmacy_staff: {
    id: 'user-pharm-01',
    fullName: 'د. منى الشناوي',
    phone: '+201001234567',
    email: 'mona.pharmacist@al-nour.com',
    nationalIdMasked: '292•••••••5531',
    role: 'pharmacy_staff',
    roles: ['pharmacy_staff', 'customer'],
    descriptionAr: 'صيدلي مسؤول (صيدلية النور - المعادي) — مراجعة الروشتات، تأكيد الأسعار والبدائل',
  },
  courier: {
    id: 'user-cour-01',
    fullName: 'أحمد محمود رضوان',
    phone: '+201112345678',
    email: 'ahmed.courier@fastdelivery.eg',
    nationalIdMasked: '295•••••••8912',
    role: 'courier',
    roles: ['courier', 'customer'],
    descriptionAr: 'مندوب توصيل معتمد (دراجة نارية) — استلام الأدوية المغلقة والتسليم الموثق',
  },
  admin: {
    id: 'user-admin-01',
    fullName: 'م. مريم كمال',
    phone: '+201099887766',
    email: 'admin.supervision@elajx.eg',
    nationalIdMasked: '288•••••••0019',
    role: 'admin',
    roles: ['admin', 'pharmacy_staff', 'courier', 'customer'],
    descriptionAr: 'مسؤول رقابي — اعتماد الصيدليات والمناديب والرقابة الصيدلانية',
  },
};

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  roles: UserRole[];
  activeRole: UserRole;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSupabaseConnected: boolean;
  isDemoMode: boolean;
  loginWithPassword: (identifier: string, password: string) => Promise<AuthResult>;
  signUpWithPassword: (identifier: string, password: string, fullName: string, role?: UserRole) => Promise<AuthResult>;
  loginWithOtp: (identifier: string) => Promise<AuthResult>;
  verifyOtp: (identifier: string, token: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  switchActiveRole: (role: UserRole) => boolean;
  loginAsDemo: (role: UserRole) => void;
  hasAccessToRole: (requiredRole: UserRole) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_STORAGE_DEMO_KEY = 'elajx_demo_user_role';

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>(['customer']);
  const [activeRole, setActiveRole] = useState<UserRole>('customer');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(!isSupabaseConfigured);

  // Initialize Auth state
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      if (isSupabaseConfigured && supabase) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user && mounted) {
            setUser(session.user);
            setIsDemoMode(false);
            
            // Fetch live profile & roles from PostgreSQL
            const userProfile = await fetchUserProfile(session.user.id);
            const userRoles = await fetchUserRoles(session.user.id);
            
            if (mounted) {
              setProfile(userProfile || {
                id: session.user.id,
                fullName: session.user.user_metadata?.full_name || 'مستخدم مسجل',
                phone: session.user.phone || '',
                email: session.user.email || '',
                role: userRoles[0] || 'customer',
                createdAt: session.user.created_at || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
              const validRoles: UserRole[] = userRoles.length > 0 ? userRoles : ['customer'];
              setRoles(validRoles);
              setActiveRole(validRoles[0]);
            }
          } else if (mounted) {
            // Restore demo persona if previously chosen in offline mode
            restoreDemoPersona();
          }
        } catch (err) {
          console.warn('[ElajX Auth] Session check error:', err);
          if (mounted) restoreDemoPersona();
        }
      } else {
        // Unconfigured Supabase environment: default to clean demo state
        if (mounted) {
          restoreDemoPersona();
        }
      }

      if (mounted) {
        setIsLoading(false);
      }
    }

    function restoreDemoPersona() {
      const savedRole = localStorage.getItem(LOCAL_STORAGE_DEMO_KEY) as UserRole | null;
      const initialRole: UserRole = savedRole && DEMO_PERSONAS[savedRole] ? savedRole : 'customer';
      applyDemoPersona(initialRole);
    }

    initAuth();

    // Setup live Supabase Auth listener if configured
    let authListener: { subscription: { unsubscribe: () => void } } | null = null;
    if (isSupabaseConfigured && supabase) {
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!mounted) return;
        if (session?.user) {
          setUser(session.user);
          setIsDemoMode(false);
          const [uProfile, uRoles] = await Promise.all([
            fetchUserProfile(session.user.id),
            fetchUserRoles(session.user.id),
          ]);
          if (mounted) {
            setProfile(uProfile || {
              id: session.user.id,
              fullName: session.user.user_metadata?.full_name || 'مستخدم مسجل',
              phone: session.user.phone || '',
              email: session.user.email || '',
              role: uRoles[0] || 'customer',
              createdAt: session.user.created_at || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            const validRoles: UserRole[] = uRoles.length > 0 ? uRoles : ['customer'];
            setRoles(validRoles);
            setActiveRole(validRoles[0]);
          }
        } else {
          setUser(null);
          restoreDemoPersona();
        }
      });
      authListener = data;
    }

    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, []);

  function applyDemoPersona(role: UserRole) {
    const persona = DEMO_PERSONAS[role] || DEMO_PERSONAS.customer;
    setUser(null);
    setProfile({
      id: persona.id,
      fullName: persona.fullName,
      phone: persona.phone,
      email: persona.email,
      nationalIdMasked: persona.nationalIdMasked,
      role: persona.role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setRoles(persona.roles);
    setActiveRole(persona.role);
    setIsDemoMode(true);
    localStorage.setItem(LOCAL_STORAGE_DEMO_KEY, role);
  }

  const loginWithPassword = async (identifier: string, password: string): Promise<AuthResult> => {
    setIsLoading(true);
    const result = await apiSignInWithPassword(identifier, password);
    setIsLoading(false);
    return result;
  };

  const signUpWithPassword = async (
    identifier: string,
    password: string,
    fullName: string,
    role: UserRole = 'customer'
  ): Promise<AuthResult> => {
    setIsLoading(true);
    const result = await apiSignUpWithPassword(identifier, password, fullName, role);
    setIsLoading(false);
    return result;
  };

  const loginWithOtp = async (identifier: string): Promise<AuthResult> => {
    setIsLoading(true);
    const result = await apiSignInWithOtp(identifier);
    setIsLoading(false);
    return result;
  };

  const verifyOtp = async (identifier: string, token: string): Promise<AuthResult> => {
    setIsLoading(true);
    const result = await apiVerifyOtp(identifier, token);
    setIsLoading(false);
    return result;
  };

  const logout = async (): Promise<void> => {
    setIsLoading(true);
    if (isSupabaseConfigured && supabase) {
      await apiSignOut();
    }
    // Reset to default customer demo persona
    applyDemoPersona('customer');
    setIsLoading(false);
  };

  const switchActiveRole = (newRole: UserRole): boolean => {
    // Check if user has permission for this role
    if (roles.includes('admin') || roles.includes(newRole) || isDemoMode) {
      setActiveRole(newRole);
      if (isDemoMode && DEMO_PERSONAS[newRole]) {
        applyDemoPersona(newRole);
      }
      return true;
    }
    return false;
  };

  const loginAsDemo = (demoRole: UserRole) => {
    applyDemoPersona(demoRole);
  };

  const hasAccessToRole = (requiredRole: UserRole): boolean => {
    return isUserAuthorizedForRole(roles, requiredRole);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        roles,
        activeRole,
        isLoading,
        isAuthenticated: !!user || (isDemoMode && !!profile),
        isSupabaseConnected: isSupabaseConfigured && !!supabase,
        isDemoMode,
        loginWithPassword,
        signUpWithPassword,
        loginWithOtp,
        verifyOtp,
        logout,
        switchActiveRole,
        loginAsDemo,
        hasAccessToRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
