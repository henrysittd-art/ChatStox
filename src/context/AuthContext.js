import React, { createContext, useContext, useState, useEffect } from 'react';
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

  const loadProfile = async (userId) => {
    if (!userId) { setProfile(null); return; }
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = mapUser(session?.user ?? null);
      // Set profileLoading BEFORE setUser so both land in the same render —
      // prevents App.js from seeing user!=null + profile==null and flashing Onboarding.
      if (u?.id) setProfileLoading(true);
      setUser(u);
      if (u?.id) loadProfile(u.id);
      else { setProfile(null); setProfileLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  const saveProfile = async (data) => {
    if (!user?.id) {
      // Throw so callers know the write failed — never silently no-op
      throw new Error('[AuthContext] saveProfile: no authenticated user id');
    }
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: user.id, ...data }, { onConflict: 'id' });
    if (error) {
      console.error('[AuthContext] saveProfile upsert error:', error.message, error.code);
      throw error;
    }
    await loadProfile(user.id);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    await AsyncStorage.multiRemove(['userProfile', ONBOARDING_KEY]).catch(() => {});
  };

  const updateProfile = async (updates) => {
    const { data, error } = await supabase.auth.updateUser({ data: updates });
    if (error) throw error;
    setUser(mapUser(data.user));
  };

  return (
    <AuthContext.Provider value={{
      user, profile, loading, profileLoading,
      signOut, updateProfile, saveProfile,
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
