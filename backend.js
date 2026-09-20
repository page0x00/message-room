import { missingSchema, normalizeMessage } from "./core.js?v=2.0.0-20260920";

// This is the project's public browser key, never a service-role secret.
const URL = "https://yuzgbxeprpohlakxjcut.supabase.co";
const KEY = "sb_publishable_qB-zsA_IpH-Pab0rJJ4_YA_Pos792yq";
const PAGE_SIZE = 100;
let signedClient, legacyClient;

function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  return fetch(url, { ...options, signal }).finally(() => clearTimeout(timer));
}

export function client(secure) {
  if (!window.supabase) throw new Error("Supabase SDK not loaded");
  const options = { global: { fetch: timedFetch } };
  if (secure)
    return (signedClient ||= window.supabase.createClient(URL, KEY, options));
  return (legacyClient ||= window.supabase.createClient(URL, KEY, {
    ...options,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "mailbox-public-client",
    },
  }));
}

export async function authenticate() {
  const sb = client(true);
  const session = await sb.auth.getSession();
  if (session.error) throw session.error;
  if (session.data.session) return session.data.session.user.id;
  const result = await sb.auth.signInAnonymously();
  if (result.error) throw result.error;
  if (!result.data.user) throw new Error("No authenticated identity");
  return result.data.user.id;
}

export async function createRoom(name) {
  const userId = await authenticate();
  const result = await client(true).rpc("mailbox_create_room", {
    p_display_name: name,
  });
  if (result.error) throw result.error;
  return {
    room: result.data.room_id,
    invite: result.data.invite,
    secure: true,
    userId,
  };
}

export async function joinRoom(room, invite) {
  const userId = await authenticate();
  const result = await client(true).rpc("mailbox_join_room", {
    p_room_id: room,
    p_invite: invite || "",
  });
  if (result.error) throw result.error;
  return { userId };
}

export async function members(room) {
  const result = await client(true)
    .from("room_members")
    .select("user_id,display_name,avatar_data,joined_at")
    .eq("room_id", room);
  if (result.error) throw result.error;
  return result.data || [];
}

export async function saveMember(room, userId, profile) {
  const result = await client(true)
    .from("room_members")
    .update({
      display_name: profile.myName,
      avatar_data: profile.myAvatar || null,
    })
    .eq("room_id", room)
    .eq("user_id", userId)
    .select("user_id")
    .single();
  if (result.error) throw result.error;
}

export async function metadataSupported(room, secure) {
  if (secure) return true;
  const result = await client(false)
    .from("messages")
    .select("display_date,reply_to")
    .eq("room_id", room)
    .limit(0);
  if (result.error && !missingSchema(result.error)) throw result.error;
  return !result.error;
}

export async function loadMessages(room, secure, before) {
  let query = client(secure)
    .from("messages")
    .select("*")
    .eq("room_id", room)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);
  if (before) {
    // Preserve PostgreSQL microseconds; rounding to JS milliseconds can skip rows.
    const stamp = String(before.created_at);
    if (
      !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) ||
      !Number.isFinite(Date.parse(stamp))
    )
      throw new Error("Invalid timestamp cursor");
    if (!/^[A-Za-z0-9-]+$/.test(String(before.id)))
      throw new Error("Invalid cursor");
    query = query.or(
      `created_at.lt.${stamp},and(created_at.eq.${stamp},id.lt.${before.id})`,
    );
  }
  const result = await query;
  if (result.error) throw result.error;
  return {
    rows: (result.data || []).map(normalizeMessage),
    hasMore: (result.data || []).length === PAGE_SIZE,
  };
}

export async function sendMessage(row, secure) {
  const sb = client(secure);
  const result = await sb.from("messages").insert(row).select().single();
  if (!result.error) return normalizeMessage(result.data);
  // A response can be lost after INSERT committed. Retry with the same nonce;
  // the unique index prevents a second message, then we retrieve the first.
  if (secure && result.error.code === "23505") {
    const existing = await sb
      .from("messages")
      .select("*")
      .eq("room_id", row.room_id)
      .eq("author_id", row.author_id)
      .eq("client_nonce", row.client_nonce)
      .single();
    if (!existing.error) return normalizeMessage(existing.data);
  }
  throw result.error;
}

export async function editDisplayDate(room, id, date) {
  const result = await client(true)
    .from("messages")
    .update({ display_date: date || null })
    .eq("room_id", room)
    .eq("id", id)
    .select()
    .single();
  if (result.error) throw result.error;
  return normalizeMessage(result.data);
}

export function subscribe(room, secure, onMessage, onMembers, onStatus) {
  const sb = client(secure);
  let channel = sb
    .channel("mailbox-" + room + "-" + crypto.randomUUID())
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "messages",
        filter: "room_id=eq." + room,
      },
      onMessage,
    );
  if (secure)
    channel = channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_members",
        filter: "room_id=eq." + room,
      },
      onMembers,
    );
  channel.subscribe(onStatus);
  return () => {
    void sb.removeChannel(channel);
  };
}
