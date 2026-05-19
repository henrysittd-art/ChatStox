import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';

const AuthContext = createContext(null);

// Separate key so a single AsyncStorage.getItem('onboarding_complete') is fast
const ONBOARDING_KEY = 'onboarding_complete';

function mapUser(supabaseUser) {
  if (!supabaseUser) return null;
  const meta = supabaseUser.user_metadata || {};
  return {
    id:         supabaseUser.id,
    email:      supabaseUser.email,
    firstName:  meta.firstName  || '',
    lastName:   meta.lastName   || '',
    traderType: meta.traderType || '',
    authMethod: meta.authMethod || 'email',
  };
}

function mapProfile(row) {
  if (!row) return null;
  return {
    traderType:         row.trader_type    || '',
    sectors:            row.sectors        || '',
    likesPennyStocks:   row.likes_penny_stocks ?? null,
    riskTolerance:      row.risk_tolerance || '',
    capitalRange:       row.capital_range  || '',
    language:           row.language       || 'en',
    // !! for explicit boolean — guards against null/0/'false' from DB
    onboardingComplete: !!row.onboarding_complete,
  };
}

// Writes profile + separate onboarding flag to AsyncStorage
async function persistToStorage(mapped) {
  if (!mapped) return;
  try {
    await AsyncStorage.setItem('userProfile', JSON.stringify({
      traderType:         mapped.traderType,
      sectors:            mapped.sectors,
      likesPennyStocks:   mapped.likesPennyStocks,
      riskTolerance:      mapped.riskTolerance,
      capitalRange:       mapped.capitalRange,
      language:           mapped.language,
      onboardingComplete: mapped.onboardingComplete,
    }));
    // Fast key: once true, stays true (cleared only on signOut)
    if (mapped.onboardingComplete) {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    }
  } catch (_) {}
}

export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null);
  const [profile, setProfile]         = useState(null);
  const [loading, setLoading]         = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  // Guard: loadProfile runs once per session. Reset on sign-out or explicit reload.
  const profileLoadedRef = useRef(false);

  const loadProfile = async (userId) => {
    if (profileLoadedRef.current) {
      setProfileLoading(false); // caller may have set this — don't leave it stuck
      return;
    }
    profileLoadedRef.current = true;
    if (!userId) { setProfile(null); setProfileLoading(false); return; }
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = row not found (new user), everything else is unexpected
        console.warn('[AuthContext] profiles fetch error:', error.message);
      }

      console.log('[AuthContext] Supabase profile raw:', data);
      let mapped = mapProfile(data);

      // Supabase is authoritative, but if it returned no row or onboarding=false,
      // cross-check AsyncStorage — a previous Supabase write may have silently failed.
      if (!mapped?.onboardingComplete) {
        const cached = await AsyncStorage.getItem(ONBOARDING_KEY).catch(() => null);
        if (cached === 'true') {
          console.log('[AuthContext] onboarding_complete not in Supabase — restoring from AsyncStorage backup');
          mapped = mapped
            ? { ...mapped, onboardingComplete: true }
            : { traderType: '', sectors: '', likesPennyStocks: null,
                riskTolerance: '', capitalRange: '', language: 'en',
                onboardingComplete: true };
        }
      }

      setProfile(mapped);
      await persistToStorage(mapped);
    } catch (e) {
      console.warn('[AuthContext] loadProfile unexpected error:', e.message);
      // On total Supabase failure, fall back to AsyncStorage so user isn't stuck
      try {
        const cached = await AsyncStorage.getItem(ONBOARDING_KEY);
        if (cached === 'true') {
          const rawProfile = await AsyncStorage.getItem('userProfile');
          const stored = rawProfile ? JSON.parse(rawProfile) : {};
          setProfile({
            traderType:         stored.traderType        || '',
            sectors:            stored.sectors           || '',
            likesPennyStocks:   stored.likesPennyStocks  ?? null,
            riskTolerance:      stored.riskTolerance     || '',
            capitalRange:       stored.capitalRange      || '',
            language:           stored.language          || 'en',
            onboardingComplete: true,
          });
        }
      } catch (_) {}
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = mapUser(session?.user ?? null);
      setUser(u);
      if (u?.id) {
        loadProfile(u.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Only handle real auth transitions — SIGNED_IN (new login) and SIGNED_OUT (logout).
      // INITIAL_SESSION is already handled by getSession() above.
      // TOKEN_REFRESHED and USER_UPDATED must be ignored: they fire silently in the
      // background and calling setUser/loadProfile on them resets the Stack navigator
      // to its initial route, causing the auto-redirect-to-Home bug.
      if (event === 'SIGNED_IN') {
        const u = mapUser(session?.user ?? null);
        if (u?.id) setProfileLoading(true);
        setUser(u);
        if (u?.id) loadProfile(u.id);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setProfileLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const saveProfile = async (data) => {
    if (!user?.id) {
      throw new Error('[AuthContext] saveProfile: no authenticated user id');
    }
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: user.id, ...data }, { onConflict: 'id' });
    if (error) {
      console.error('[AuthContext] saveProfile upsert error:', error.message, error.code);
      throw error;
    }
    profileLoadedRef.current = false; // allow reload after intentional save
    await loadProfile(user.id);
  };

  const signOut = async () => {
    profileLoadedRef.current = false; // reset so next login can load fresh profile
    await supabase.auth.signOut();
    setProfile(null);
    await AsyncStorage.multiRemove(['userProfile', ONBOARDING_KEY]).catch(() => {});
  };

  const updateProfile = async (updates) => {
    const { data, error } = await supabase.auth.updateUser({ data: updates });
    if (error) throw error;
    setUser(mapUser(data.user));
  };

  // Explicit reload — resets the guard so callers (e.g. OnboardingScreen after save)
  // can force a fresh fetch without the background-event guard blocking them.
  const reloadProfile = () => {
    profileLoadedRef.current = false;
    return loadProfile(user?.id);
  };

  return (
    <AuthContext.Provider value={{
      user, profile, loading, profileLoading,
      signOut, updateProfile, saveProfile, reloadProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
