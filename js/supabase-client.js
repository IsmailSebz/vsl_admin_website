// ══════════════════════════════════════
//  SHARED SUPABASE CLIENT — Victoria Sugar Admin
//
//  Uses ONLY the public anon key. Every read/write goes through the
//  Row Level Security policies already defined on the database:
//    - any logged-in ("authenticated") admin can read/write all content
//    - the public (anon) can only read published/active rows
//  There is no service-role key in this app anymore — it never
//  belongs in browser-shipped code, since anyone can view page source
//  and use it to bypass RLS entirely.
//
//  Loaded before login.html's inline script and before app.js, both of
//  which use the `db` client defined here.
// ══════════════════════════════════════

const SUPABASE_URL = 'https://ffsddbbtgoxbqlrnvcrm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmc2RkYmJ0Z294YnFscm52Y3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NDEzMTQsImV4cCI6MjA5ODIxNzMxNH0.EYNEFQqUR7ZV63XCHKo_RuS2tIJRxN1VfF6Tx3BAb3I';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
