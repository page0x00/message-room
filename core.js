// Pure view/model helpers. Legacy device identifiers never authorize database access.
export const ROOM_PATTERN = /^[A-Za-z0-9_-]{4,100}$/;
export const SECURE_PREFIX = "v2_";

export function parseRoom(value) {
  const input = String(value || "").trim();
  if (!input) return null;
  let room = input,
    invite = "";
  try {
    if (/^https?:\/\//i.test(input)) {
      const url = new URL(input);
      room = url.searchParams.get("room") || "";
      invite = new URLSearchParams(url.hash.slice(1)).get("key") || "";
    }
  } catch {
    return null;
  }
  if (!ROOM_PATTERN.test(room) || (invite && !/^[a-f0-9]{64}$/.test(invite)))
    return null;
  return { room, invite, secure: room.startsWith(SECURE_PREFIX) };
}

export function roomLink(base, room, invite = "") {
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", room);
  if (invite) url.hash = new URLSearchParams({ key: invite }).toString();
  return url.toString();
}

export function randomId() {
  return crypto.randomUUID();
}
export function legacyRoom() {
  return "r_" + randomId().replaceAll("-", "");
}

export function localDate(input = new Date()) {
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function displayDay(message, view) {
  return view !== "chat" && validDate(message.display_date)
    ? message.display_date
    : localDate(message.created_at);
}

export function isMine(message, identity) {
  if (message.author_id) return message.author_id === identity.userId;
  return Boolean(identity.deviceId && message.sender === identity.deviceId);
}

export function normalizeMessage(row) {
  return {
    ...row,
    id: String(row.id),
    content: String(row.content || ""),
    reply_to: Array.isArray(row.reply_to)
      ? row.reply_to.slice(0, 8).map(String)
      : [],
  };
}

export function mergeMessages(current, incoming) {
  const byId = new Map(current.map((m) => [String(m.id), normalizeMessage(m)]));
  for (const row of incoming) byId.set(String(row.id), normalizeMessage(row));
  return [...byId.values()].sort(compareCreated);
}

function timestampKey(value) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return 0n;
  const fraction = String(value).match(/\.(\d+)/)?.[1] || "";
  return (
    BigInt(milliseconds) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3, 6))
  );
}

export function compareCreated(a, b) {
  const left = timestampKey(a.created_at),
    right = timestampKey(b.created_at);
  return left < right ? -1 : left > right ? 1 : compareIds(a.id, b.id);
}

export function compareIds(a, b) {
  if (/^\d+$/.test(a) && /^\d+$/.test(b))
    return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
  return String(a).localeCompare(String(b));
}

export function projectMessages(messages, view) {
  if (view === "chat") return [...messages];
  return [...messages].sort(
    (a, b) =>
      displayDay(a, view).localeCompare(displayDay(b, view)) ||
      compareCreated(a, b),
  );
}

export function safeAvatar(value) {
  return typeof value === "string" &&
    value.length <= 60000 &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : "";
}

export function missingSchema(error) {
  return [
    "PGRST202",
    "PGRST204",
    "PGRST205",
    "42P01",
    "42703",
    "42883",
  ].includes(error?.code);
}

export function errorText(error) {
  if (error?.code === "42501")
    return "没有访问权限。请检查邀请链接及数据库权限。";
  if (missingSchema(error)) return "数据库尚未升级，请按 SETUP.md 执行迁移。";
  if (error?.status === 429 || error?.code === "over_request_rate_limit")
    return "请求太频繁，请稍后再试。";
  if (/anonymous.*disabled/i.test(error?.message || ""))
    return "尚未启用 Supabase 匿名登录。";
  if (/captcha/i.test(error?.message || ""))
    return "登录需要验证码，当前页面尚未配置验证码组件。";
  return "连接失败，请检查网络后重试。";
}

export function storeGet(key, fallback) {
  try {
    const value = localStorage.getItem("mailbox." + key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function storeSet(key, value) {
  try {
    localStorage.setItem("mailbox." + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
