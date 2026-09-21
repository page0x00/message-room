import {
  parseRoom,
  roomLink,
  legacyRoom,
  randomId,
  localDate,
  validDate,
  displayDay,
  isMine,
  mergeMessages,
  compareCreated,
  projectMessages,
  safeAvatar,
  errorText,
  storeGet,
  storeSet,
} from "./core.js?v=2.3.0";
import * as api from "./backend.js?v=2.3.0";
import { initInterface, setTheme } from "./ui-v2.js?v=2.3.0";
import { initNotifications } from "./notifications.js?v=2.3.0";
import { initFeatures } from "./features.js?v=2.3.0";

import {initMessageActions} from "./message-actions.js?v=2.3.0";
let actions;

const $ = (id) => document.getElementById(id);
const state = {
  room: "",
  invite: "",
  secure: false,
  userId: "",
  epoch: 0,
  ready: false,
  messages: [],
  members: [],
  view: "chat",
  quotes: [],
  date: "",
  profile: {},
  metadata: false,
  hasMore: false,
  stop: null,
  pending: new Set(),
  busy: false,
  connected: false,
  draftNonce: "",
  editingDateId: null,
  avatarDraft: {},
  avatarRevision: 0,
  refreshPromise: null,
};
let deviceId;
try {
  deviceId = localStorage.getItem("device_id");
} catch {
  /* Storage unavailable. */
}
if (!deviceId) {
  deviceId = "u_" + randomId();
  try {
    localStorage.setItem("device_id", deviceId);
  } catch {
    /* Keep identity for this tab. */
  }
}
state.deviceId = deviceId;
let toastTimer, noticeResolve, focusBeforeSheet;
const dailyCopies = [
  "有些话，晚一点抵达也没关系。",
  "今天也有一些小事，想慢慢讲给你听。",
  "把普通的一天，留成可以重读的一页。",
  "等你有空，再拆开这封信。",
  "这里收下碎碎念，也收下认真。",
];

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 4000);
}

function persist(key, value) {
  const saved = storeSet(key, value);
  if (!saved) toast("本机存储空间不足或不可用，请先复制保存未发送内容。");
  return saved;
}

function showSheet(id) {
  focusBeforeSheet = document.activeElement;
  $(id).hidden = false;
  $(id).querySelector("input:not([type=file]):not([hidden]),button")?.focus();
}

function closeSheet(id) {
  $(id).hidden = true;
  document.dispatchEvent(new CustomEvent('mailbox:sheet-close',{detail:{id}}));
  focusBeforeSheet?.focus();
  if (id === "noticeScrim" && noticeResolve) {
    noticeResolve(false);
    noticeResolve = null;
  }
}

function notice(title, body, confirm = "知道了", cancel = false, link = "") {
  $("noticeTitle").textContent = title;
  $("noticeBody").textContent = body;
  $("noticeConfirm").textContent = confirm;
  $("noticeCancel").hidden = !cancel;
  $("noticeLink").hidden = !link;
  $("noticeLink").value = link;
  showSheet("noticeScrim");
  return new Promise((resolve) => {
    noticeResolve = resolve;
  });
}

function defaultName() {
  try {
    return (
      localStorage.getItem("nickname") ||
      localStorage.getItem("guest_name") ||
      "我"
    ).slice(0, 24);
  } catch {
    return "我";
  }
}

function readProfile(room) {
  const saved = storeGet("profile." + room, {});
  return {
    myName: String(saved?.myName || defaultName()).slice(0, 24),
    myAvatar: safeAvatar(saved?.myAvatar),
    otherName: String(saved?.otherName || "").slice(0, 24),
    otherAvatar: safeAvatar(saved?.otherAvatar),
  };
}

function recentRooms() {
  const records = storeGet("recent", []);
  return Array.isArray(records)
    ? records.filter((r) => r && parseRoom(r.room)).slice(0, 40)
    : [];
}

