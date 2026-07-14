import { supabase, ADMIN_UID } from "./supabase-config.js";

// وضعیت سراسری ورود کاربر — همان ساختار قبلی، فقط پشت‌صحنه با Supabase
export const authState = {
  user: null,
  role: null, // "admin" | "player" | null
  playerId: null,
  loading: true,
  listeners: []
};

export function onAuthChange(cb) {
  authState.listeners.push(cb);
  return () => {
    authState.listeners = authState.listeners.filter((l) => l !== cb);
  };
}

function notify() {
  authState.listeners.forEach((cb) => cb(authState));
}

async function resolveRole(user) {
  if (!user) {
    authState.role = null;
    authState.playerId = null;
    return;
  }

  if (ADMIN_UID && user.id === ADMIN_UID) {
    authState.role = "admin";
    authState.playerId = null;
    return;
  }

  try {
    const { data } = await supabase
      .from("player_links")
      .select("player_id")
      .eq("auth_uid", user.id)
      .maybeSingle();
    if (data) {
      authState.role = "player";
      authState.playerId = data.player_id;
    } else {
      authState.role = null;
      authState.playerId = null;
    }
  } catch {
    authState.role = null;
    authState.playerId = null;
  }
}

async function init() {
  const { data } = await supabase.auth.getSession();
  authState.user = data.session?.user || null;
  await resolveRole(authState.user);
  authState.loading = false;
  notify();
}
init();

supabase.auth.onAuthStateChange(async (_event, session) => {
  authState.user = session?.user || null;
  await resolveRole(authState.user);
  authState.loading = false;
  notify();
});

export async function login(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function logout() {
  await supabase.auth.signOut();
}
