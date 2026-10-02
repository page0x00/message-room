# 小小留言室 2.3 · 开通步骤

更新 GitHub Pages 会更新前端，**不会自动修改 Supabase**。当前环境没有线上数据库管理员权限，以下操作需要项目所有者执行。旧 `messages` 不删除、不清空。

## 基础功能：只需两步

1. Supabase → SQL Editor，打开仓库的 [`supabase/INSTALL.sql`](supabase/INSTALL.sql)，复制整份 SQL 执行一次。它把当前全部增量 migration 合成一个事务，可重复执行；已有旧留言会保留，已有邀请房间也不会重建。若执行失败，整个事务回滚。也可以按文件名顺序分别执行 `supabase/migrations/` 下的全部 SQL。
2. Authentication → Sign In / Providers，启用 **Email**；需要访客时同时启用 **Anonymous Sign-Ins** 与 **Manual Linking**。保持项目现有的验证码等安全设置；如已强制 CAPTCHA，当前还需要补接该组件，不要关闭它来绕过。

本轮关系空间更新需要新的增量迁移。已经安装旧版的项目，也请执行本分支完整 `INSTALL.sql`，或依次执行所有尚未执行的 migration。

刷新网页，点首页 `＋` 新建邀请房间，把完整链接交给朋友。已有邀请成员可从最近列表返回；旧链接继续收发文字。

SQL 一并配置私有 `message-media` bucket（20 MB）、成员/附件/纪念日/回忆录 RLS、一起听 RPC、Realtime publication、Push 订阅和投递去重表。**不需要手动把 bucket 设成 public，也不需要另买服务器。**

| 当前数据库状态 | 可用范围 |
| --- | --- |
| 尚未升级的旧库 | 旧消息可读；新消息发送要求补齐稳定作者字段，不能回退设备身份 |
| 完整 INSTALL + 邮箱 Auth | 聊天、文件、消息卡片、日常与荷包、一起听、回忆墙及私人胶片 |
| 再部署推送与定时脚本 | 具备后台通知和失败重试能力；系统权限、实际送达需端侧验收 |
| 再部署 AI 服务并获得成员授权 | AI 小宠物读取授权普通文字；未配置时明确显示暂未连接 |

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

前端发送成功后另有一次不阻塞聊天的派发请求；数据库 webhook 可以覆盖发完消息立即关闭页面的情况。两者由数据库投递记录去重。失败记录一分钟后可重试，最多五次；执行下方定时脚本后，每五分钟继续处理提醒和近 24 小时新消息的失败投递，每轮最多 20 个投递任务。失效的 404/410 endpoint 自动删除。VAPID 私钥、service-role key 和 webhook secret 都不出现在浏览器。

## 权限和数据边界

- 原 `messages` 表及真实 `created_at` 保留。聊天记录仍可投影到日记/回忆墙；独立日记存入 `space_entries`，不混入聊天。`display_date` 只改变回忆日期。
- `v2_` 房间凭完整 `#key=` 邀请加入，密钥只以哈希保存在数据库；成员 Auth 身份控制访问。消息归属只使用 `author_id === auth.uid()`；没有可信作者 UUID 的旧消息不自动认领。
- 旧房间沿用原权限，不会被自动升级成私密房间。资料编辑和创建旧房间确认仍说明这个边界；聊天主界面不常驻开发提示。
- 附件是 `房间/身份/发送nonce` 路径，已发表对象不可覆盖；私有短时签名下载，本机 Blob 预览。允许图片、音视频、PDF/TXT/ZIP、Office 文件；不内嵌执行 HTML/SVG。
- 纪念日由创建者修改；相识日期由成员共享。私人回忆录只有作者身份能读写，同房间对方也无权读取；数据库管理员仍有管理权限，未提供端到端加密。
- 原图 OCR 在浏览器完成。首次从固定 Tesseract CDN 下载 WASM 与中英文模型，模型下载失败可粘贴系统相册识别文字。支持独立文件选择与目录扫描预览确认、完整长图自动分片、正文/日期/左右方向编辑与逐条或合并确认发送；媒体占位可手动补充，不能自动恢复截图中的原图/语音/视频文件。
- 本地歌曲和 LRC 留在 IndexedDB，不上传；双方导入相同文件，SHA-256 匹配后同步播放/暂停/进度。播放器可收起，歌曲下次打开可恢复。浏览器可能要求双方分别点击一次播放。
- 已加入邀请房间可从账号成员关系找回。完整邀请链接、邮箱/网址收藏、草稿、未读游标和偏好仍是按 UUID 隔离的本机数据。使用账号页绑定邮箱后，新设备登录同一邮箱即可保持 UUID；未绑定的访客在清除网站数据后无法恢复。邮箱收藏与绑定登录邮箱是两个功能。
- 系统通知按新留言、打卡、待办、纪念、荷包、冷静期、一起听等类型显示固定通用文案，不包含正文、昵称、完整邀请链接。订阅 endpoint 仅本人可见。

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

