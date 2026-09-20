# 新留言通知

当前前端已完成第一层通知：房间实时数据使消息 DOM 更新后，如果最新一条来自对方，会显示站内 Toast；用户主动授权浏览器通知后，页面在后台时还会显示隐私安全的系统通知“你有一条新留言”。`sw.js` 已提供 Push 事件和 notificationclick 入口，为下一阶段真正的离站 Web Push 留好接点。

## 当前可直接使用

1. 必须通过 HTTPS 部署（GitHub Pages 满足）。
2. 在“我们的空间”点击“开启新留言系统通知”，由用户手势触发浏览器授权。
3. 页面仍存活时：Realtime/轮询刷新到对方新消息后，显示 Toast；后台标签页在授权后显示系统通知。
4. 默认不把留言正文放进系统通知，避免锁屏泄露内容。

## 完整离站 Web Push 还需要的服务端步骤

前端不能持有 VAPID 私钥，因此不要把私钥写入仓库、HTML、JS 或 Supabase anon 可读配置。推荐由 Supabase Edge Function 发送 Push。

建议新增表 `push_subscriptions`：`id uuid primary key default gen_random_uuid()`、`room_id text not null`、`member_id uuid`、`endpoint text not null unique`、`p256dh text not null`、`auth text not null`、`created_at timestamptz default now()`、`updated_at timestamptz default now()`。开启 RLS，只允许当前房间成员创建/读取/删除自己的订阅；不要允许匿名列出整个房间的 endpoint。

服务端配置 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT 为 Edge Function secrets。客户端只接收 public key，并用 `serviceWorkerRegistration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey: ...})` 生成订阅后写入 `push_subscriptions`。

发送路径建议：消息成功插入后调用受保护的 Edge Function；Function 验证发送者属于 room，读取同房间中除发送者外的订阅并发送 payload。payload 默认仅包含 `{title:"小小留言室", body:"你有一条新留言", url:"<room link>"}`，不要传完整留言正文。失效 endpoint（410/404）应自动从订阅表删除。

## iOS / Android / 桌面差异

iOS/iPadOS 的 Web Push 需要较新的 Safari，并通常要求用户先把网站“添加到主屏幕”后再授权；Android Chromium 与桌面 Chromium/Firefox 支持更直接。所有浏览器都要求通知授权由明确的用户操作触发，不能页面加载即弹权限框。

## 后续验收

用两个不同浏览器身份进入同一邀请房间：A 开启通知，B 发留言；分别验证 A 在当前房间、切到其他标签页、PWA/浏览器后台三种状态。完整 Web Push 上线后，再验证彻底关闭页面后的通知与点击通知返回对应房间。