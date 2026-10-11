const SUPABASE_URL = 'https://hzxpqqtqkslirhzxdwey.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_QZFcMcXzfqbq9KGH9BGE7g_6q4kS-a2';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage }
});

const ADMIN_EMAIL = 'omali.rm08@gmail.com';
const RANGOS = [
  { min: 20000, nombre: 'Gran Maestro' },
  { min: 5000, nombre: 'Heroico' },
  { min: 1000, nombre: 'Platino' },
  { min: 0, nombre: 'Bronce' }
];

const rangoDe = (pts) => RANGOS.find((r) => pts >= r.min).nombre;
const emailDe = (usuario) => `${usuario.trim().toLowerCase()}@comunidad-malis.app`;

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
  const { data, error } = await db.auth.signUp({ email: emailDe(usuario), password: clave });
  if (error) throw error;
  const pais = await detectarPais();
  const { error: e2 } = await db.from('profiles').insert({
    id: data.user.id, username: usuario.trim(), country: pais, flag: banderaDe(pais)
  });
  if (e2) throw e2;
}

async function entrar(usuario, clave) {
  const { error } = await db.auth.signInWithPassword({ email: emailDe(usuario), password: clave });
  if (error) throw error;
}

const salir = () => db.auth.signOut();
const entrarConGoogle = () =>
  db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href } });

async function miPerfil() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  await db.rpc('revisar_vencimiento');
  const { data } = await db.from('profiles').select('*').eq('id', user.id).single();
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
  let q = db.from('profiles').select('username,flag,country,points,owned').order('points', { ascending: false }).limit(20);
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
