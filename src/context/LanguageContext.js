import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from './AuthContext';

const LanguageContext = createContext({ lang: 'en', setLang: () => {} });

export function LanguageProvider({ children }) {
  const { user, profile } = useAuth();
  const [lang, setLangLocal] = useState('en');

  // Sync from loaded profile (covers app-start restore)
  useEffect(() => {
    if (profile?.language) setLangLocal(profile.language);
  }, [profile?.language]);

  const setLang = async (newLang) => {
    setLangLocal(newLang);
    if (user?.id) {
      try {
        await supabase
          .from('profiles')
          .upsert({ id: user.id, language: newLang }, { onConflict: 'id' });
      } catch (_) { /* non-fatal */ }
    }
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
