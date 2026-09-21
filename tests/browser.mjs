import {runInteractions} from './interactions.browser.mjs';
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
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
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
  notificationFixture = false,
} = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers:"block" });
  await context.addInitScript(() => {
    localStorage.setItem("device_id", "test-device");
    localStorage.setItem("nickname", "小辞");
  });
  if(notificationFixture)await context.addInitScript(()=>{
    window.noticeFixture={requests:0,shown:[]};class TestNotification{static permission='default';static async requestPermission(){window.noticeFixture.requests++;return this.permission='granted';}}
    window.Notification=TestNotification;const reg={showNotification:async(title,options)=>window.noticeFixture.shown.push({title,...options})};Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>reg,ready:Promise.resolve(reg),addEventListener:()=>{}}});
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
    events: [], memoirs: [], listen: null, uploads:new Map(), featureFail:false,
  };
  await context.route('**/ocr.js?*',route=>route.fulfill({contentType:'text/javascript',body:`export async function recognizeScreenshot(file,{signal,onProgress}={}){window.ocrCalls=(window.ocrCalls||0)+1;if(window.ocrSlow)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,1200);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));},{once:true});});onProgress?.('测试识别');return {messages:[{text:'一起看晚霞',side:'left',date:'2026-09-18',dateSource:'聊天日期',time:'20:00',confidence:96,y:100}]};}` }));
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
      let json=null;if(request.postData()&&request.headers()['content-type']?.includes('json'))json=JSON.parse(request.postData());
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
      if(path.endsWith('/mailbox_rooms'))return reply({room_id:secureId,created_at:'2026-09-01T00:00:00Z',relationship_since:json?.relationship_since||'2026-09-03'});
      if(path.endsWith('/anniversaries')){
        if(method==='GET')return reply(control.events);
        if(method==='POST'){control.events.push(json);return reply(json);}
        if(method==='PATCH'){const row=control.events.find(r=>r.id===url.searchParams.get('id')?.slice(3));Object.assign(row,json);return reply(row);}
        if(method==='DELETE'){control.events=control.events.filter(r=>r.id!==url.searchParams.get('id')?.slice(3));return reply([]);}
      }
      if(path.endsWith('/memoirs')){
        if(method==='GET'){const id=url.searchParams.get('id')?.slice(3);return reply(id?control.memoirs.find(r=>r.id===id):control.memoirs);}
        if(method==='POST'){const row={...json,revision:1};control.memoirs.push(row);return reply(row);}
        if(method==='PATCH'){const row=control.memoirs.find(r=>r.id===url.searchParams.get('id')?.slice(3));Object.assign(row,json);return reply(row);}
        if(method==='DELETE'){control.memoirs=control.memoirs.filter(r=>r.id!==url.searchParams.get('id')?.slice(3));return reply([]);}
      }
      if(path.endsWith('/rpc/mailbox_read_listen'))return reply({session:control.listen,server_now:new Date().toISOString()});
      if(path.endsWith('/rpc/mailbox_set_listen')){if(json.p_revision!==(control.listen?.revision||0))return reply({code:'40001'},409);control.listen={track_key:json.p_key,track_name:json.p_name,position_seconds:json.p_position,is_playing:json.p_playing,revision:json.p_revision+1,updated_at:new Date().toISOString()};return reply({session:control.listen,server_now:new Date().toISOString()});}
      if(path.endsWith('/functions/v1/mailbox-push'))return reply({error:'Push not configured'},503);
      if(path.startsWith('/storage/v1/object/sign/message-media/')){
        const key=path.split('/message-media/')[1];
        if(method==='POST'){if(!control.uploads.has(key))return reply({message:'not found'},404);return reply({signedURL:'/object/sign/message-media/'+key+'?token=test'});}
        const file=control.uploads.get(key);return file?route.fulfill({contentType:file.mime,body:file.buffer}):reply({},404);
      }
      if(path.startsWith('/storage/v1/object/message-media/')){const key=path.split('/message-media/')[1];if(control.uploads.has(key))return reply({message:'exists'},409);control.uploads.set(key,{buffer:request.postDataBuffer(),mime:request.headers()['content-type']});return reply({Key:key});}
      if (path.endsWith("/messages")) {
        if (method === "POST") {
          control.sends.push(json);
          if (control.delayMs)
            await new Promise((resolve) =>
              setTimeout(resolve, control.delayMs),
            );
          if (control.failNext || control.failOnSend === control.sends.length) {
            control.failNext = false; control.failOnSend = 0;
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
    await page.locator("#addRoomBtn").click();
    await page.locator("#joinToggle").click();
    await page.locator("#roomInput").fill(id);
    await page.locator("#joinForm button").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#roomStatus").textContent.includes("左滑"),
    );
  }
  return { page, context, control, errors, join };
}
try {
  if(!process.env.INTERACTIONS_ONLY){
  const t = await setup();
  const { page, control } = t;
  await check(
    "home: sheets and join form start hidden, four-theme choice persists",
    async () => {
      assert.equal(await page.locator(".scrim:visible").count(), 0);
      assert.equal(await page.locator("#joinForm").isVisible(), false);
      await page.locator("#themeBtn").click();
      await page.locator("[data-theme-pick=warm-light]").click();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "warm-light",
      );
      await page.reload();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "warm-light",
      );
    },
  );
  await t.join();
  await check(
    "old room opens without Auth, own messages right / friend left",
    async () => {
      assert.equal(control.authCalls, 0);
      assert.equal(await page.locator(".msg").count(), 2);
      const ownA = await page.locator(".mine .avatar").boundingBox(),
        ownB = await page.locator(".mine .bubble").boundingBox();
      const theirA = await page
          .locator(".msg:not(.mine) .avatar")
          .boundingBox(),
        theirB = await page.locator(".msg:not(.mine) .bubble").boundingBox();
      assert.ok(ownA.x > ownB.x && theirA.x < theirB.x);
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
      await page.locator('[data-message-id="1"] .bubble').dispatchEvent('contextmenu');
      await page.locator('[data-message-id="2"] .bubble').click();
      await page.locator('#selectQuote').click();
      await page.locator("#composeMore").click();
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
        if(view==='chat')await page.locator('#returnChat').click();else{await page.locator('#relationHandle').click();await page.locator(`[data-open-view=${view}]`).click();}
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
      await old.page.locator('[data-message-id="1"] .bubble').dispatchEvent('contextmenu');await old.page.locator('#selectQuote').click();await old.page.locator('#selectionCancel').click();
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
  await check('previous release local utilities and theme are recovered without publishing',async()=>{
    await old.page.evaluate(()=>{localStorage.setItem('anniversary.OldRoom1',JSON.stringify({name:'原来那一天',date:'2020-05-20'}));localStorage.setItem('memoir.OldRoom1','上一版只写给自己的内容');localStorage.setItem('lyrics.OldRoom1','旧的歌词和备注');localStorage.setItem('theme.v2','warm-dark');localStorage.setItem('mailbox.theme','"clean"');});
    await old.page.reload();await old.page.waitForFunction(()=>document.querySelector('#roomStatus').textContent.includes('左滑'));assert.equal(await old.page.locator('html').getAttribute('data-theme'),'warm-dark');
    const sent=old.control.sends.length;
    await old.page.locator('#relationHandle').click();await old.page.locator('#relationshipBtn').click();await old.page.locator('#legacyEventImport').click();assert.equal(await old.page.locator('#eventTitle').inputValue(),'原来那一天');assert.equal(await old.page.locator('#eventDate').inputValue(),'2020-05-20');assert.equal(await old.page.locator('.event-card').count(),0);await old.page.locator('[data-close=relationshipScrim]').click();
    await old.page.locator('#relationHandle').click();await old.page.locator('#memoirBtn').click();assert.equal(await old.page.locator('#memoirBody').inputValue(),'上一版只写给自己的内容');await old.page.locator('[data-close=memoirScrim]').click();
    await old.page.locator('#relationHandle').click();await old.page.locator('#listenBtn').click();assert.equal(await old.page.locator('#listenNotes').inputValue(),'旧的歌词和备注');await old.page.locator('[data-close=listenScrim]').click();assert.equal(old.control.sends.length,sent);assert.equal(await old.page.evaluate(()=>localStorage.getItem('memoir.OldRoom1')),'上一版只写给自己的内容');
  });
  await old.page.locator("#backBtn").click();
  old.control.failAuth = true;
  await check(
    "legacy room creation requires explicit privacy acknowledgment",
    async () => {
      await old.page.locator("#addRoomBtn").click();
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
      await s.page.locator('[data-message-id="1"] .bubble').dispatchEvent('contextmenu');await s.page.locator('#selectDate').click();
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
    await s.page.locator('[data-theme-pick=warm-light]').click();
    await s.page.locator('[data-close=settingsScrim]').click();
    await s.page.locator('#relationHandle').click();
    await s.page.locator('[data-open-view=wall]').click();
    assert.ok(
      await s.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await s.page.screenshot({
      path: resolve(root, "test-results/tablet-wall.png"),
    });
  });
  await s.page.locator('#returnChat').click();
  await check('left swipe opens relationship space; vertical gesture and right swipe do not',async()=>{
    await s.page.evaluate(()=>{const el=document.querySelector('#messages');el.dispatchEvent(new TouchEvent('touchstart',{touches:[new Touch({identifier:1,target:el,clientX:600,clientY:300})]}));});
    await s.page.evaluate(()=>{const el=document.querySelector('#messages');el.dispatchEvent(new TouchEvent('touchend',{changedTouches:[new Touch({identifier:1,target:el,clientX:450,clientY:305})]}));});
    assert.equal(await s.page.locator('#relationSpace').getAttribute('aria-hidden'),'false');
    await s.page.locator('#relationClose').click();
    await s.page.evaluate(()=>{const el=document.querySelector('#messages');el.dispatchEvent(new TouchEvent('touchstart',{touches:[new Touch({identifier:2,target:el,clientX:300,clientY:300})]}));});
    await s.page.evaluate(()=>{const el=document.querySelector('#messages');el.dispatchEvent(new TouchEvent('touchend',{changedTouches:[new Touch({identifier:2,target:el,clientX:430,clientY:390})]}));});
    assert.equal(await s.page.locator('#relationSpace').getAttribute('aria-hidden'),'true');
  });
  await check('relationship calendar adds shared anniversaries and paints memory wall nodes',async()=>{
    await s.page.locator('#relationHandle').click();await s.page.locator('#relationshipBtn').click();
    await s.page.locator('#relationshipSince').fill('2024-09-04');await s.page.locator('#relationshipForm button').click();
    await s.page.locator('#eventTitle').fill('第一次听同一首歌');await s.page.locator('#eventDate').fill('2026-09-20');await s.page.locator('#eventSave').click();
    await s.page.locator('.event-card').waitFor();assert.equal(s.control.events[0].owner_user_id,user);
    await s.page.locator('[data-close=relationshipScrim]').click();
    await s.page.locator('#relationHandle').click();await s.page.locator('[data-open-view=wall]').click();
    assert.match(await s.page.locator('.wall-event').textContent(),/第一次听同一首歌/);await s.page.locator('#returnChat').click();
  });
  await check('attachment retry after ambiguous send reuses upload path and message nonce',async()=>{
    await s.page.locator('#attachBtn').click();await s.page.locator('#attachmentFile').setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('a shared note')});
    await s.page.locator('#attachmentCaption').fill('一起留在这里');s.control.ambiguousNext=true;
    await s.page.locator('#attachmentSend').click();await s.page.waitForFunction(()=>document.querySelector('#attachmentStatus').textContent.includes('保留'));
    await s.page.locator('#attachmentSend').click();await s.page.waitForFunction(()=>document.querySelector('#attachmentScrim').hidden);
    assert.equal(s.control.records.filter(r=>r.media_name==='note.txt').length,1);assert.equal(s.control.uploads.size,1);
  });
  await check('image preview loads privately and survives unrelated message refresh',async()=>{
    const buffer=await readFile(resolve(root,'test-results/mobile-chat.png'));await s.page.locator('#attachBtn').click();await s.page.locator('#attachmentFile').setInputFiles({name:'moment.png',mimeType:'image/png',buffer});await s.page.locator('#attachmentSend').click();await s.page.waitForFunction(()=>document.querySelector('#attachmentScrim').hidden);await s.page.locator('.media-card img').waitFor();
    await s.page.locator('#menuBtn').click();await s.page.locator('#refreshBtn').click();await s.page.locator('[data-close=menuScrim]').click();assert.equal(await s.page.locator('.media-card img').count(),1);
  });
  await check('voice recording creates an editable playable attachment before any send',async()=>{
    await s.page.evaluate(()=>{const ac=new AudioContext(),destination=ac.createMediaStreamDestination(),oscillator=ac.createOscillator();oscillator.connect(destination);oscillator.start();window.testAudio=ac;navigator.mediaDevices.getUserMedia=async()=>destination.stream;});
    const sends=s.control.sends.length;await s.page.locator('#attachBtn').click();await s.page.locator('#recordStart').click();await s.page.locator('#recordStop').waitFor();await s.page.waitForTimeout(160);await s.page.locator('#recordStop').click();await s.page.locator('#attachmentPreview audio').waitFor();assert.equal(s.control.sends.length,sends);await s.page.locator('[data-close=attachmentScrim]').click();await s.page.evaluate(()=>window.testAudio.close());
  });
  await check('OCR recognition produces editable drafts and sends only after explicit confirmation',async()=>{

    const count=s.control.sends.length;await s.page.locator('#composeMore').click();await s.page.locator('#importBtn').click();await s.page.locator('#ocrFile').setInputFiles({name:'chat.png',mimeType:'image/png',buffer:await readFile(resolve(root,'test-results/mobile-chat.png'))});await s.page.waitForFunction(()=>!document.querySelector('#ocrRecognize').disabled&&document.querySelector('#ocrQueueCount').textContent.includes('1 张'));await s.page.locator('#ocrRecognize').click();await s.page.locator('.import-row textarea').waitFor();await s.page.waitForFunction(()=>!document.querySelector('#importSend').disabled);assert.equal(s.control.sends.length,count);
    await s.page.locator('.import-row textarea').fill('修改过的摘录');await s.page.locator('.import-row input[type=file]').setInputFiles({name:'supplement.txt',mimeType:'text/plain',buffer:Buffer.from('original supplement')});await s.page.waitForFunction(()=>document.querySelector('.import-row').textContent.includes('已就绪'));await s.page.locator('#importSend').click();assert.equal(s.control.sends.length,count);await s.page.locator('#noticeConfirm').click();await s.page.waitForFunction(()=>document.querySelector('.import-row').classList.contains('sent'));assert.equal(s.control.sends.at(-1).author_id,user);assert.equal(s.control.sends.at(-1).content,'修改过的摘录');assert.equal(s.control.sends.at(-1).media_name,'supplement.txt');assert.equal(s.control.sends.at(-1).message_type,'file');await s.page.locator('[data-close=importScrim]').click();
  });
  await check('private memoir generates a date projection, saves privately and does not send chat',async()=>{
    const count=s.control.sends.length;await s.page.locator('#relationHandle').click();await s.page.locator('#memoirBtn').click();await s.page.locator('#memoirStart').fill('2020-01-01');await s.page.locator('#memoirEnd').fill('2099-01-01');await s.page.locator('#memoirGenerate').click();await s.page.waitForFunction(()=>document.querySelector('#memoirBody').value.includes('第一封信'));await s.page.locator('#memoirTitle').fill('这一页，只有我');await s.page.locator('#memoirSave').click();await s.page.waitForFunction(()=>document.querySelector('#memoirNote').textContent.includes('已保存'));assert.equal(s.control.memoirs.length,1);assert.equal(s.control.memoirs[0].owner_user_id,user);assert.equal(s.control.sends.length,count);await s.page.locator('[data-close=memoirScrim]').click();
  });
  await check('local audio persists, publishes playback and responds to remote pause',async()=>{
    const samples=8000*8,buffer=Buffer.alloc(44+samples*2);buffer.write('RIFF');buffer.writeUInt32LE(36+samples*2,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(8000,24);buffer.writeUInt32LE(16000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)buffer.writeInt16LE(Math.round(Math.sin(i*.1)*1000),44+i*2);
    await s.page.locator('#relationHandle').click();await s.page.locator('#listenBtn').click();await s.page.locator('#listenFile').setInputFiles({name:'our-song.wav',mimeType:'audio/wav',buffer});await s.page.waitForFunction(()=>!document.querySelector('#listenToggle').disabled);await s.page.locator('#lyricsFile').setInputFiles({name:'song.lrc',mimeType:'text/plain',buffer:Buffer.from('[00:00.00]这一刻\n[00:02.00]在同一首歌里')});await s.page.locator('#listenShare').click();await s.page.waitForFunction(()=>document.querySelector('#listenSync').checked);assert.equal(s.control.listen.track_key.length,64);const playing=s.page.waitForResponse(r=>r.url().endsWith('/rpc/mailbox_set_listen')&&r.request().postDataJSON().p_playing===true);await s.page.locator('#listenToggle').click();await playing;await s.page.waitForFunction(()=>!document.querySelector('#listenAudio').paused);assert.equal(s.control.listen.is_playing,true);
    s.control.listen={...s.control.listen,is_playing:false,position_seconds:2,revision:s.control.listen.revision+1,updated_at:new Date().toISOString()};await s.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await s.page.waitForFunction(()=>document.querySelector('#listenAudio').paused);assert.ok(Math.abs(await s.page.locator('#listenAudio').evaluate(el=>el.currentTime)-2)<.5);await s.page.locator('[data-close=listenScrim]').click();assert.equal(await s.page.locator('#listenMini').isVisible(),true);await s.page.reload();await s.page.locator('#listenMini').waitFor();assert.match(await s.page.locator('#miniTrack').textContent(),/our-song/);
  });
  await check('four themes across phone, tablet portrait/landscape and desktop have usable chat, drawer, diary, wall',async()=>{
    for(const [device,width,height] of [['phone',390,844],['small-phone',320,680],['tablet-portrait',820,1180],['tablet-landscape',1180,820],['desktop',1440,900],['phone-landscape',844,390]]){
      await s.page.setViewportSize({width,height});
      for(const theme of ['ins-light','ins-dark','warm-light','warm-dark']){
        await s.page.locator('#menuBtn').click();await s.page.locator('#themeMenuBtn').click();await s.page.locator(`[data-theme-pick=${theme}]`).click();await s.page.locator('[data-close=settingsScrim]').click();
        for(const view of ['chat','diary','wall']){
          if(view!=='chat'){await s.page.locator('#relationHandle').click();await s.page.locator(`[data-open-view=${view}]`).click();await s.page.locator('#relationSpace').waitFor({state:'hidden'});}
          assert.ok(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${device} ${theme} ${view} overflow`);assert.ok(await s.page.locator('#messages').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${device} ${theme} ${view} pane overflow`);
          const pane=await s.page.locator('#messages').boundingBox();assert.ok(pane.height>90,`${device} ${view} missing content`);
          if(view==='chat'){const box=await s.page.locator('#composer').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,`${device} ${theme} composer`);}
          if(['phone','tablet-landscape','desktop'].includes(device))await s.page.screenshot({path:resolve(root,`test-results/${device}-${theme}-${view}.png`)});
        }
        await s.page.locator('#returnChat').click();await s.page.locator('#relationHandle').click();const drawer=await s.page.locator('#relationSpace').boundingBox();assert.ok(drawer.width<=width&&drawer.height<=height);if(device==='phone')await s.page.screenshot({animations:'disabled',path:resolve(root,`test-results/${device}-${theme}-space.png`)});await s.page.locator('#relationClose').click();await s.page.locator('#relationSpace').waitFor({state:'hidden'});
      }
    }
  });
  await check('new incoming messages notify once; history, theme and view changes do not notify',async()=>{
    const id=s.control.records.length+100;s.control.records.push(fixture(id,secureId,'新的晚安',friend,{author_id:friend,created_at:new Date(Date.now()+1000).toISOString()}));
    await s.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await s.page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('新留言'));
    await s.page.evaluate(()=>document.querySelector('#toast').textContent='已读检查');await s.page.locator('#relationHandle').click();await s.page.locator('[data-open-view=diary]').click();await s.page.locator('#returnChat').click();await s.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await s.page.waitForTimeout(150);assert.equal(await s.page.locator('#toast').textContent(),'已读检查');
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

  const n=await setup({notificationFixture:true});await n.join();
  await check('system notification permission is user-triggered, generic, and room unread clears on entry',async()=>{
    assert.equal(await n.page.evaluate(()=>window.noticeFixture.requests),0);
    await n.page.locator('#menuBtn').click();await n.page.locator('#notifyMenuBtn').click();await n.page.locator('#notifyBtn').click();assert.equal(await n.page.evaluate(()=>window.noticeFixture.requests),1);await n.page.locator('[data-close=settingsScrim]').click();await n.page.locator('#backBtn').click();
    n.control.records.push(fixture(900,'OldRoom1','PRIVATE BODY MUST NOT APPEAR IN SYSTEM NOTICE','friend-device',{created_at:new Date(Date.now()+2000).toISOString()}));await n.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await n.page.waitForFunction(()=>window.noticeFixture.shown.length===1);const notice=await n.page.evaluate(()=>window.noticeFixture.shown[0]);assert.equal(notice.body,'你有一条新留言');assert.equal(notice.data.room,'OldRoom1');assert.ok(!JSON.stringify(notice).includes('PRIVATE BODY'));assert.equal(await n.page.locator('.unread-count').textContent(),'1');
    await n.page.locator('.room-card').click();await n.page.waitForFunction(()=>!document.title.startsWith('('));assert.equal(await n.page.locator('.unread-count').count(),0);assert.equal(await n.page.evaluate(()=>window.noticeFixture.shown.length),1);
  });assert.deepEqual(n.errors,[]);await n.context.close();
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
  }
  await runInteractions({setup,check,secureId,user,friend,fixture,root});
  console.log(
    `\n${checks} browser integration checks passed. All Supabase requests were intercepted; production was not contacted.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