function rememberRoom() {
  const existing=recentRooms().find(r=>r.room===state.room)||{};
  const last=state.messages.at(-1),friend=state.members.find(m=>m.user_id!==state.userId);
  const record={...existing,room:state.room,invite:state.invite||existing.invite||'',title:state.profile.otherName||friend?.display_name||'留言室',avatar:state.profile.otherAvatar||friend?.avatar_data||'',secure:state.secure,visited:Date.now(),preview:last?.content||last?.media_name||'写下第一句话吧',lastAt:last?.created_at||existing.lastAt};
  persist('recent',[record,...recentRooms().filter(r=>r.room!==state.room)].slice(0,40));renderRecent();
}
function renderRecent() {
  let records=recentRooms();const query=$('roomSearch').value.trim().toLowerCase();
  const total=records.reduce((n,r)=>n+notifications.unread(r.room),0);$('totalUnread').hidden=!total;$('totalUnread').textContent=total>99?'99+':total;
  records=records.filter(r=>(!query||[r.title,r.preview,r.room].join(' ').toLowerCase().includes(query))&&(state.roomFilter!=='pinned'||r.pinned)&&(state.roomFilter!=='unread'||notifications.unread(r.room)>0));
  records.sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned))||(Date.parse(b.lastAt)||b.visited)-(Date.parse(a.lastAt)||a.visited));
  $('recentSection').hidden=false;$('roomList').replaceChildren();$('recentEmpty').hidden=records.length>0;$('recentEmpty').textContent=recentRooms().length?'还没有符合筛选的房间。':'还没有留下的房间。点右上角的 ＋，从第一封信开始。';
  for(const record of records){
    const button=node('button','room-card'+(record.room===state.room?' selected':''));button.type='button';button.append(avatar(record.avatar,record.title));
    const detail=node('div');detail.append(node('strong','',record.title||'留言室'),node('small','',record.preview||'从上次的话接着聊'));const tail=node('span','room-tail');
    const date=new Date(record.lastAt||record.visited);tail.append(node('time','',Number.isFinite(date.getTime())?(localDate(date)===localDate()?date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):`${date.getMonth()+1}/${date.getDate()}`):''));
    const count=notifications.unread(record.room);if(count)tail.append(node('span','unread-count',count>99?'99+':String(count)));else if(record.pinned)tail.append(node('span','room-pin','置顶'));
    button.append(detail,tail);button.onclick=()=>openRoom(record);$('roomList').append(button);
  }
}

function saveDraft() {
  if (!state.room) return;
  persist("draft." + state.room, {
    text: $("messageInput").value,
    quotes: state.quotes,
    date: state.date,
    nonce: state.draftNonce,
  });
}

function loadDraft() {
  const draft = storeGet("draft." + state.room, {});
  $("messageInput").value =
    typeof draft?.text === "string" ? draft.text.slice(0, 5000) : "";
  state.quotes = Array.isArray(draft?.quotes)
    ? draft.quotes.map(String).slice(0, 8)
    : [];
  state.date = validDate(draft?.date) ? draft.date : "";
  state.draftNonce =
    typeof draft?.nonce === "string" && /^[a-f0-9-]{36}$/.test(draft.nonce)
      ? draft.nonce
      : randomId();
  resizeComposer();
  renderQuotes();
}

function updateStatus() {
  const friend=state.members.find(m=>m.user_id!==state.userId);
  $("roomTitle").textContent=state.profile.otherName||friend?.display_name||'留言室';
  const portrait=$('roomInfoBtn').querySelector('.avatar');if(portrait)portrait.replaceWith(avatar(state.profile.otherAvatar||friend?.avatar_data,$('roomTitle').textContent));
  $("roomStatus").textContent =

    (!state.ready
      ? "等待连接"
      : !navigator.onLine
        ? "网络已断开"
        : state.connected
          ? "信已连上 · 左滑看看我们的空间"
          : "等一句你的话 · 左滑打开空间");
  $("sendBtn").disabled =
    !state.ready ||
    state.pending.has(state.room) ||
    !$("messageInput").value.trim();
  $("sendBtn").textContent = state.pending.has(state.room) ? "发送中" : "发送";
  $("dateBtn").classList.toggle("chosen", Boolean(state.date));
  $("dateBtn").textContent = state.date ? `补录日期 · ${state.date}` : "补录显示日期";
  $("dateBtn").title = state.date ? `显示日期：${state.date}` : "设置显示日期";
}

