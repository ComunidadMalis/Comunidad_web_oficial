const SUPABASE_URL = 'https://hzxpqqtqkslirhzxdwey.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_QZFcMcXzfqbq9KGH9BGE7g_6q4kS-a2';

let SESION_PERSISTE = true;
const almacen = (() => {
  try {
    const k = '__prueba';
    window.localStorage.setItem(k, k);
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    SESION_PERSISTE = false;
    const m = {};
    return {
      getItem: (k) => (k in m ? m[k] : null),
      setItem: (k, v) => { m[k] = String(v); },
      removeItem: (k) => { delete m[k]; }
    };
  }
})();

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storage: almacen }
});

const ADMIN_EMAIL = 'omali.rm08@gmail.com';
const RANGOS = [
  { min: 20000, nombre: 'Gran Maestro' },
  { min: 5000, nombre: 'Heroico' },
  { min: 1000, nombre: 'Platino' },
  { min: 0, nombre: 'Bronce' }
];

const rangoDe = (pts) => RANGOS.find((r) => pts >= r.min).nombre;
const emailDe = (usuario) => `${usuario.replace(/\s+/g, '').toLowerCase()}@comunidad-malis.app`;

function banderaDe(codigo) {
  if (!codigo || codigo.length !== 2) return '🌎';
  return String.fromCodePoint(...[...codigo.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

async function detectarPais() {
  try {
    const r = await fetch('https://ipapi.co/json/');
    const j = await r.json();
    return j.country_code || 'MX';
  } catch {
    return 'MX';
  }
}

async function registrar(usuario, clave) {
  const email = emailDe(usuario);
  clave = clave.trim();
  let { data, error } = await db.auth.signUp({ email, password: clave });
  if (error && /already/i.test(error.message)) {
    const r = await db.auth.signInWithPassword({ email, password: clave });
    if (r.error) throw new Error('usuario_existe');
    data = r.data;
    const { data: previo } = await db.from('profiles').select('id').eq('id', data.user.id).maybeSingle();
    if (previo) throw new Error('usuario_existe');
  } else if (error) {
    throw error;
  }
  if (!data.session) throw new Error('confirmacion_email');
  const pais = await detectarPais();
  const { error: e2 } = await db.from('profiles').insert({
    id: data.user.id, username: usuario.trim(), country: pais, flag: banderaDe(pais)
  });
  if (e2) {
    if (e2.code === '23505') {
      const { data: propio } = await db.from('profiles').select('id').eq('id', data.user.id).maybeSingle();
      if (propio) return;
      await db.auth.signOut();
      throw new Error('usuario_existe');
    }
    await db.auth.signOut();
    throw e2;
  }
}

async function entrar(usuario, clave) {
  const email = emailDe(usuario);
  let { error } = await db.auth.signInWithPassword({ email, password: clave });
  if (error && /invalid login/i.test(error.message) && clave !== clave.trim()) {
    ({ error } = await db.auth.signInWithPassword({ email, password: clave.trim() }));
  }
  if (error) throw error;
}

const salir = () => db.auth.signOut();
const entrarConGoogle = () =>
  db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href } });

async function crearPerfilFaltante(user) {
  const base = (user.email || '').split('@')[0] || 'usuario';
  const pais = await detectarPais();
  for (const nombre of [base, base + Math.floor(100 + Math.random() * 900)]) {
    const { error } = await db.from('profiles').insert({
      id: user.id, username: nombre, country: pais, flag: banderaDe(pais)
    });
    if (!error) break;
  }
  const { data } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
  return data;
}

async function miPerfil() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  await db.rpc('revisar_vencimiento');
  let { data } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!data) data = await crearPerfilFaltante(user);
  if (data && data.banned) {
    await db.auth.signOut();
    alert('Tu cuenta fue bloqueada por incumplir las reglas de la comunidad.');
    return null;
  }
  if (data && !(data.role === 'Premium' && new Date(data.premium_until) > new Date())) data.role = 'Base';
  if (data && user.email === ADMIN_EMAIL) data.role = 'Premium';
  return data;
}

const esAdmin = async () => {
  const { data: { user } } = await db.auth.getUser();
  return !!user && user.email === ADMIN_EMAIL;
};

const cargarPosts = () => db.from('posts').select('*').order('created_at', { ascending: false }).limit(50);
const cargarTop = (pais) => {
  let q = db.from('profiles').select('username,flag,country,points,owned,role,premium_until,avatar_url').order('points', { ascending: false }).limit(20);
  if (pais) q = q.eq('country', pais);
  return q;
};

const darLike = (id) => db.rpc('dar_like', { p_post: id });
const girar = (pagado) => db.rpc('girar_ruleta', { p_pagado: pagado });
const responderDin = (v) => db.rpc('responder_dinamica', { p_resp: v });
const confirmarPago = (orderId, producto) => db.functions.invoke('paypal-confirm', { body: { orderId, producto } });
const unirseFila = (vip) => db.rpc('unirse_fila', { p_vip: vip });
const comprarCosmetico = (item) => db.rpc('comprar_cosmetico', { p_item: item });
const pedirSerMod = async (id) => db.from('mod_requests').insert({ user_id: id });
const borrarComentario = (id) => db.from('comments').delete().eq('id', id);

function escucharSettings(cb) {
  db.from('settings').select('*').eq('id', 1).single().then(({ data }) => data && cb(data));
  return db.channel('settings-live')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'settings' }, (p) => cb(p.new))
    .subscribe();
}

const ganadoresDin = (ronda) =>
  db.from('din_ganadores').select('created_at, profiles(username,flag)').eq('ronda', ronda).order('created_at');
