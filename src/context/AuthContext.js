import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';

const AuthContext = createContext(null);

// Maps Supabase auth user → app user shape
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

// Maps Supabase profiles row → camelCase for use in the app / AI prompt
function mapProfile(row) {
  if (!row) return null;
  return {
    traderType:         row.trader_type    || '',
    sectors:            row.sectors        || '',
    likesPennyStocks:   row.likes_penny_stocks ?? null,
    riskTolerance:      row.risk_tolerance || '',
    capitalRange:       row.capital_range  || '',
    language:           row.language       || 'en',
    onboardingComplete: row.onboarding_complete ?? false,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null);
  const [profile, setProfile]         = useState(null);
  const [loading, setLoading]         = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  // Load Supabase profile row and sync to AsyncStorage so chat screens can read it
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
        // PGRST116 = row not found (new user, not an error)
        console.warn('[AuthContext] profiles fetch error:', error.message);
      }

      const mapped = mapProfile(data);
      setProfile(mapped);

      // Write to AsyncStorage so existing chat-screen logic still works
      if (mapped) {
        await AsyncStorage.setItem('userProfile', JSON.stringify({
          traderType:       mapped.traderType,
          sectors:          mapped.sectors,
          likesPennyStocks: mapped.likesPennyStocks,
          riskTolerance:    mapped.riskTolerance,
          capitalRange:     mapped.capitalRange,
          language:         mapped.language,
        })).catch(() => {});
      }
    } catch (e) {
      console.warn('[AuthContext] loadProfile unexpected error:', e.message);
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
      setUser(u);
      if (u?.id) loadProfile(u.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Upsert profile row to Supabase + refresh local state
  const saveProfile = async (data) => {
    if (!user?.id) return;
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: user.id, ...data }, { onConflict: 'id' });
    if (error) throw error;
    await loadProfile(user.id);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    await AsyncStorage.removeItem('userProfile').catch(() => {});
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