async function openRoom(target) {
  const valid = parseRoom(target.room);
  if (!valid) {
    toast("房间号格式不正确。");
    return;
  }
  saveDraft();
  ui.drawer(false);
  document.querySelector(".app-shell").classList.add("has-room");
  state.stop?.();
  state.stop = null;
  state.refreshPromise = null;
  const epoch = ++state.epoch;
  Object.assign(state, {
    room: valid.room,
    secure: valid.secure,
    invite: target.invite || "",
    userId: "",
    ready: false,
    connected: false,
    messages: [],
    members: [],
    quotes: [],
    metadata: false,
    hasMore: false,
    profile: readProfile(valid.room),
    view: "chat",
  });
  features.roomChanged();
  actions?.reset();
  $("connectionNote").hidden=true;
  $("home").classList.remove("active");
  $("room").classList.add("active");
  document.querySelectorAll(".scrim").forEach((el) => {
    el.hidden = true;
  });
  history.replaceState(
    {},
    "",
    roomLink(location.href, state.room, state.invite),
  );
  $("connectionNote").textContent = state.secure
    ? "正在验证邀请及成员身份……"
    : "旧版兼容模式：保留原有公开权限，请勿存放私密内容。";
  loadDraft();
  render();
  setView("chat");
  updateStatus();
  try {
    if (state.secure) {
      const identity = await api.joinRoom(state.room, state.invite);
      if (epoch !== state.epoch) return;
      state.userId = identity.userId;
      const list = await api.members(state.room);
      if (epoch !== state.epoch) return;
      state.members = list;
      const me = state.members.find((m) => m.user_id === state.userId);
      if (me)
        state.profile = {
          ...state.profile,
          myName: me.display_name,
          myAvatar: safeAvatar(me.avatar_data),
        };
      $("connectionNote").textContent =
        "凭完整邀请链接加入。匿名身份保存在此浏览器，请勿清除网站数据。";
    }
    const room = state.room,
      secure = state.secure;
    state.stop = api.subscribe(
      room,
      secure,
      (payload) => {
        if (epoch !== state.epoch) return;
        if (payload.eventType === "DELETE")
          state.messages = state.messages.filter(
            (m) => m.id !== String(payload.old?.id),
          );
        else if (payload.new?.room_id === room) {
          if(payload.eventType==="INSERT"&&state.ready)notifications.ingest(room,[payload.new]);
          state.messages = mergeMessages(state.messages, [payload.new]);
        }
        render({ stick: true });
      },
      () => {
        void refreshMembers(epoch);
      },
      (status) => {
        if (epoch !== state.epoch) return;
        state.connected = status === "SUBSCRIBED";
        updateStatus();
        if (state.connected && state.ready) void refreshMessages();
      },
    );
    const [page, supported] = await Promise.all([
      api.loadMessages(room, secure),
      api.metadataSupported(room, secure),
    ]);
    if (epoch !== state.epoch) return;
    state.messages = mergeMessages(state.messages, page.rows);
    state.hasMore = page.hasMore;
    state.metadata = supported;
    state.ready = true;
    notifications.prime(room,state.messages);
    features.ready();
    actions?.load();
    if (!supported && (state.quotes.length || state.date))
      toast(
        "当前数据库不支持引用与显示日期，草稿保留；发送前请清除这些选项或先升级数据库。",
      );
    rememberRoom();
    void notifications.watch();
    render({ bottom: true });
    updateStatus();
  } catch (error) {
    if (epoch !== state.epoch) return;
    state.stop?.();
    state.stop = null;
    state.ready = false;
    const extra = state.secure
      ? " 请使用包含 #key= 的完整邀请链接；若尚未升级，请先完成数据库设置。"
      : "";
    $("connectionNote").hidden=false;
    $("connectionNote").textContent = errorText(error) + extra;
    render();
    updateStatus();
  }
}

async function refreshMembers(epoch = state.epoch) {
  try {
    const list = await api.members(state.room);
    if (epoch !== state.epoch) return;
    state.members = list;
    render();
  } catch {
    /* Message refresh and profile editor expose actionable errors. */
  }
}

async function refreshMessages(manual = false) {
  if (!state.room || !navigator.onLine || state.refreshPromise) return;
  if (!state.ready) {
    if (manual) await openRoom({ room: state.room, invite: state.invite });
    return;
  }
  const epoch = state.epoch;
  const task = api.loadMessages(state.room, state.secure);
  state.refreshPromise = task;
  try {
    const page = await task;
    if (epoch !== state.epoch) return;
    // Fill gaps after an offline interval longer than a page. Pagination is keyset-based.
    let cursorPage = page;
    const previousNewest = state.messages.at(-1);
    let incoming = [...page.rows];
    while (
      previousNewest &&
      cursorPage.hasMore &&
      cursorPage.rows.length &&
      compareCreated(cursorPage.rows.at(-1), previousNewest) > 0
    ) {
      cursorPage = await api.loadMessages(
        state.room,
        state.secure,
        cursorPage.rows.at(-1),
      );
      if (epoch !== state.epoch) return;
      incoming.push(...cursorPage.rows);
    }
    notifications.ingest(state.room,incoming);
    state.messages = mergeMessages(state.messages, incoming);
    render({ stick: true });
    if (manual) toast("已刷新");
  } catch (error) {
    if (epoch === state.epoch && manual) toast(errorText(error));
  } finally {
    if (state.refreshPromise === task) state.refreshPromise = null;
  }
}

