# 小小留言室 2.3 · 开通步骤

更新 GitHub Pages 会更新前端，**不会自动修改 Supabase**。当前环境没有线上数据库管理员权限，以下操作需要项目所有者执行。旧 `messages` 不删除、不清空。

## 基础功能：只需两步

1. Supabase → SQL Editor，打开仓库的 [`supabase/INSTALL.sql`](supabase/INSTALL.sql)，复制整份 SQL 执行一次。它把四份增量 migration 合成一个事务，可重复执行；已有旧留言会保留，已有邀请房间也不会重建。若执行失败，整个事务回滚。也可以按文件名顺序分别执行 `supabase/migrations/` 下的四份 SQL。
2. Authentication → Sign In / Providers，启用 **Anonymous Sign-Ins**。保持项目现有的验证码等安全设置；如已强制 CAPTCHA，当前还需要补接该组件，不要关闭它来绕过。

本次 2.3 批量截图/长按多选不新增数据库表。已完成上一版配置的项目无需重复执行 SQL；具体操作见 [P2 使用说明](docs/P2_IMPORT.md)。

刷新网页，点首页 `＋` 新建邀请房间，把完整链接交给朋友。已有邀请成员可从最近列表返回；旧链接继续收发文字。

SQL 一并配置私有 `message-media` bucket（20 MB）、成员/附件/纪念日/回忆录 RLS、一起听 RPC、Realtime publication、Push 订阅和投递去重表。**不需要手动把 bucket 设成 public，也不需要另买服务器。**

| 当前数据库状态 | 可用范围 |
| --- | --- |
| 未迁移的旧库 | 原文字收发、四皮肤、本机资料/草稿/联系人、日记/墙投影；本机音乐、纪念日、回忆录；粘贴或 OCR 摘录 |
| 前两份 SQL + 匿名 Auth | 邀请房间与成员资料；引用、补录日期、文字重试去重 |
| 四份 SQL + 匿名 Auth | 私有附件与录音、共享纪念日、一起听同步、私有云端回忆录、Push 订阅存储 |
| 再部署下述推送服务 | 离线 Web Push；平台权限与实际送达仍需双设备验证 |

## 离线推送：额外配置一次

网页内 Toast、未读角标、标题/应用角标、可选提示音，均不依赖 Edge Function。系统通知需在“外观与通知”中主动授权；页面关闭后的通知需要下面的服务端配置。

1. 本机用 `npx web-push generate-vapid-keys --json` 生成密钥。将 **VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT** 写入 Supabase Edge Function Secrets；`VAPID_SUBJECT` 使用你自己的 `mailto:邮箱`。再生成一个随机的 **MAILBOX_WEBHOOK_SECRET**，也只放 Secrets。`MAILBOX_ORIGIN` 默认为 `https://page0x00.github.io`；更换网站域名后才需修改。
2. 在仓库根目录，登录 Supabase CLI 并连接项目后，部署：

   ```sh
   supabase functions deploy mailbox-push --project-ref yuzgbxeprpohlakxjcut
   ```

   仓库 `supabase/config.toml` 为该函数关闭网关旧式 JWT 校验；**函数内部仍校验发送者 JWT，或校验私有 webhook secret**。这一步适配 publishable key 和数据库 webhook，不代表匿名开放发送。Supabase 默认注入 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`，不要写进前端或提交到 Git。
3. Dashboard → Database → Webhooks，新建 `public.messages` 的 **INSERT** webhook，使用 HTTP POST：
   - URL：`https://yuzgbxeprpohlakxjcut.supabase.co/functions/v1/mailbox-push`
   - Header `Content-Type: application/json`
   - Header `x-mailbox-webhook: 刚生成的 MAILBOX_WEBHOOK_SECRET`
   - 使用 Supabase 默认 webhook payload。
4. 各设备打开邀请房间 → 我们的空间 → 外观与新留言通知 → **开启当前房间离线推送**。这是按房间订阅，最多五台设备/身份/房间；只订阅自己需要的房间。

