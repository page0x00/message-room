import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { createBrotliDecompress } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { chmod } from "node:fs/promises";
import assert from "node:assert/strict";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
await mkdir(resolve(root, "test-results"), { recursive: true });
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(
      new URL(req.url, "http://test").pathname,
    ).replace(/^\/message-room/, "");
    if (path === "/" || !path) path = "/index.html";
    const file = resolve(root, "." + path);
    if (!file.startsWith(root + "/")) throw new Error("Invalid path");
    res.setHeader(
      "Content-Type",
      mime[extname(file)] || "application/octet-stream",
    );
    let content = await readFile(file);
    // This Linux test host lacks CJK system fonts; the app still uses device fonts
    // in production. Inject a test-only local font for readable visual QA.
    if (extname(file) === ".html")
      content = content
        .toString()
        .replace(
          "</head>",
          '<link rel="stylesheet" href="/message-room/node_modules/@fontsource/noto-sans-sc/400.css"><style>:root{--font:"Noto Sans SC",sans-serif}</style></head>',
        );
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/message-room/`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch {
  // NPM-packaged Chromium also works in environments where the browser CDN times out.
  // Only unpack the executable; system fonts/libs are already available. This
  // avoids Lambda archive ownership operations on ordinary development hosts.
  const executablePath = resolve(root, "test-results/chromium");
  await pipeline(
    createReadStream(
      resolve(root, "node_modules/@sparticuz/chromium/bin/chromium.br"),
    ),
    createBrotliDecompress(),
    createWriteStream(executablePath),
  );
  await chmod(executablePath, 0o755);
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
    executablePath,
    env: { ...process.env, FONTCONFIG_PATH: "/etc/fonts" },
  });
}
let checks = 0;
async function check(name, run) {
  await run();
  console.log("PASS", name);
  checks++;
}
const user = "00000000-0000-4000-a000-000000000001";
const friend = "00000000-0000-4000-a000-000000000002";
const secureId = "v2_browserdemo0001",
  invite = "a".repeat(64);
const fixture = (id, room, content, sender, extra = {}) => ({
  id,
  room_id: room,
  content,
  sender,
  sender_name: sender === "test-device" ? "小辞" : "朋友",
  created_at: `2026-09-${id === 1 ? "19" : "20"}T10:00:00Z`,
  ...extra,
});

async function setup({
  metadata = true,
  secure = false,
  viewport = { width: 390, height: 844 },
  rows = null,
} = {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    localStorage.setItem("device_id", "test-device");
    localStorage.setItem("nickname", "小辞");
  });
  const records = rows || [
    fixture(1, "OldRoom1", "你到宿舍了吗？\n一路辛苦了。", "friend-device"),
    fixture(2, "OldRoom1", "到啦。窗外有很好看的晚霞。", "test-device"),
  ];
  const memberRows = [
    {
      user_id: user,
      display_name: "小辞",
      avatar_data: null,
      joined_at: "2026-09-19T00:00:00Z",
    },
    {
      user_id: friend,
      display_name: "朋友",
      avatar_data: null,
      joined_at: "2026-09-19T00:00:00Z",
    },
  ];
  const control = {
    sends: [],
    records,
    failNext: false,
    ambiguousNext: false,
    delayMs: 0,
    denyJoin: false,
    failAuth: false,
    delayRead: "",
    authCalls: 0,
    readCalls: 0,
  };
  const errors = [];
  await context.routeWebSocket(/supabase\.co/, (ws) => {
    ws.close();
  });
  await context.route(
    "https://yuzgbxeprpohlakxjcut.supabase.co/**",
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const path = url.pathname,
        method = request.method();
      const json = request.postData() ? JSON.parse(request.postData()) : null;
      const reply = (data, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
          },
          body: JSON.stringify(data),
        });
      if (method === "OPTIONS")
        return route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
            "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
          },
        });
      if (path.includes("/auth/v1/")) {
        control.authCalls++;
        if (control.failAuth)
          return reply(
            {
              code: "anonymous_provider_disabled",
              message: "Anonymous sign-ins are disabled",
            },
            422,
          );
        const expiry = Math.floor(Date.now() / 1000) + 3600;
        const token =
          Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
            "base64url",
          ) +
          "." +
          Buffer.from(
            JSON.stringify({
              sub: user,
              role: "authenticated",
              exp: expiry,
              aud: "authenticated",
            }),
          ).toString("base64url") +
          ".mock";
        return reply({
          access_token: token,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: expiry,
          refresh_token: "mock-refresh",
          user: {
            id: user,
            aud: "authenticated",
            role: "authenticated",
            is_anonymous: true,
          },
        });
      }
      if (path.endsWith("/rpc/mailbox_create_room"))
        return reply({ room_id: secureId, invite });
      if (path.endsWith("/rpc/mailbox_join_room")) {
        if (control.denyJoin)
          return reply({ code: "42501", message: "Invalid invitation" }, 403);
        return reply(null);
      }
      if (path.endsWith("/room_members")) {
        if (method === "PATCH") {
          Object.assign(memberRows[0], json);
          return reply({ user_id: user });
        }
        return reply(memberRows);
      }
      if (path.endsWith("/messages")) {
        if (method === "POST") {
          control.sends.push(json);
          if (control.delayMs)
            await new Promise((resolve) =>
              setTimeout(resolve, control.delayMs),
            );
          if (control.failNext) {
            control.failNext = false;
            return reply({ message: "temporary error", code: "XX000" }, 500);
          }
          if (
            json.client_nonce &&
            records.some((r) => r.client_nonce === json.client_nonce)
          )
            return reply({ code: "23505", message: "duplicate nonce" }, 409);
          const saved = {
            ...json,
            id: Math.max(0, ...records.map((r) => Number(r.id))) + 1,
            created_at: new Date().toISOString(),
            reply_to: json.reply_to || [],
          };
          records.push(saved);
          if (control.ambiguousNext) {
            control.ambiguousNext = false;
            return reply({ code: "XX000", message: "response lost" }, 503);
          }
          return reply(saved, 201);
        }
        if (method === "PATCH") {
          const id = url.searchParams.get("id")?.slice(3);
          const message = records.find((r) => String(r.id) === id);
          Object.assign(message, json);
          return reply(message);
        }
        control.readCalls++;
        const room = url.searchParams.get("room_id")?.slice(3);
        if (control.delayRead === room)
          await new Promise((resolve) => setTimeout(resolve, 350));
        if (
          !metadata &&
          url.searchParams.get("select") === "display_date,reply_to"
        )
          return reply(
            { code: "PGRST204", message: "Column does not exist" },
            400,
          );
        let found = records.filter((r) => r.room_id === room);
        const nonce = url.searchParams.get("client_nonce")?.slice(3);
        if (nonce) found = found.filter((r) => r.client_nonce === nonce);
        found.sort(
          (a, b) =>
            Date.parse(b.created_at) - Date.parse(a.created_at) ||
            Number(b.id) - Number(a.id),
        );
        const cursor = url.searchParams.get("or");
        if (cursor) {
          const date = cursor.match(/created_at\.lt\.([^,]+)/)[1];
          const id = cursor.match(/id\.lt\.([^)]*)/)[1];
          found = found.filter(
            (r) =>
              Date.parse(r.created_at) < Date.parse(date) ||
              (Date.parse(r.created_at) === Date.parse(date) &&
                Number(r.id) < Number(id)),
          );
        }
        const limit = Number(url.searchParams.get("limit") ?? 100);
        found = found.slice(0, limit);
        return reply(
          request
            .headers()
            .accept?.includes("application/vnd.pgrst.object+json")
            ? found[0]
            : found,
        );
      }
      errors.push("Unexpected API request " + path);
      return reply({ message: "unknown request" }, 500);
    },
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const navigation = await page.goto(
    base + (secure ? `?room=${secureId}#key=${invite}` : ""),
    { waitUntil: "networkidle" },
  );
  assert.equal(navigation.status(), 200);
  async function join(id = "OldRoom1") {
    await page.locator("#joinToggle").click();
    await page.locator("#roomInput").fill(id);
    await page.locator("#joinForm button").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#roomStatus").textContent.includes("同步") ||
        document.querySelector("#roomStatus").textContent.includes("实时连接"),
    );
  }
  return { page, context, control, errors, join };
}
try {
  const t = await setup();
  const { page, control } = t;
  await check(
    "home: sheets and join form start hidden, both themes persist",
    async () => {
      assert.equal(await page.locator(".scrim:visible").count(), 0);
      assert.equal(await page.locator("#joinForm").isVisible(), false);
      await page.locator("#themeBtn").click();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "warm",
      );
      await page.reload();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "warm",
      );
    },
  );
  await t.join();
  await check(
    "old room opens without Auth, own messages left / friend right",
    async () => {
      assert.equal(control.authCalls, 0);
      assert.equal(await page.locator(".msg").count(), 2);
      const ownA = await page.locator(".mine .avatar").boundingBox(),
        ownB = await page.locator(".mine .bubble").boundingBox();
      const theirA = await page
          .locator(".msg:not(.mine) .avatar")
          .boundingBox(),
        theirB = await page.locator(".msg:not(.mine) .bubble").boundingBox();
      assert.ok(ownA.x < ownB.x && theirA.x > theirB.x);
      assert.match(
        await page.locator("#connectionNote").innerText(),
        /公开权限/,
      );
    },
  );
  await check(
    "mobile viewport has no horizontal overflow or hidden composer",
    async () => {
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      const box = await page.locator("#composer").boundingBox();
      assert.ok(box.y + box.height <= 845);
      assert.equal(await page.locator(".scrim:visible").count(), 0);
      await page.screenshot({
        path: resolve(root, "test-results/mobile-chat.png"),
      });
    },
  );
  await check(
    "plain Enter and composing Ctrl+Enter never accidentally send",
    async () => {
      await page.locator("#messageInput").fill("第一行");
      await page.locator("#messageInput").press("Enter");
      await page.locator("#messageInput").dispatchEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        isComposing: true,
      });
      assert.equal(control.sends.length, 0);
    },
  );
  await check(
    "multi-quote and display date share one persisted message across views",
    async () => {
      await page.locator('[data-quote-id="1"]').click();
      await page.locator('[data-quote-id="2"]').click();
      await page.locator("#dateBtn").click();
      await page.locator("#displayDate").fill("2024-09-04");
      await page.locator("#saveDate").click();
      await page.locator("#messageInput").fill("这两句，我都记下了。");
      await page.locator("#sendBtn").click();
      await page.waitForFunction(
        () => !document.querySelector("#messageInput").value,
      );
      assert.equal(control.sends.length, 1);
      assert.deepEqual(control.sends[0].reply_to, ["1", "2"]);
      assert.equal(control.sends[0].display_date, "2024-09-04");
      for (const view of ["diary", "wall", "chat"]) {
        await page.locator(`[data-view=${view}]`).click();
        assert.equal(await page.locator(".msg").count(), 3);
      }
      assert.equal(control.sends.length, 1);
      assert.equal(await page.locator(".quote-card").count(), 2);
    },
  );
  await check(
    "profile customizations persist and treat HTML as plain text",
    async () => {
      await page.locator("#roomInfoBtn").click();
      await page.locator("#myName").fill("<b>小辞</b>");
      await page.locator("#otherName").fill("阿序");
      await page.locator("#saveProfile").click();
      assert.match(
        await page.locator(".mine .sender-name").first().textContent(),
        /<b>小辞<\/b>/,
      );
      assert.equal(await page.locator(".sender-name b").count(), 0);
      assert.match(await page.locator("#roomTitle").textContent(), /阿序/);
    },
  );
  await check(
    "local avatars are compressed, persist, and can be restored",
    async () => {
      await page.locator("#roomInfoBtn").click();
      const buffer = await readFile(
        resolve(root, "test-results/mobile-chat.png"),
      );
      await page
        .locator("#myAvatar")
        .setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer });
      await page.locator("#myAvatarPreview img").waitFor();
      await page.locator("#saveProfile").click();
      assert.ok(await page.locator(".mine .avatar img").count());
      const profile = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mailbox.profile.OldRoom1")),
      );
      assert.match(profile.myAvatar, /^data:image\/jpeg;base64,/);
      assert.ok(profile.myAvatar.length < 60000);
      await page.locator("#roomInfoBtn").click();
      await page.locator("#clearMyAvatar").click();
      await page.locator("#saveProfile").click();
      assert.equal(await page.locator(".mine .avatar img").count(), 0);
    },
  );
  await check(
    "drafts and recent rooms survive navigation and refresh",
    async () => {
      await page.locator("#messageInput").fill("待会再发的草稿");
      await page.locator("#backBtn").click();
      assert.equal(await page.locator(".room-card").count(), 1);
      assert.ok(!new URL(page.url()).search);
      await page.locator(".room-card").click();
      await page.reload();
      await page.waitForFunction(
        () =>
          document.querySelector("#messageInput").value === "待会再发的草稿",
      );
      assert.equal(
        await page.locator("#messageInput").inputValue(),
        "待会再发的草稿",
      );
    },
  );
  await check(
    "failed legacy sends retain draft and explain ambiguous delivery",
    async () => {
      control.failNext = true;
      await page.locator("#sendBtn").click();
      await page.waitForFunction(() =>
        document.querySelector("#toast").textContent.includes("未获确认"),
      );
      assert.equal(
        await page.locator("#messageInput").inputValue(),
        "待会再发的草稿",
      );
    },
  );
  await check(
    "typing while send is in flight does not erase the newer draft",
    async () => {
      control.delayMs = 450;
      await page.locator("#messageInput").fill("原草稿");
      await page.locator("#sendBtn").click();
      await page.locator("#messageInput").fill("新草稿");
      await page.waitForFunction(
        () => document.querySelector("#sendBtn").textContent === "发送",
      );
      assert.equal(await page.locator("#messageInput").inputValue(), "新草稿");
      control.delayMs = 0;
    },
  );
  await check(
    "a late send response cannot append to or erase another room",
    async () => {
      control.delayMs = 500;
      await page.locator("#sendBtn").click();
      await page.locator("#backBtn").click();
      await t.join("AnotherRoom");
      await page.locator("#messageInput").fill("另一间的草稿");
      await page.waitForFunction(() =>
        document.querySelector("#toast").textContent.includes("上一间房"),
      );
      assert.equal(await page.locator(".msg").count(), 0);
      assert.equal(
        await page.locator("#messageInput").inputValue(),
        "另一间的草稿",
      );
      control.delayMs = 0;
    },
  );
  assert.deepEqual(t.errors, []);
  await t.context.close();

  const old = await setup({ metadata: false });
  await old.join();
  await check(
    "unmigrated database supports old sends and explicitly gates metadata",
    async () => {
      await old.page.locator('[data-quote-id="1"]').click();
      assert.equal(await old.page.locator("#quoteTray").isVisible(), false);
      await old.page.locator("#messageInput").fill("旧版继续聊");
      await old.page.locator("#sendBtn").click();
      await old.page.waitForFunction(
        () => !document.querySelector("#messageInput").value,
      );
      assert.equal(Object.hasOwn(old.control.sends[0], "reply_to"), false);
      assert.equal(Object.hasOwn(old.control.sends[0], "author_id"), false);
    },
  );
  await old.page.locator("#backBtn").click();
  old.control.failAuth = true;
  await check(
    "legacy room creation requires explicit privacy acknowledgment",
    async () => {
      await old.page.locator("#createBtn").click();
      await old.page.locator("#noticeScrim").waitFor({ state: "visible" });
      assert.match(
        await old.page.locator("#noticeBody").textContent(),
        /公开权限/,
      );
      await old.page.locator("#noticeCancel").click();
      assert.equal(await old.page.locator("#home").isVisible(), true);
    },
  );
  assert.deepEqual(old.errors, []);
  await old.context.close();

  const secureRows = [
    fixture(1, secureId, "第一封信", user, { author_id: user }),
    fixture(2, secureId, "记住这个普通的周末。", friend, { author_id: friend }),
  ];
  const s = await setup({
    secure: true,
    viewport: { width: 1280, height: 800 },
    rows: secureRows,
  });
  await check(
    "secure room uses anonymous Auth and exposes protected profile workflow",
    async () => {
      assert.ok(s.control.authCalls >= 1);
      assert.equal(await s.page.locator(".msg").count(), 2);
      await s.page.locator("#roomInfoBtn").click();
      assert.match(
        await s.page.locator("#profileNote").textContent(),
        /会同步/,
      );
      await s.page.locator("#myName").fill("小辞");
      await s.page.locator("#saveProfile").click();
    },
  );
  await check(
    "secure sends have authenticated authors and nonce; ambiguous retry deduplicates",
    async () => {
      s.control.ambiguousNext = true;
      await s.page.locator("#messageInput").fill("只发送一次");
      await s.page.locator("#sendBtn").click();
      await s.page.waitForFunction(() =>
        document.querySelector("#toast").textContent.includes("原草稿"),
      );
      const nonce = s.control.sends[0].client_nonce;
      assert.equal(s.control.sends[0].author_id, user);
      assert.equal(s.control.sends[0].sender, user);
      await s.page.locator("#sendBtn").click();
      await s.page.waitForFunction(
        () => !document.querySelector("#messageInput").value,
      );
      assert.equal(s.control.sends[1].client_nonce, nonce);
      assert.equal(
        s.control.records.filter((r) => r.content === "只发送一次").length,
        1,
      );
      assert.equal(await s.page.locator(".msg").count(), 3);
    },
  );
  await check(
    "only own secure messages expose date editor; editing keeps created_at",
    async () => {
      assert.equal(
        await s.page.locator(".msg:not(.mine) [data-date-id]").count(),
        0,
      );
      const original = s.control.records[0].created_at;
      await s.page.locator('[data-date-id="1"]').click();
      await s.page.locator("#displayDate").fill("2020-01-01");
      await s.page.locator("#saveDate").click();
      await s.page.waitForFunction(
        () => document.querySelector("#dateScrim").hidden,
      );
      assert.equal(s.control.records[0].created_at, original);
      assert.equal(s.control.records[0].display_date, "2020-01-01");
    },
  );
  await check("tablet layout and warm memory wall remain usable", async () => {
    await s.page.locator("#menuBtn").click();
    await s.page.locator("#themeMenuBtn").click();
    await s.page.locator("[data-view=wall]").click();
    assert.ok(
      await s.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await s.page.screenshot({
      path: resolve(root, "test-results/tablet-wall.png"),
    });
  });
  await check(
    "secure invite rejection never falls back to legacy reads",
    async () => {
      s.control.denyJoin = true;
      const before = s.control.readCalls;
      await s.page.reload();
      await s.page.waitForFunction(() =>
        document
          .querySelector("#connectionNote")
          .textContent.includes("没有访问权限"),
      );
      assert.equal(await s.page.locator("#sendBtn").isDisabled(), true);
      assert.equal(s.control.readCalls, before);
      assert.equal(await s.page.locator(".msg").count(), 0);
    },
  );
  assert.deepEqual(s.errors, []);
  await s.context.close();

  const many = Array.from({ length: 125 }, (_, index) =>
    fixture(index + 1, "OldRoom1", "留言 " + (index + 1), "test-device", {
      created_at: "2026-09-20T10:00:00Z",
    }),
  );
  const p = await setup({ rows: many });
  await p.join();
  await check(
    "keyset pagination loads beyond one page without duplicates",
    async () => {
      assert.equal(await p.page.locator(".msg").count(), 100);
      await p.page.locator("#olderBtn").click();
      await p.page.waitForFunction(
        () => document.querySelectorAll(".msg").length === 125,
      );
      assert.equal(await p.page.locator("#olderBtn").isVisible(), false);
      assert.equal(
        new Set(
          await p.page
            .locator(".msg")
            .evaluateAll((nodes) => nodes.map((n) => n.dataset.messageId)),
        ).size,
        125,
      );
    },
  );
  assert.deepEqual(p.errors, []);
  await p.context.close();
  console.log(
    `\n${checks} browser integration checks passed. All Supabase requests were intercepted; production was not contacted.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