async function loadOlder() {
  if (!state.ready || !state.hasMore || $("olderBtn").disabled) return;
  const epoch = state.epoch,
    pane = $("messages"),
    height = pane.scrollHeight;
  $("olderBtn").disabled = true;
  try {
    const page = await api.loadMessages(
      state.room,
      state.secure,
      state.messages[0],
    );
    if (epoch !== state.epoch) return;
    state.messages = mergeMessages(state.messages, page.rows);
    state.hasMore = page.hasMore;
    render();
    pane.scrollTop += pane.scrollHeight - height;
  } catch (error) {
    if (epoch === state.epoch) toast(errorText(error));
  } finally {
    $("olderBtn").disabled = false;
  }
}

function home() {
  saveDraft();
  ui.drawer(false);
  document.querySelector(".app-shell").classList.remove("has-room");
  ++state.epoch;
  state.stop?.();
  state.stop = null;
  state.room = "";
  state.ready = false;
  state.refreshPromise = null;
  features.roomChanged();
  actions?.reset();
  $("room").classList.remove("active");
  $("home").classList.add("active");
  document.querySelectorAll(".scrim").forEach((el) => {
    el.hidden = true;
  });
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  history.replaceState({}, "", url);
  renderRecent();
}

function avatar(value, name) {
  const el = node("span", "avatar");
  const image = safeAvatar(value);
  if (image) {
    const img = node("img");
    img.src = image;
    img.alt = name + "的头像";
    el.append(img);
  } else el.textContent = [...(name || "友")][0];
  return el;
}

function author(message) {
  const mine = isMine(message, state);
  const member = state.members.find((m) => m.user_id === message.author_id);
  return {
    mine,
    name: mine
      ? state.profile.myName
      : state.profile.otherName ||
        member?.display_name ||
        message.sender_name ||
        "朋友",
    image: mine
      ? state.profile.myAvatar
      : state.profile.otherAvatar || member?.avatar_data || "",
  };
}

function render({ bottom = false, stick = false } = {}) {
  const box = $("messages");
  const wasNearBottom =
    box.scrollHeight - box.scrollTop - box.clientHeight < 100;
  const oldTop = box.scrollTop;
  const fragment = document.createDocumentFragment();
  box.className = "messages view-" + state.view;
  if (!state.messages.some(m=>!actions?.hidden(m.id)))
    fragment.append(
      node(
        "p",
        "empty",
        state.ready
          ? "这里还没有留言。\n写下第一句话吧。"
          : "等待连接……可点击“刷新”重试。",
      ),
    );
  const byId = new Map(state.messages.map((m) => [m.id, m]));
  let lastDay = '',container=fragment;
  if(state.view==='wall')fragment.append(node('p','wall-intro','把值得留下的瞬间，慢慢贴在这里。'));
  for (const message of projectMessages(state.messages.filter(m=>!actions?.hidden(m.id)), state.view).filter(m=>state.view!=='diary'||((!$('diaryDate').value||displayDay(m,'diary')===$('diaryDate').value)&&(state.diaryFilter!=='mine'||isMine(m,state))&&(state.diaryFilter!=='media'||m.media_path)))) {
    const day = displayDay(message, state.view);
    if (day !== lastDay) {
      if(state.view==='diary'){container=node('section','diary-page');fragment.append(container);}
      if(state.view!=='wall')container.append(node('div','day',day||'日期未知'));
      lastDay = day;
    }
    const who = author(message);
    const row = node("article", "msg" + (who.mine ? " mine" : ""));
    row.dataset.messageId = message.id;
    const wrap = node("div", "bubble-wrap");
    wrap.append(node("span", "sender-name", who.name));
    const bubble = node("div", "bubble");
    for (const id of message.reply_to) {
      const reference = byId.get(id);
      const referenceButton=
        node(
          "button",
          "quote-card",
          reference
            ? `${author(reference).name}：${reference.content.slice(0, 120)}`
            : "较早的留言 · 点击追溯引用",
        );
      referenceButton.type='button';referenceButton.dataset.referenceId=id;bubble.append(referenceButton);
    }
    features.renderMedia(message,bubble);
    if(/^【(?:合并转发|截图合并整理)】/.test(message.content)){const record=node('details','forward-record');record.append(node('summary','',message.content.startsWith('【合并转发】')?'合并转发 · 点击展开':'截图整理 · 点击展开'),node('div','message-text',message.content.replace(/^【[^】]+】\s*/,'')));bubble.append(record);}else bubble.append(node("div", "message-text", message.content));
    wrap.append(bubble);
    const meta = node("div", "meta");
    const stamp = new Date(message.created_at);
    const time = node(
      "time",
      "",
      Number.isFinite(stamp.getTime())
        ? stamp.toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "",
    );
    time.dateTime = message.created_at;
    time.title = "真实发送时间：" + stamp.toLocaleString("zh-CN");
    meta.append(time);
    if (message.display_date && state.view !== "chat")
      meta.append(
        node("span", "", " · 发送于 " + localDate(message.created_at)),
      );
    wrap.append(meta);
    const portrait = avatar(who.image, who.name);
    if(state.view==='wall')wrap.append(node('time','wall-date',displayDay(message,'wall')));
    row.append(portrait,wrap);actions?.decorate(row,message);container.append(row);
  }
  if(state.view==='wall')features.renderWall(fragment);
  if(state.view==='wall'){const grid=node('div','wall-grid');grid.append(fragment);box.replaceChildren(grid);}else box.replaceChildren(fragment);
  $("olderBtn").hidden = !state.hasMore;
  $("historyCount").textContent = state.messages.length
    ? `${state.messages.length} 条${state.hasMore ? " · 还有更早留言" : ""}`
    : "";
  renderQuotes();
  actions?.rendered();
  if (bottom || (stick && wasNearBottom && state.view === "chat"))
    box.scrollTop = box.scrollHeight;
  else box.scrollTop = oldTop;
  if(state.ready&&state.view==='chat'&&!document.hidden&&box.scrollHeight-box.scrollTop-box.clientHeight<100)notifications.read(state.room);
}

