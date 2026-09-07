import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    "VITE_SUPABASE_URL en/of VITE_SUPABASE_ANON_KEY ontbreken. Zie .env.example."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
