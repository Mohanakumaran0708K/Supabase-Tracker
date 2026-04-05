/* ─────────────────────────────────────────────────────────────
   auth.js  –  Supabase Authentication
   Handles: login, signup, logout, session persistence,
            offline fallback, and loading state
   ───────────────────────────────────────────────────────────── */

/* ── Helpers ─────────────────────────────────────────────────── */
const showLoading = (on) => {
  const el = document.getElementById('loading-screen');
  if (el) el.style.display = on ? 'flex' : 'none';
};

const showAuth = (on) => {
  const authEl = document.getElementById('auth-ov');
  const appEl  = document.getElementById('app');
  if (authEl) authEl.style.display = on ? 'flex' : 'none';
  if (appEl)  appEl.style.display  = on ? 'none' : 'flex';
};

const authMsg = (msg, type = 'err') => {
  const el = document.getElementById('auth-msg');
  if (!el) return;
  el.textContent = msg;
  el.className   = type === 'ok' ? 'auth-ok' : type === '' ? '' : 'auth-err';
};

/* ── Tab switching: Login ↔ Sign Up ──────────────────────────── */
const setAuthTab = (tab) => {
  document.querySelectorAll('.auth-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  const lf = document.getElementById('login-form-el');
  const sf = document.getElementById('signup-form-el');
  if (lf) lf.style.display = tab === 'login'  ? 'flex' : 'none';
  if (sf) sf.style.display = tab === 'signup' ? 'flex' : 'none';
  authMsg('', '');
};

/* ── Login ───────────────────────────────────────────────────── */
const handleLogin = async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-pw').value;
  const btn   = document.getElementById('login-btn');
  if (!email || !pw) { authMsg('Please fill in both fields.'); return; }

  btn.disabled    = true;
  btn.textContent = 'Logging in…';
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  btn.disabled    = false;
  btn.textContent = '🔑 Log In';

  if (error) {
    authMsg(error.message === 'Invalid login credentials'
      ? 'Incorrect email or password.' : error.message);
  }
  // On success, onAuthStateChange → SIGNED_IN fires automatically
};

/* ── Sign Up ─────────────────────────────────────────────────── */
const handleSignup = async (e) => {
  e.preventDefault();
  const email = document.getElementById('signup-email').value.trim();
  const pw    = document.getElementById('signup-pw').value;
  const pw2   = document.getElementById('signup-pw2').value;
  const btn   = document.getElementById('signup-btn');

  if (!email || !pw)   { authMsg('Please fill in all fields.'); return; }
  if (pw !== pw2)       { authMsg('Passwords do not match.'); return; }
  if (pw.length < 6)    { authMsg('Password must be at least 6 characters.'); return; }

  btn.disabled    = true;
  btn.textContent = 'Creating account…';
  const { error } = await sb.auth.signUp({ email, password: pw });
  btn.disabled    = false;
  btn.textContent = '🚀 Create Account';

  if (error) { authMsg(error.message); return; }
  authMsg('✅ Account created! Check your email to verify, then log in.', 'ok');
};

/* ── Logout ──────────────────────────────────────────────────── */
const handleLogout = async () => {
  if (!confirm('Log out of Progress Tracker?')) return;
  if (realtimeChannel && sb) sb.removeChannel(realtimeChannel);
  await sb.auth.signOut();
  currentUser = null;
  tasks = []; streak = { count: 0, lastDate: null };
  showAuth(true);
};

/* ── User is signed in ───────────────────────────────────────── */
const onSignedIn = async (session) => {
  currentUser = { id: session.user.id, email: session.user.email };
  const dEl = document.getElementById('user-email-disp');
  if (dEl) dEl.textContent = session.user.email.charAt(0).toUpperCase();

  const ppEmail = document.getElementById('pp-email');
  if (ppEmail) ppEmail.textContent = session.user.email;
  const ppInit = document.getElementById('pp-initial');
  if (ppInit) ppInit.textContent = session.user.email.charAt(0).toUpperCase();
  showAuth(false);
  showLoading(true);
  await loadDataFromSupabase();
  showLoading(false);
  appStart();
  subscribeRealtime();
};

/* ── Offline / No Supabase fallback ─────────────────────────── */
const startOffline = () => {
  showAuth(false);
  load();   // from app.js – reads localStorage
  seed();   // from app.js – demo tasks for first-time users
  appStart();
};

/* ── Main auth initialiser (called on DOMContentLoaded) ─────── */
const initAuth = async () => {
  // No Supabase keys → run offline immediately
  if (!SUPABASE_ENABLED || !sb) {
    showLoading(false);
    startOffline();
    return;
  }

  showLoading(true);

  // Check for an existing session (user already logged in)
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await onSignedIn(session);
  } else {
    showLoading(false);
    showAuth(true);
  }

  // Listen for login / logout events
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session && !currentUser) {
      await onSignedIn(session);
    } else if (event === 'SIGNED_OUT') {
      showAuth(true);
    }
  });

  // Bind form / tab events
  document.getElementById('login-form-el') ?.addEventListener('submit', handleLogin);
  document.getElementById('signup-form-el')?.addEventListener('submit', handleSignup);
  
  // Profile Popup toggling
  document.getElementById('logout-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('profile-popup')?.classList.toggle('active');
  });
  window.addEventListener('click', e => {
    if (!e.target.closest('#profile-popup') && !e.target.closest('#logout-btn')) {
      document.getElementById('profile-popup')?.classList.remove('active');
    }
  });

  // Logout binding
  document.getElementById('pp-signout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('sec-logout-btn')?.addEventListener('click',  handleLogout);
  document.querySelectorAll('.auth-tab').forEach(t =>
    t.addEventListener('click', () => setAuthTab(t.dataset.tab)));
};

document.addEventListener('DOMContentLoaded', initAuth);