function setView(view) {
  view=['chat','diary','wall'].includes(view)?view:'chat';
  state.view = view;
  $('viewHeading').hidden=view==='chat';$('viewTitle').textContent=view==='diary'?'日记':'回忆墙';$('diaryFilters').hidden=view!=='diary';$('composer').hidden=view!=='chat';$('room').dataset.view=view;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  });
  render({ bottom: view === "chat" });
  if (view !== "chat") $("messages").scrollTop = 0;
}

function renderQuotes() {
  $("quoteTray").hidden = !state.quotes.length||state.view!=="chat";
  $("quoteCount").textContent = `引用 ${state.quotes.length} 条`;
  $("quotePreview").textContent = state.quotes
    .map(
      (id) =>
        state.messages.find((m) => m.id === id)?.content.slice(0, 40) ||
        "较早的留言",
    )
    .join(" / ");
  resizeComposer();
}

function resizeComposer() {
  const input = $("messageInput");
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight || 44, 132) + "px";
}

async function send(event) {
  event.preventDefault();
  const content = $("messageInput").value.trim();
  if (!content || !state.ready || state.pending.has(state.room)) return;
  if (!navigator.onLine) {
    toast("网络已断开，草稿已保留。");
    return;
  }
  if (!state.metadata && (state.quotes.length || state.date)) {
    toast("请先清除引用和自定日期，或升级数据库；不会悄悄丢弃这些设置。");
    return;
  }
  const snapshot = {
    room: state.room,
    secure: state.secure,
    nonce: state.draftNonce,
    text: $("messageInput").value,
  };
  const row = {
    room_id: state.room,
    content,
    sender: state.secure ? state.userId : state.deviceId,
    sender_name: state.profile.myName,
  };
  if (state.metadata)
    Object.assign(row, {
      display_date: state.date || null,
      reply_to: [...state.quotes],
    });
  if (state.secure)
    Object.assign(row, {
      author_id: state.userId,
      client_nonce: snapshot.nonce,
    });
  state.pending.add(snapshot.room);
  saveDraft();
  updateStatus();
  try {
    const message = await api.sendMessage(row, snapshot.secure);
    // Only clear the exact draft sent. Typing or switching rooms during a request is safe.
    const saved = storeGet("draft." + snapshot.room, {});
    if (saved.nonce === snapshot.nonce) persist("draft." + snapshot.room, {});
    if (state.room === snapshot.room) {
      state.messages = mergeMessages(state.messages, [message]);
      if (
        state.draftNonce === snapshot.nonce &&
        $("messageInput").value === snapshot.text
      ) {
        $("messageInput").value = "";
        state.quotes = [];
        state.date = "";
        state.draftNonce = randomId();
        saveDraft();
      }
      render({ bottom: true });
      resizeComposer();
    } else toast("上一间房的留言已发送。");
  } catch (error) {
    if (state.room === snapshot.room)
      toast(
        snapshot.secure
          ? errorText(error) + " 草稿保留，可用原草稿重试。"
          : "发送未获确认，草稿已保留。请先刷新核对是否已送达，再决定是否重发。",
      );
  } finally {
    state.pending.delete(snapshot.room);
    updateStatus();
  }
}

