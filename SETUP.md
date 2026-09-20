# 小小留言室 v2：上线设置

代码已支持旧库兼容模式。**提交 GitHub 不会自动执行 Supabase SQL，也不会自动开启 Auth。**

## 你需要操作的两步

1. 打开当前 Supabase 项目 → SQL Editor，先备份/导出 `messages`，再按顺序执行：
   - [`supabase/migrations/20260920_mailbox_v2.sql`](supabase/migrations/20260920_mailbox_v2.sql)
   - [`supabase/migrations/20260921_mailbox_auth.sql`](supabase/migrations/20260921_mailbox_auth.sql)
     如果第一份之前已经执行，直接运行第二份即可；两份均做了可重复执行处理。
2. 在 Supabase 的 Authentication 配置中启用 **Anonymous Sign-Ins（匿名登录）**。界面入口可能随 Dashboard 版本变化，设置名保持不变。

然后刷新网页。新建邀请房间，复制菜单中的**完整邀请链接**给朋友。旧房间无需重建，也不会自动转换成邀请房间。

无需购买新服务器。继续使用现有静态托管与 Supabase 项目；具体额度按你的套餐计算。

## 三种数据库状态

| 当前状态             | 可用功能                                                      | 限制                                           |
| -------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| 尚未迁移             | 旧文字收发、双主题、本机资料、最近房间、三视图、草稿          | 引用/显示日期不可写；旧房间沿用原权限          |
| 仅执行第一份迁移     | 上述功能 + 新消息引用/显示日期                                | 成员资料仍仅本机；不可创建邀请房间             |
| 两份迁移 + 匿名 Auth | 邀请房间、成员昵称/头像同步、原草稿幂等重试、本人消息日期编辑 | 旧房间不自动变私密；匿名身份不可自动跨设备恢复 |

“对方备注/替换头像”始终是本机覆盖，不会篡改对方成员资料。自定义头像在浏览器裁为 128×128 JPEG，再保存在成员字段；本阶段**没有开放媒体 Storage 上传**。

## 权限与兼容边界

- 旧表 `public.messages` 保留。旧客户端继续使用 `room_id / content / sender / sender_name / created_at`；新增列不会改写原始消息。
- 新邀请房间使用保留前缀 `v2_` 和独立的 64 字符十六进制邀请密钥（由两段随机 UUID 生成）。数据库只保存密钥摘要，完整密钥放在 URL 的 `#key=` 片段和本机最近列表中。
- `mailbox_join_room` 只允许已认证用户凭正确密钥加入。成员仅能编辑自己的资料；随机 `device_id` **从不用于数据库授权**，只用于识别本机旧消息的显示侧。
- `messages` 的 restrictive RLS guards 会与原有 permissive 策略一起生效，防止旧的 `USING(true)` 意外暴露新房间。即使原库未开启 RLS，也只为非 `v2_` 行保留原访问语义。
- 迁移不会自动收紧旧房间；旧房间 UI 明示“旧版兼容/原有公开权限”。不要把它当成受保护的私密存储。新房间不能在认证失败时自动退回公开模式。
- 迁移若发现现存旧房间占用了 `v2_` 前缀，会停止并回滚第二份迁移。先处理冲突，不要删除消息或去掉权限检查。
- 新消息的真实 `created_at` 由数据库生成且不可编辑。只有作者可编辑 `display_date`；跨房间引用、冒用 author、移出受保护房间、删除受保护消息都被拒绝。
- 本阶段 `memoirs / anniversaries / listen_sessions / message-media` 仍关闭客户端访问。不要设置 public bucket 或增加宽泛匿名策略。
- 受保护不等于端到端加密：数据库管理员仍可访问数据库。邀请链接持有者可以加入，不要在公开平台发布完整链接。

## 匿名身份注意事项

匿名登录不要求邮箱，但身份保存在当前浏览器。**清除网站数据、退出身份或换设备会失去原身份**；用邀请链接重新加入会成为新的成员。当前没有账号绑定/恢复入口，请不要把匿名身份当作可恢复账号。

公开推广前需接入验证码与滥用控制。本阶段不包含 CAPTCHA 组件；如果项目已经要求验证码，客户端会提示失败，**不要为了通过测试关闭你现有的安全配置**。先实现验证码流程，再扩大使用范围。

参考：[Supabase 匿名登录](https://supabase.com/docs/guides/auth/auth-anonymous)、[RLS 与权限](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## Realtime 与验证

两份迁移将 `messages` 和 `room_members` 加入 `supabase_realtime` publication。项目中应保留这两个表的 Realtime 权限。连接异常时前端在页面可见期间每 30 秒补拉一次，手动“刷新”也可用；不会因此重发消息。

本机运行 `npm ci`，然后：

```sh
npm run check
npm test
npm run test:db
npm run test:browser
```

数据库测试在独立的 PostgreSQL WASM 环境执行真实迁移，并模拟 Supabase 的 auth/storage 角色；浏览器测试使用真实 SDK，但拦截全部 Supabase 请求。**这些测试不会触碰线上数据，也不能替代线上部署后的双设备验收。**

上线后自行核验：

1. 原旧链接能加载/发送，旧消息数量没有减少。
2. 浏览器 A 新建房间，浏览器 B 用完整邀请链接加入并发送，两边都“自己左、对方右”。
3. 浏览器 C 只拿房间号或不带密钥的链接，不能读取新消息。
4. 修改头像昵称后另一端刷新可见；对方备注只在本机生效。
5. 对一条本人消息改显示日期，日记/回忆墙变化，而真实发送时间保持不变。

## 前端部署与回退

这是无构建步骤的静态项目。部署需同时保留 `index.html / styles.css / app.js / core.js / backend.js / vendor/`，支持 GitHub Pages 子路径；不能只上传 index.html。必须使用 HTTP/HTTPS 访问，不能直接双击 `file://`。

SDK 固定为 `@supabase/supabase-js@2.57.4` 并随项目提供，避免运行时依赖 CDN；原许可证保存在 `vendor/SUPABASE-LICENSE`。浏览器代码仅包含原项目的 publishable key，无 service-role key 或外部 OCR 私钥。

回退前端可用 Git 历史恢复旧提交 `a3ebe24` 中的 `index.html`，但旧客户端**只能继续访问旧房间**，不支持新的邀请房间。不要反向删除表/列、关闭新 RLS 或清空数据库来“回退”。新功能尚未启用时也不需要回滚数据库。
