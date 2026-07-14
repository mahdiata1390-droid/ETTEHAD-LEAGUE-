import { supabase } from "./supabase-config.js";

// ---------- نگاشت ردیف‌های Postgres (snake_case) به همان شکل قبلی (camelCase) ----------
function rowToTeam(r) {
  return { id: r.id, name: r.name, city: r.city, foundedYear: r.founded_year, logoUrl: r.logo_url, createdAt: r.created_at };
}
function rowToPlayer(r) {
  return {
    id: r.id, name: r.name, teamId: r.team_id, teamName: r.team_name,
    shirtNumber: r.shirt_number, position: r.position, photoUrl: r.photo_url,
    stats: r.stats || { matches: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0 },
    authUid: r.auth_uid, createdAt: r.created_at
  };
}
function rowToMatch(r) {
  return {
    id: r.id, homeTeamId: r.home_team_id, awayTeamId: r.away_team_id,
    homeTeamName: r.home_team_name, awayTeamName: r.away_team_name,
    homeTeamLogo: r.home_team_logo, awayTeamLogo: r.away_team_logo,
    date: r.date, time: r.time, venue: r.venue, status: r.status,
    homeScore: r.home_score, awayScore: r.away_score,
    goals: r.goals || [], cards: r.cards || [], lineup: r.lineup || [],
    manOfTheMatchId: r.man_of_the_match_id, manOfTheMatchName: r.man_of_the_match_name,
    createdAt: r.created_at
  };
}
function rowToNews(r) {
  return { id: r.id, title: r.title, body: r.body, imageUrl: r.image_url, type: r.type, createdAt: new Date(r.created_at).getTime() };
}