async function create() {
  if (state.busy) return;
  state.busy = true;
  $("createBtn").disabled = true;
  $("createBtn").textContent = "正在创建……";
  try {
    const target = await api.createRoom(defaultName());
    await openRoom(target);
    if (state.ready)
      void notice(
        "房间已创建",
        "从菜单复制完整邀请链接发给朋友。链接持有者可以加入并查看留言，请勿公开发布。匿名身份只保存在当前浏览器；清除网站数据或换设备会成为新的成员。",
      );
  } catch (error) {
    const allowLegacy = await notice(
      "暂时无法创建邀请房间",
      errorText(error) +
        "\n你仍可创建旧版房间继续留言，它沿用旧的公开权限，不适合私密内容。",
      "创建旧版房间",
      true,
    );
    if (allowLegacy) await openRoom({ room: legacyRoom() });
  } finally {
    state.busy = false;
    $("createBtn").disabled = false;
    $("createBtn").textContent = "创建房间";
  }
}

function previewAvatar(id, image, name) {
  $(id).replaceChildren();
  if (safeAvatar(image)) {
    const img = node("img");
    img.src = image;
    img.alt = "头像预览";
    $(id).append(img);
  } else $(id).textContent = [...(name || "我")][0];
}

function profileEditor() {
  closeSheet("menuScrim");
  state.avatarRevision++;
  $("saveProfile").disabled = false;
  $("myName").value = state.profile.myName;
  $("otherName").value = state.profile.otherName;
  state.avatarDraft = {
    myAvatar: state.profile.myAvatar,
    otherAvatar: state.profile.otherAvatar,
  };
  $("myAvatar").value = "";
  $("otherAvatar").value = "";
  previewAvatar(
    "myAvatarPreview",
    state.avatarDraft.myAvatar,
    state.profile.myName,
  );
  previewAvatar(
    "otherAvatarPreview",
    state.avatarDraft.otherAvatar,
    state.profile.otherName || "友",
  );
  $("profileNote").textContent = state.secure
    ? "你的昵称与头像会同步给房间成员。对方备注与替换头像仅在本机显示，不会改动对方资料。"
    : "旧版房间：资料仅保存在本机。新发送的文字会附带你的昵称，头像不会同步给对方。";
  showSheet("profileScrim");
}

async function compressAvatar(file) {
  if (
    !file ||
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)
  )
    throw new Error("请选择 JPG、PNG、WebP 或 GIF 图片。");
  if (file.size > 8 * 1024 * 1024) throw new Error("头像原图请小于 8 MB。");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.fillStyle = "#faf6ef";
    ctx.fillRect(0, 0, 128, 128);
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      128,
      128,
    );
    const data = canvas.toDataURL("image/jpeg", 0.82);
    if (!safeAvatar(data)) throw new Error("这张图片压缩后仍过大，请换一张。");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function saveProfile() {
  const profile = {
    ...state.avatarDraft,
    myName: $("myName").value.trim(),
    otherName: $("otherName").value.trim(),
  };
  if (!profile.myName) {
    toast("给自己留一个昵称吧。");
    return;
  }
  const epoch = state.epoch,
    room = state.room;
  $("saveProfile").disabled = true;
  try {
    if (state.secure) await api.saveMember(room, state.userId, profile);
    if (epoch !== state.epoch) return;
    if (!persist("profile." + room, profile)) return;
    state.profile = profile;
    try {
      localStorage.setItem("nickname", profile.myName);
    } catch {
      /* Profile saved above. */
    }
    rememberRoom();
    updateStatus();
    render();
    closeSheet("profileScrim");
    toast(
      state.secure
        ? "你的资料已同步，对方备注已保存在本机。"
        : "资料已保存到本机。",
    );
  } catch (error) {
    if (epoch === state.epoch) toast(errorText(error) + " 尚未保存，可重试。");
  } finally {
    $("saveProfile").disabled = false;
  }
}