前端发送成功后另有一次不阻塞聊天的派发请求；数据库 webhook 可以覆盖发完消息立即关闭页面的情况。两者由数据库投递记录去重。失败记录一分钟后可重试，最多五次；当前不含定时失败队列，临时服务故障后需重放 webhook。失效的 404/410 endpoint 自动删除。VAPID 私钥、service-role key 和 webhook secret 都不出现在浏览器。

## 权限和数据边界

- 原 `messages` 表及真实 `created_at` 保留。日记/回忆墙只做展示投影；`display_date` 只改变回忆日期。
- `v2_` 房间凭完整 `#key=` 邀请加入，密钥只以哈希保存在数据库；成员 Auth 身份控制访问。随机 device ID 仅用于旧消息左右显示。
- 旧房间沿用原权限，不会被自动升级成私密房间。资料编辑和创建旧房间确认仍说明这个边界；聊天主界面不常驻开发提示。
- 附件是 `房间/身份/发送nonce` 路径，已发表对象不可覆盖；私有短时签名下载，本机 Blob 预览。允许图片、音视频、PDF/TXT/ZIP、Office 文件；不内嵌执行 HTML/SVG。
- 纪念日由创建者修改；相识日期由成员共享。私人回忆录只有作者身份能读写，同房间对方也无权读取；数据库管理员仍有管理权限，未提供端到端加密。
- 原图 OCR 在浏览器完成。首次从固定 Tesseract CDN 下载 WASM 与中英文模型，模型下载失败可粘贴系统相册识别文字。支持目录优先批量导入、完整长图自动分片、正文/日期/左右方向编辑与逐条或合并确认发送；媒体占位可手动补充，不能自动恢复截图中的原图/语音/视频文件。
- 本地歌曲和 LRC 留在 IndexedDB，不上传；双方导入相同文件，SHA-256 匹配后同步播放/暂停/进度。播放器可收起，歌曲下次打开可恢复。浏览器可能要求双方分别点击一次播放。
- 最近房间、完整邀请链接、邮箱/网址收藏、草稿、未读游标和偏好保存在这台浏览器；更换设备不会自动同步这些本机列表。匿名 Auth 也不能在清除网站数据后恢复到原身份。邮箱收藏不是邮箱账号绑定。
- 系统通知固定显示“你有一条新留言”，不包含正文、昵称、完整邀请链接。订阅 endpoint 仅本人可见。

## 验证与发布

```sh
npm ci
npm run check
npm test
npm run test:db
npm run test:browser
```

逻辑测试使用本机 Node；数据库测试在隔离 PostgreSQL WASM 中执行真实迁移和越权用例；浏览器使用真实 Supabase SDK，但拦截远端请求并返回测试数据。它们不修改线上消息，也不能代替实际 Supabase 配置和手机系统权限验收。

端侧重点：两种身份文字/多引用/附件互发、真实录音、共同歌曲进度和自动播放限制、长截图中文识别质量、关闭页面后的推送送达/点击跳回原房间。iPhone/iPad 通常需将网页添加到主屏幕后使用 Web Push；不同浏览器及系统省电设置会影响后台通知。

GitHub Pages 部署 **main / 根目录**，必须保留整个仓库静态文件结构。前端版本为 `2.3.0`；JS/CSS 入口带版本参数，Service Worker 只处理通知，不缓存页面、消息或媒体。直接访问 [正式页面](https://page0x00.github.io/message-room/)。

若需要回退，恢复前端 Git 提交即可，不反向删除数据表、不清空消息、不关闭 RLS。独立 SQL 文件按顺序升级；不要在已升级功能的线上单独重跑旧的 Auth migration 而不接着执行功能 migration。

依据：[Supabase Database Webhooks](https://supabase.com/docs/guides/database/webhooks)、[Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets)、[MDN PushManager.subscribe](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe)。
