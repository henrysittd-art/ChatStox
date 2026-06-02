import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../config/firebase';
import { onAuthStateChanged, signOut as firebaseSignOut, updateProfile as firebaseUpdateProfile } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const AuthContext = createContext(null);

// Separate key so a single AsyncStorage.getItem('onboarding_complete') is fast
const ONBOARDING_KEY = 'onboarding_complete';

function mapUser(firebaseUser) {
  if (!firebaseUser) return null;
  const displayName = firebaseUser.displayName || '';
  const [first = '', ...rest] = displayName.split(' ');
  const last = rest.join(' ');
  return {
    id:         firebaseUser.uid,
    email:      firebaseUser.email,
    firstName:  first,
    lastName:   last,
    traderType: '',
    authMethod: 'email',
  };
}

function mapProfile(docData) {
  if (!docData) return null;
  return {
    traderType:         docData.traderType    || docData.trader_type || '',
    sectors:            docData.sectors        || '',
    likesPennyStocks:   docData.likesPennyStocks ?? docData.likes_penny_stocks ?? null,
    riskTolerance:      docData.riskTolerance || docData.risk_tolerance || '',
    capitalRange:       docData.capitalRange  || docData.capital_range || '',
    language:           docData.language       || 'en',
    // !! for explicit boolean — guards against null/0/'false' from DB
    onboardingComplete: !!(docData.onboardingComplete ?? docData.onboarding_complete),
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
      const docRef = doc(db, 'profiles', userId);
      const docSnap = await getDoc(docRef);

      let mapped = null;
      if (docSnap.exists()) {
        console.log('[AuthContext] Firebase profile raw:', docSnap.data());
        mapped = mapProfile(docSnap.data());
      } else {
        console.log('[AuthContext] Profile does not exist yet in Firestore.');
      }

      // Firestore is authoritative, but if it returned no row or onboarding=false,
      // cross-check AsyncStorage — a previous Firestore write may have silently failed.
      if (!mapped?.onboardingComplete) {
        const cached = await AsyncStorage.getItem(ONBOARDING_KEY).catch(() => null);
        if (cached === 'true') {
          console.log('[AuthContext] onboarding_complete not in Firestore — restoring from AsyncStorage backup');
          mapped = mapped
            ? { ...mapped, onboardingComplete: true }
            : { traderType: '', sectors: '', likesPennyStocks: null,
                riskTolerance: '', capitalRange: '', language: 'en',
                onboardingComplete: true };
        }
      }

      setProfile(mapped);
      if (mapped) {
        await persistToStorage(mapped);
      }
    } catch (e) {
      console.warn('[AuthContext] loadProfile unexpected error:', e.message);
      // On total Firestore failure, fall back to AsyncStorage so user isn't stuck
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
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        const u = mapUser(firebaseUser);
        setProfileLoading(true);
        setUser(u);
        loadProfile(u.id);
      } else {
        setUser(null);
        setProfile(null);
        setProfileLoading(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const saveProfile = async (data) => {
    if (!user?.id) {
      throw new Error('[AuthContext] saveProfile: no authenticated user id');
    }
    const docRef = doc(db, 'profiles', user.id);
    await setDoc(docRef, data, { merge: true });
    
    profileLoadedRef.current = false; // allow reload after intentional save
    await loadProfile(user.id);
  };

  const signOut = async () => {
    profileLoadedRef.current = false; // reset so next login can load fresh profile
    await firebaseSignOut(auth);
    setUser(null);
    setProfile(null);
    await AsyncStorage.multiRemove(['userProfile', ONBOARDING_KEY]).catch(() => {});
  };

  const updateProfile = async (updates) => {
    if (auth.currentUser) {
      await firebaseUpdateProfile(auth.currentUser, {
        displayName: `${updates.firstName || ''} ${updates.lastName || ''}`.trim()
      });
      setUser(mapUser(auth.currentUser));
    }
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