function dateEditor(id = null) {
  if (!state.metadata && !state.date) {
    toast("自定显示日期需要先执行数据库迁移。");
    return;
  }
  state.editingDateId = id;
  $("displayDate").value = id
    ? state.messages.find((m) => m.id === id)?.display_date || ""
    : state.date;
  showSheet("dateScrim");
}

async function saveDate() {
  const value = $("displayDate").value;
  if (value && !validDate(value)) {
    toast("请选择有效的日期。");
    return;
  }
  if (!state.metadata && value) {
    toast("请清空日期，或先升级数据库。");
    return;
  }
  const epoch = state.epoch;
  $("saveDate").disabled = true;
  try {
    if (state.editingDateId) {
      const updated = await api.editDisplayDate(
        state.room,
        state.editingDateId,
        value,
      );
      if (epoch !== state.epoch) return;
      state.messages = mergeMessages(state.messages, [updated]);
      render();
    } else {
      state.date = value;
      state.draftNonce = randomId();
      saveDraft();
      updateStatus();
    }
    closeSheet("dateScrim");
    toast(value ? "显示日期已设置：" + value : "使用真实发送日期");
  } catch (error) {
    if (epoch === state.epoch) toast(errorText(error));
  } finally {
    $("saveDate").disabled = false;
  }
}

async function share() {
  closeSheet("menuScrim");
  const link = roomLink(location.href, state.room, state.invite);
  if (state.secure && !state.invite) {
    void notice(
      "这份链接没有邀请密钥",
      "你可以继续访问已加入的房间。要邀请新成员，请向原分享者索取包含 #key= 的完整链接。",
    );
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    toast("完整房间链接已复制，请仅分享给想邀请的人。");
  } catch {
    void notice(
      "长按复制房间链接",
      "浏览器没有开放剪贴板权限，可以从下方手动复制。",
      "关闭",
      false,
      link,
    );
  }
}

$("createBtn").onclick = create;
$("joinToggle").onclick = () => {
  $("joinForm").hidden = !$("joinForm").hidden;
  if (!$("joinForm").hidden) $("roomInput").focus();
};
$("joinForm").onsubmit = (event) => {
  event.preventDefault();
  const target = parseRoom($("roomInput").value);
  if (target) void openRoom(target);
  else toast("请粘贴完整房间链接或有效的房间号。");
};
$("clearRecent").onclick = async () => {
  if (
    await notice(
      "清空最近房间？",
      "仅移除本机列表，不删除云端消息、身份或草稿。请先保存需要的邀请链接。",
      "清空列表",
      true,
    )
  ) {
    persist("recent", []);
    renderRecent();
    void notifications.watch();
  }
};
$("backBtn").onclick = home;
$("leaveBtn").onclick = home;
$("menuBtn").onclick = () => showSheet("menuScrim");
$("roomInfoBtn").onclick = profileEditor;
$("profileBtn").onclick = profileEditor;
$("shareBtn").onclick = share;
$("saveProfile").onclick = saveProfile;
$("dateBtn").onclick = () => dateEditor();
$("saveDate").onclick = saveDate;
$("composer").onsubmit = send;
$("messageInput").oninput = () => {
  state.draftNonce = randomId();
  resizeComposer();
  saveDraft();
  updateStatus();
};
$("messageInput").onkeydown = (event) => {
  // Chinese/Japanese IME Enter must commit composition, never send accidentally.
  if (
    event.key === "Enter" &&
    !event.isComposing &&
    (event.ctrlKey || event.metaKey)
  ) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
};
$("messageInput").title = "Enter 换行，Ctrl / Cmd + Enter 发送";
$("clearQuotes").onclick = () => {
  state.quotes = [];
  state.draftNonce = randomId();
  saveDraft();
  render();
};
$("refreshBtn").onclick = () => refreshMessages(true);
$("olderBtn").onclick = loadOlder;
$("messages").onclick = (event) => {
  const reference=event.target.closest('[data-reference-id]');
  if(reference)void revealReference(reference.dataset.referenceId);
};
document.querySelectorAll("[data-view]").forEach((button) => {
  button.onclick = () => setView(button.dataset.view);
});
document.querySelectorAll("[data-close]").forEach((button) => {
  if (!button.getAttribute("aria-label") && button.textContent === "×")
    button.setAttribute("aria-label", "关闭");
  button.onclick = () => closeSheet(button.dataset.close);
});
document.querySelectorAll(".scrim").forEach((scrim) => {
  scrim.onclick = (event) => {
    if (event.target === scrim) closeSheet(scrim.id);
  };
});
document.addEventListener("keydown", (event) => {
  const sheet = !$('noticeScrim').hidden ? $('noticeScrim') : [...document.querySelectorAll(".scrim")].reverse().find(
    (el) => !el.hidden,
  );
  if (!sheet) return;
  if (event.key === "Escape") {
    closeSheet(sheet.id);
    return;
  }
  if (event.key === "Tab") {
    const focusable = [
      ...sheet.querySelectorAll("button,input,textarea,select,a[href]"),
    ].filter((el) => !el.disabled && !el.hidden && el.offsetWidth > 1);
    if (event.shiftKey && document.activeElement === focusable[0]) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  }
});
$("noticeCancel").onclick = () => closeSheet("noticeScrim");
$("noticeConfirm").onclick = () => {
  const resolve = noticeResolve;
  noticeResolve = null;
  closeSheet("noticeScrim");
  resolve?.(true);
};
$("noticeLink").onclick = () => $("noticeLink").select();
for (const key of ["myAvatar", "otherAvatar"]) {
  $(key).onchange = async () => {
    const epoch = state.epoch,
      revision = ++state.avatarRevision;
    $("saveProfile").disabled = true;
    try {
      const data = await compressAvatar($(key).files[0]);
      if (epoch !== state.epoch || revision !== state.avatarRevision) return;
      state.avatarDraft[key] = data;
      previewAvatar(key + "Preview", data, "");
    } catch (error) {
      toast(error.message);
    } finally {
      if (revision === state.avatarRevision) $("saveProfile").disabled = false;
    }
  };
}
for (const [button, key] of [
  ["clearMyAvatar", "myAvatar"],
  ["clearOtherAvatar", "otherAvatar"],
]) {
  $(button).onclick = () => {
    state.avatarRevision++;
    state.avatarDraft[key] = "";
    $(key).value = "";
    $("saveProfile").disabled = false;
    previewAvatar(
      key + "Preview",
      "",
      key === "myAvatar" ? $("myName").value : $("otherName").value || "友",
    );
  };
}
window.addEventListener("online", () => {
  updateStatus();
  void refreshMessages(true);
});
window.addEventListener("offline", updateStatus);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refreshMessages();
  else saveDraft();
});
window.addEventListener("pagehide", saveDraft);
setInterval(() => {
  if (!document.hidden && state.ready) void refreshMessages();
}, 30000);

