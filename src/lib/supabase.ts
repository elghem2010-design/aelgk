import { createClient, SupabaseClient } from '@supabase/supabase-js';

const rawSupabaseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL);
const rawSupabaseAnonKey =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_ANON_KEY);

/**
 * Normalizes Supabase URL candidate. If candidate is a raw Supabase project reference
 * (e.g. 'sdrctrozoxiknscnsuuk'), expands it to https://[ref].supabase.co.
 */
export function resolveSupabaseUrl(candidate?: unknown): string | null {
  if (!candidate || typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (
    trimmed === '' ||
    trimmed === 'undefined' ||
    trimmed === 'null' ||
    trimmed.includes('your-project-id') ||
    trimmed.includes('placeholder') ||
    trimmed.includes('xyzcompany')
  ) {
    return null;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return trimmed;
      }
    } catch {
      return null;
    }
  }
  // Supabase project reference identifier
  if (/^[a-z0-9_-]+$/i.test(trimmed)) {
    return `https://${trimmed}.supabase.co`;
  }
  return null;
}

/**
 * Validates that candidate string is a well-formed HTTP or HTTPS URL
 * and not an empty placeholder or template variable.
 */
export function isValidHttpUrl(candidate?: unknown): boolean {
  const resolved = resolveSupabaseUrl(candidate);
  if (!resolved) return false;
  try {
    const parsed = new URL(resolved);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates that candidate string is a plausibly formatted API key
 * and not a short placeholder or boolean token.
 */
export function isValidApiKey(candidate?: unknown): boolean {
  if (!candidate || typeof candidate !== 'string') return false;
  const trimmed = candidate.trim();
  return (
    trimmed.length > 20 &&
    trimmed !== 'undefined' &&
    trimmed !== 'null' &&
    !trimmed.includes('placeholder') &&
    !trimmed.includes('your-anon-key')
  );
}

const resolvedSupabaseUrl = resolveSupabaseUrl(rawSupabaseUrl);
const isConfigured = isValidHttpUrl(resolvedSupabaseUrl) && isValidApiKey(rawSupabaseAnonKey);

export const isSupabaseConfigured: boolean = isConfigured;

function initializeSupabaseClient(): SupabaseClient | null {
  if (!isConfigured || !resolvedSupabaseUrl || !rawSupabaseAnonKey) {
    return null;
  }
  try {
    return createClient(resolvedSupabaseUrl, rawSupabaseAnonKey.trim(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (err) {
    console.warn('[ElajX] Failed to initialize Supabase client safely:', err);
    return null;
  }
}

/**
 * Singleton Supabase client instance.
 * Null when running in isolated prototype demonstration mode without valid credentials.
 */
export const supabase: SupabaseClient | null = initializeSupabaseClient();

export interface SupabaseConfigStatus {
  configured: boolean;
  missingVars: string[];
  urlPresent: boolean;
  anonKeyPresent: boolean;
}

export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  const missingVars: string[] = [];
  const urlValid = isValidHttpUrl(resolvedSupabaseUrl);
  const keyValid = isValidApiKey(rawSupabaseAnonKey);

  if (!urlValid) missingVars.push('VITE_SUPABASE_URL');
  if (!keyValid) missingVars.push('VITE_SUPABASE_ANON_KEY');

  return {
    configured: isSupabaseConfigured && supabase !== null,
    missingVars,
    urlPresent: urlValid,
    anonKeyPresent: keyValid,
  };
}