// ---------- آپلود تصویر (Supabase Storage) ----------
// امضای تابع مثل قبل است: uploadImage(file, "teams/12345-logo.png")
// بخش اول مسیر به‌عنوان نام باکت (teams/players/news) در نظر گرفته می‌شود.
export async function uploadImage(file, fullPath) {
  const [bucket, ...rest] = fullPath.split("/");
  const path = rest.join("/") || file.name;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteImage(fullPath) {
  const [bucket, ...rest] = fullPath.split("/");
  try { await supabase.storage.from(bucket).remove([rest.join("/")]); } catch { /* فایل وجود نداشت */ }
}

// ---------- تیم‌ها ----------
export function listenTeams(cb) {
  let active = true;
  async function fetchAndEmit() {
    const { data, error } = await supabase.from("teams").select("*").order("name");
    if (!error && active) cb((data || []).map(rowToTeam));
  }
  fetchAndEmit();
  const channel = supabase
    .channel("teams-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, fetchAndEmit)
    .subscribe();
  return () => { active = false; supabase.removeChannel(channel); };
}

export async function getTeam(id) {
  const { data, error } = await supabase.from("teams").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return rowToTeam(data);
}

export async function createTeam(data) {
  return supabase.from("teams").insert({
    name: data.name, city: data.city, founded_year: data.foundedYear ?? null, logo_url: data.logoUrl ?? null
  });
}
export async function updateTeam(id, data) {
  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.city !== undefined) patch.city = data.city;
  if (data.foundedYear !== undefined) patch.founded_year = data.foundedYear;
  if (data.logoUrl !== undefined) patch.logo_url = data.logoUrl;
  return supabase.from("teams").update(patch).eq("id", id);
}
export async function deleteTeam(id) {
  return supabase.from("teams").delete().eq("id", id);
}

// ---------- بازیکنان ----------
export function listenPlayers(cb, teamId) {
  let active = true;
  async function fetchAndEmit() {
    let query = supabase.from("players").select("*").order("name");
    if (teamId) query = query.eq("team_id", teamId);
    const { data, error } = await query;
    if (!error && active) cb((data || []).map(rowToPlayer));
  }
  fetchAndEmit();
  const channel = supabase
    .channel(`players-changes-${teamId || "all"}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "players" }, fetchAndEmit)
    .subscribe();
  return () => { active = false; supabase.removeChannel(channel); };
}

export async function getPlayer(id) {
  const { data, error } = await supabase.from("players").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return rowToPlayer(data);
}

const emptyStats = { matches: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0 };

export async function createPlayer(data) {
  return supabase.from("players").insert({
    name: data.name, team_id: data.teamId, team_name: data.teamName,
    shirt_number: data.shirtNumber, position: data.position, photo_url: data.photoUrl ?? null,
    stats: emptyStats
  });
}
export async function updatePlayer(id, data) {
  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.teamId !== undefined) patch.team_id = data.teamId;
  if (data.teamName !== undefined) patch.team_name = data.teamName;
  if (data.shirtNumber !== undefined) patch.shirt_number = data.shirtNumber;
  if (data.position !== undefined) patch.position = data.position;
  if (data.photoUrl !== undefined) patch.photo_url = data.photoUrl;
  return supabase.from("players").update(patch).eq("id", id);
}
export async function deletePlayer(id) {
  return supabase.from("players").delete().eq("id", id);
}

// ---------- اتصال حساب بازیکن ----------
export async function linkPlayerAccount(authUid, playerId) {
  await supabase.from("player_links").upsert({ auth_uid: authUid, player_id: playerId });
  await supabase.from("players").update({ auth_uid: authUid }).eq("id", playerId);
}
export async function unlinkPlayerAccount(authUid, playerId) {
  await supabase.from("player_links").delete().eq("auth_uid", authUid);
  await supabase.from("players").update({ auth_uid: null }).eq("id", playerId);
}
export async function getPlayerLink(authUid) {
  const { data } = await supabase.from("player_links").select("player_id").eq("auth_uid", authUid).maybeSingle();
  return data ? { playerId: data.player_id } : null;
}

// ---------- مسابقات ----------
export function listenMatches(cb) {
  let active = true;
  async function fetchAndEmit() {
    const { data, error } = await supabase.from("matches").select("*").order("date", { ascending: false });
    if (!error && active) cb((data || []).map(rowToMatch));
  }
  fetchAndEmit();
  const channel = supabase
    .channel("matches-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, fetchAndEmit)
    .subscribe();
  return () => { active = false; supabase.removeChannel(channel); };
}

export async function getMatch(id) {
  const { data, error } = await supabase.from("matches").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return rowToMatch(data);
}

export async function createMatch(data) {
  return supabase.from("matches").insert({
    home_team_id: data.homeTeamId, away_team_id: data.awayTeamId,
    home_team_name: data.homeTeamName, away_team_name: data.awayTeamName,
    home_team_logo: data.homeTeamLogo ?? null, away_team_logo: data.awayTeamLogo ?? null,
    date: data.date, time: data.time, venue: data.venue ?? null,
    status: "scheduled", goals: [], cards: [], lineup: []
  });
}
export async function updateMatchSchedule(id, data) {
  const patch = {};
  if (data.status !== undefined) patch.status = data.status;
  if (data.date !== undefined) patch.date = data.date;
  if (data.time !== undefined) patch.time = data.time;
  if (data.venue !== undefined) patch.venue = data.venue;
  return supabase.from("matches").update(patch).eq("id", id);
}
export async function deleteMatch(id) {
  return supabase.from("matches").delete().eq("id", id);
}

/**
 * ثبت/ویرایش نتیجه‌ی مسابقه. کل منطق (برگرداندن آمار قبلی در صورت ویرایش، اعمال
 * آمار جدید، شمارش تعداد بازی از روی lineup) داخل یک تابع Postgres اتمیک
 * به نام submit_match_result اجرا می‌شود (فایل supabase-schema.sql را ببینید).
 */
export async function submitMatchResult(matchId, result) {
  const { error } = await supabase.rpc("submit_match_result", {
    p_match_id: matchId,
    p_home_score: result.homeScore,
    p_away_score: result.awayScore,
    p_goals: result.goals || [],
    p_cards: result.cards || [],
    p_lineup: result.lineup || [],
    p_motm_id: result.manOfTheMatchId || null,
    p_motm_name: result.manOfTheMatchName || null
  });
  if (error) throw error;
}

// ---------- اخبار ----------
export function listenNews(cb) {
  let active = true;
  async function fetchAndEmit() {
    const { data, error } = await supabase.from("news").select("*").order("created_at", { ascending: false });
    if (!error && active) cb((data || []).map(rowToNews));
  }
  fetchAndEmit();
  const channel = supabase
    .channel("news-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "news" }, fetchAndEmit)
    .subscribe();
  return () => { active = false; supabase.removeChannel(channel); };
}
export async function createNews(data) {
  return supabase.from("news").insert({
    title: data.title, body: data.body, image_url: data.imageUrl ?? null, type: data.type
  });
}
export async function deleteNews(id) {
  return supabase.from("news").delete().eq("id", id);
}
