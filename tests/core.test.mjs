import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRoom,
  roomLink,
  validDate,
  localDate,
  isMine,
  normalizeMessage,
  mergeMessages,
  projectMessages,
  safeAvatar,
  missingSchema,
  storeGet,
  storeSet,
  compareIds,
} from "../core.js";

test("legacy links preserve case and secure keys are parsed from fragments", () => {
  assert.deepEqual(parseRoom("AbCD5678"), {
    room: "AbCD5678",
    invite: "",
    secure: false,
  });
  const key = "a".repeat(64);
  assert.deepEqual(
    parseRoom("https://site.test/folder/?room=v2_abcd#key=" + key),
    { room: "v2_abcd", invite: key, secure: true },
  );
});
test("invalid room IDs, filters, URLs and tokens are rejected", () => {
  for (const input of [
    "",
    "x",
    "abc),room_id.neq.x",
    "<script>",
    "../abcd",
    "https://x.test/?room=abc%26",
    "javascript:alert(1)",
    "https://x.test/?room=v2_abcd#key=nope",
  ])
    assert.equal(parseRoom(input), null);
});
test("share link retains GitHub Pages subpath, removes tracking and keeps secret in fragment", () => {
  const link = roomLink(
    "https://example.test/message-room/?utm_x=foo#old",
    "v2_abcd",
    "b".repeat(64),
  );
  assert.equal(new URL(link).pathname, "/message-room/");
  assert.equal(new URL(link).search, "?room=v2_abcd");
  assert.equal(new URL(link).hash, "#key=" + "b".repeat(64));
});
test("calendar dates validate leap days without normalizing invalid dates", () => {
  assert.ok(validDate("2024-02-29"));
  for (const bad of ["2025-02-29", "2024-13-01", "2024-04-31", "9/4", "", null])
    assert.equal(validDate(bad), false);
  assert.equal(localDate("invalid"), "");
});
test("ownership prefers authenticated author; device/name cannot spoof it", () => {
  const identity = { userId: "auth1", deviceId: "local1" };
  assert.ok(isMine({ author_id: "auth1", sender: "other" }, identity));
  assert.equal(
    isMine({ author_id: "auth2", sender: "local1" }, identity),
    false,
  );
  assert.ok(isMine({ sender: "local1" }, identity));
  assert.equal(isMine({ sender: "nickname" }, identity), false);
});
const row = (id, date, content = "内容") => ({
  id,
  content,
  created_at: date,
  room_id: "ABCD",
  sender: "device",
});
test("read and realtime snapshots deduplicate and maintain stable order", () => {
  const date = "2026-09-20T12:00:00.000Z";
  const merged = mergeMessages(
    [row(2, date, "old"), row(10, date)],
    [row(2, date, "new"), row(1, date)],
  );
  assert.deepEqual(
    merged.map((m) => m.id),
    ["1", "2", "10"],
  );
  assert.equal(merged[1].content, "new");
  assert.equal(compareIds("9007199254740992", "9007199254740993"), -1);
});
test("views are projections; display date never changes chat order or source records", () => {
  const input = [
    row("1", "2026-09-20T12:00:00Z"),
    { ...row("2", "2026-09-21T12:00:00Z"), display_date: "2020-01-01" },
  ];
  assert.deepEqual(
    projectMessages(input, "chat").map((m) => m.id),
    ["1", "2"],
  );
  assert.deepEqual(
    projectMessages(input, "diary").map((m) => m.id),
    ["2", "1"],
  );
  assert.deepEqual(
    projectMessages(input, "wall").map((m) => m.id),
    ["2", "1"],
  );
  assert.equal(input[1].created_at, "2026-09-21T12:00:00Z");
});
test("microsecond timestamp ordering is not rounded to milliseconds", () => {
  const rows = [
    row("aaa", "2026-09-20T10:00:00.123456+00:00"),
    row("zzz", "2026-09-20T10:00:00.123001Z"),
  ];
  assert.deepEqual(
    mergeMessages([], rows).map((m) => m.id),
    ["zzz", "aaa"],
  );
});
test("reference arrays normalize without executing or trusting embedded HTML", () => {
  assert.deepEqual(normalizeMessage({ id: 1, reply_to: null }).reply_to, []);
  assert.equal(
    normalizeMessage({ id: 1, reply_to: Array(12).fill(3) }).reply_to.length,
    8,
  );
  assert.equal(
    normalizeMessage({ id: 1, content: "<img onerror=alert(1)>" }).content,
    "<img onerror=alert(1)>",
  );
});
test("avatars accept only bounded raster data URLs, never remote URLs or SVG", () => {
  assert.equal(
    safeAvatar("data:image/png;base64,YQ=="),
    "data:image/png;base64,YQ==",
  );
  for (const value of [
    "https://tracker.test/x",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,YQ==",
    "data:image/png;base64," + "a".repeat(60001),
  ])
    assert.equal(safeAvatar(value), "");
});
test("only missing-schema errors qualify for capability fallback", () => {
  assert.ok(missingSchema({ code: "PGRST204" }));
  assert.equal(missingSchema({ code: "42501" }), false);
});
test("storage corruption and disabled storage are handled without crashing", () => {
  global.localStorage = {
    getItem() {
      return "broken json";
    },
    setItem() {
      throw new Error("quota");
    },
  };
  assert.deepEqual(storeGet("test", []), []);
  assert.equal(storeSet("test", {}), false);
  delete global.localStorage;
});
