import { createClient } from '@supabase/supabase-js';

function requireEnv(name) {
  const value = process.env[name] ?? '';
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const supabaseUrl = requireEnv('SUPABASE_URL');
const supabaseSecretKey = requireEnv('SUPABASE_SECRET_KEY');

export const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