async function revealReference(id){
  const epoch=state.epoch;let pages=0;
  while(!state.messages.some(m=>m.id===id)&&state.hasMore&&pages++<30){await loadOlder();if(epoch!==state.epoch)return;}
  if(!state.messages.some(m=>m.id===id)){toast('这条引用暂时不可见，请稍后再试。');return;}
  setView('chat');const row=[...$('messages').querySelectorAll('[data-message-id]')].find(el=>el.dataset.messageId===id);row?.scrollIntoView({block:'center',behavior:'smooth'});row?.classList.add('quote-highlight');setTimeout(()=>row?.classList.remove('quote-highlight'),3000);
}
const notifications=initNotifications({$,state,toast,persist,recentRooms,renderRecent});
const ui=initInterface({$,state,node,toast,persist,showSheet,closeSheet,setView,renderRecent,home});
const heading=$('roomInfoBtn'),label=node('span');label.append($('roomTitle'),$('roomStatus'));heading.replaceChildren(avatar('','友'),label);
$('pinRoomBtn').onclick=()=>{const records=recentRooms();const row=records.find(r=>r.room===state.room);if(row){row.pinned=!row.pinned;persist('recent',records);renderRecent();toast(row.pinned?'这个房间已置顶。':'已取消置顶。');}closeSheet('menuScrim');};
$('messages').addEventListener('scroll',()=>{const pane=$('messages');if(state.view==='chat'&&!document.hidden&&pane.scrollHeight-pane.scrollTop-pane.clientHeight<80)notifications.read(state.room);},{passive:true});
const features = initFeatures({ $,state,node,toast,persist,showSheet,closeSheet,notice,author,
  onMessages(rows){state.messages=mergeMessages(state.messages,rows);render({stick:true});updateStatus();}
});
actions=initMessageActions({$,state,node,toast,persist,showSheet,closeSheet,notice,author,render,setView,saveDraft,dateEditor,recentRooms,onMessages(rows){state.messages=mergeMessages(state.messages,rows);render({stick:true});updateStatus();}});
renderRecent();
void notifications.watch();
const initial = parseRoom(location.href);
if (initial) {
  const saved = recentRooms().find((r) => r.room === initial.room);
  void openRoom({ ...initial, invite: initial.invite || saved?.invite || "" });
}