GitHub Pages 部署 **main / 根目录**，必须保留整个仓库静态文件结构。本更新分支前端版本为 `2.4.0`；JS/CSS 入口带版本参数，Service Worker 只处理通知，不缓存页面、消息或媒体。直接访问 [正式页面](https://page0x00.github.io/message-room/)。

若需要回退，恢复前端 Git 提交即可，不反向删除数据表、不清空消息、不关闭 RLS。独立 SQL 文件按顺序升级；不要在已升级功能的线上单独重跑旧的 Auth migration 而不接着执行功能 migration。

依据：[Supabase Database Webhooks](https://supabase.com/docs/guides/database/webhooks)、[Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets)、[MDN PushManager.subscribe](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe)。


## 本轮更新分支：账号与日常空间

此轮源码位于 `update/relationship-space-20261001`，不会自动合并 main 或替换正式 GitHub Pages。将前端与数据库都部署后才能进行真实双设备验收。

1. SQL Editor 执行本分支完整 `supabase/INSTALL.sql`。已完成 2.3 配置的项目也可以依次执行 从 `20261001_identity.sql` 至 `20261007_notices.sql` 的全部增量文件，不要遗漏中间文件。脚本增量添加字段、表、权限和 RPC，保留旧消息。
2. Auth 开启 Email；保留访客时同时保留 Anonymous Sign-Ins 与 Manual Linking。设置站点和测试预览 Redirect URLs。在原设备先绑定邮箱，再在新设备登录相同邮箱。详见 `docs/UPDATE_20261001.md`。
3. 新增记录表 `space_entries`、`pockets`、`pocket_entries`、`pocket_leaves` 已在 migration 设置 RLS 与 Realtime；私有图片仍用现有 `message-media`，读权限随记录的私人/共享属性变化。
4. 荷包 RPC 是记账操作，不接支付平台或托管资金。冷静期与余额检查只允许服务端更新，浏览器不得直接修改交易表。应用内提醒已接通；后台打卡/纪念日/荷包提醒和一起听邀请需下述定时推送配置。

新增本地检查：`npm run test:space`、`npm run test:daily`。跨设备身份、原生文件选择器、邮箱回链、实时订阅、实际 Storage 及系统权限仍应在真实环境验收。

### 一起听升级

执行增量 `20261004_music_space.sql`（或重跑完整 INSTALL）。音乐原文件仍由双方自行导入，音频只存本机；歌曲资料默认私人，喜欢、邀请一起听、加入共享歌单时明确共享资料。报告时区为 Asia/Shanghai。后台暂停 JavaScript 的设备会少计未确认时段，不用在线时长补算。共享与私人歌单已分别设 RLS；无需新增第三方音乐 API 密钥。

### 回忆墙与胶片

`20261005_memories.sql` 创建私有布局/补充记录与引用式胶片。便签墙、线索板、唱片墙共用来源；删胶片不删聊天、日记或图片。背景音乐按私有 Storage 权限读取。胶片实时在网页播放，没有生成可导出的 MP4。倒带目前按回忆幕逆序快闪，视频幕不会把原视频文件解码倒放。

### 后台提醒与定时重试

1. 部署最新 `mailbox-push`，将随机 **MAILBOX_CRON_SECRET** 放在 Edge Function Secrets。
2. Dashboard 中启用 **pg_cron** 和 **pg_net**。在 **Vault** 建立 `mailbox_project_url`（项目 HTTPS 地址）、`mailbox_cron_secret`（与上述随机值相同）。不要把值复制进仓库或聊天。
3. SQL Editor 执行 [`supabase/SCHEDULE_PUSH.sql`](supabase/SCHEDULE_PUSH.sql)。同名任务可重复配置，每五分钟派发一次，使用数据库真实状态筛选和去重；已打卡、已存足、有效假条和已读邀请不再送对应提醒。
4. 在每个需要提醒的设备、房间主动开启离线推送。浏览器不支持 Push 或拒绝授权时，网页内提醒列表仍然可用。无法绕过系统权限、强制振铃或保证省电模式下即时送达。
5. `mailbox-reminders-and-retries` 运行记录和 Edge 日志可核对送达失败。密钥轮换需同步更新 Secrets 与 Vault；客户端不会知道私钥。

### AI 小宠物

1. 在 Edge Function Secrets 设置 **OPENAI_API_KEY**、**MAILBOX_PET_MODEL**（你账户可用并支持 Responses 结构化输出的模型 ID），以及实际网站 Origin 对应的 **MAILBOX_ORIGIN**。
2. 部署 `supabase functions deploy mailbox-pet --project-ref yuzgbxeprpohlakxjcut`。仅服务端使用 AI 密钥；函数先通过 Supabase `auth.getUser` 验证用户，再从数据库读取范围，拒绝浏览器伪造他人身份或提交任意聊天当上下文。
3. 各成员在「小小陪伴 → 它可以记住什么」分别允许自己的文字及日期范围。默认不开启；朋友未授权的内容、旧消息未知作者、截图/OCR/转发、媒体与私人日记不送给模型。
4. 手动生成或勾选网页打开时自动整理。每次最多 120 条、每条最多 1500 字符；同一份上下文直接复用，房间内每个用户最多 12 次尝试/上海自然日，间隔至少两分钟。模型失败不使用固定文案冒充结果。
5. 生成记录仅当前用户可见；显示原消息依据。撤回或调整授权会删除这个房间旧范围的派生状态，同时使在途结果失效。原始聊天保留。已经提交给提供商处理的数据不等于能由本应用追溯删除；接口使用 `store:false`，不承诺提供商零保留。

本轮本地测试使用模拟的模型与推送响应，**没有使用真实 API 密钥付费生成，也没有修改线上 Supabase**。上线后的模型可用性、延迟、费用与双设备推送需配置后验证。

参考：[OpenAI 结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)、[Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)、[Supabase 定时 Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)。

### 本轮完整验证命令

```sh
npm run check
npm test
npm run test:db
npm run test:browser
npm run test:space
npm run test:daily
npm run test:music
npm run test:memory
npm run test:film
npm run test:companion
```

本轮源码只提交到 `update/relationship-space-20261001`，未改变 main 的部署来源。不应把分支提交、SQL 文件和函数源码当成已上线。
