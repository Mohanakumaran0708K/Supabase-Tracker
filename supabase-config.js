/* ─────────────────────────────────────────────────────────────
   supabase-config.js  –  Supabase Client Setup
   ─────────────────────────────────────────────────────────────
   STEP 1: Go to https://supabase.com → your project
   STEP 2: Click Settings (gear icon) → API
   STEP 3: Copy "Project URL" and "anon public" key below
   ───────────────────────────────────────────────────────────── */

const SUPABASE_URL = "https://qkniutmyivpnijcsldte.supabase.co";       // e.g. https://xyz.supabase.co
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrbml1dG15aXZwbmlqY3NsZHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODM0MzIsImV4cCI6MjA5MDk1OTQzMn0.D1VEfGMgYw46IDR0DyNb8osH3SDbqMCpdVoKp9hnQ9A";  // starts with eyJ...
// ── Auto-detect whether keys have been filled in ─────────────
const SUPABASE_ENABLED = (
  SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20
);

// ── Initialize Supabase client (only when keys are set) ──────
let sb = null;
if (SUPABASE_ENABLED) {
  try {
    const { createClient } = supabase; // loaded from CDN
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.info('[Tracker] ✅ Supabase connected');
  } catch (err) {
    console.error('[Tracker] Supabase init error:', err.message);
  }
} else {
  console.info('[Tracker] 📴 Running in offline / localStorage mode. Add your Supabase keys to enable cloud sync.');
}
