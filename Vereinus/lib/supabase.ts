import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Prefer values provided via app.config.js -> extra
const extra = (Constants as any).expoConfig?.extra || (Constants as any).manifest?.extra || {};
const DEFAULT_URL = 'https://jeruntnmpdiijlqkfpfr.supabase.co';
const DEFAULT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplcnVudG5tcGRpaWpscWtmcGZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA1MjAyOTUsImV4cCI6MjA3NjA5NjI5NX0.6s-8etdG2YALLnnq7ob8W0bw7sZj3_LsOU2UWXr4MyE';
const url = (extra.EXPO_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || DEFAULT_URL) as string | undefined;
const anon = (extra.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_ANON) as string | undefined;

// CHANGE: treat any non-empty url as valid (do not compare against DEFAULT_URL)
const isPlaceholderProject = !url;
const usingFallback = !url || !anon || isPlaceholderProject;
export const supabaseUsingFallback = usingFallback;

if (usingFallback) {
  // Avoid throwing at import time -- provide a minimal fallback client so the app can render.
  // eslint-disable-next-line no-console
  console.warn('[Supabase] Missing or placeholder Supabase config. Set EXPO_PUBLIC_SUPABASE_URL/EXPO_PUBLIC_SUPABASE_ANON_KEY via app.config.js or env. Using offline stub client.');
}

// Debug logs to confirm runtime values (remove or gate in production if desired)
try {
  // eslint-disable-next-line no-console
  console.log('[Supabase] runtime config:', {
    url: url ?? '<undefined>',
    anon_present: !!anon,
    isPlaceholderProject,
    usingFallback,
  });
} catch (e) {
  // ignore logging errors
}

function buildFallback() {
  const chain = () => {
    const makePromise = <T>(data: T) => {
      const p = Promise.resolve({ data, error: null } as any);
      return Object.assign(p, {
        select: async () => ({ data, error: null } as any),
      });
    };
    return {
      select: async () => ({ data: [], error: null } as any),
      insert: async () => ({ data: null, error: null } as any),
      upsert: (_payload: any) => makePromise(null),
      delete: () => chain(),
      eq: () => chain(),
      in: () => chain(),
      order: () => chain(),
      is: () => chain(),
      single: async () => ({ data: null, error: null } as any),
    };
  };
  return {
    auth: {
      async getSession() { return { data: { session: null }, error: null } as any; },
      onAuthStateChange(_cb: any) { return { data: { subscription: { unsubscribe() {} } } } as any; },
      async signInWithPassword(_c: any) { return { data: null, error: new Error('Supabase not configured') } as any; },
      async signUp(_c: any) { return { data: null, error: new Error('Supabase not configured') } as any; },
      async signOut() { return { error: null } as any; },
    },
    from() { return chain() as any; },
  } as any;
}

export const supabase = (!usingFallback && url && anon)
  ? createClient(url, anon, {
      auth: {
        storage: AsyncStorage as any,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : buildFallback();

export type Org = { id: string; name: string; logo_url: string | null };
export type Group = { id: string; org_id: string; name: string; image_url: string | null };
export type OrgRole = 'director' | 'teacher' | 'student';
export type Announcement = {
  id: string;
  org_id: string;
  group_id: string | null;
  author_id: string | null;
  title: string;
  body: string | null;
  event_date: string | null; // ISO date (YYYY-MM-DD)
  created_at: string;
};
