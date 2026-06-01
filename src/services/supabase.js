import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://thumuhchvtbxpxekljip.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nxalWuGbjSqqftk6KNuf8A_HReveFwV';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
