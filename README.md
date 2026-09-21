# 小小留言室

[打开留言室](https://page0x00.github.io/message-room/) · [Supabase 开通步骤](SETUP.md)

四种心情，留给重要的人。静态前端 + 原有 Supabase，直接部署到 GitHub Pages。

- Ins Light / Ins Dark / Warm Light / Warm Dark：独立配色和窗景；手机、平板横竖屏、电脑布局。
- 首页最近联系人、置顶/未读/搜索；`＋` 创建加入，网址/邮箱收藏。聊天自己右、对方左，双方昵称头像可自定义。
- 左滑进入关系空间：认识天数、纪念日、按日整理的日记、错落回忆墙、私人回忆录、一起听。
- 长按/右键多选：合并转发、逐条转发、收藏、本机删除/恢复、最多 8 条可追溯引用；补录显示日期保留真实创建时间，草稿/安全重试、历史分页。
- 私有图片/语音/视频/文档，麦克风录制、试听、进度、失败重试。
- 本地歌曲/LRC 保留在本机；同文件身份校验、共享播放/暂停/进度，可边聊边听。
- [P2 批量截图](docs/P2_IMPORT.md)：目录优先/多选回退、时间排序、内容去重、完整长图分片 OCR、日期/左右方向与合并整理、可编辑确认发送；私人回忆录保存及导出。
- Toast、未读/标题/应用角标、可选提示音、权限触发的系统通知；离线 Push 客户端、订阅/RLS、VAPID Edge Function、webhook 去重均已提供，需配置 Secrets 和 webhook。

**代码更新不等于数据库已经迁移。** 基础开通只需执行 [`supabase/INSTALL.sql`](supabase/INSTALL.sql) 并启用 Anonymous Sign-Ins。旧数据不会清空。真实双设备一起听、OCR 质量、麦克风/系统通知/离线推送送达需部署后验收。

```sh
npm ci
npm run check
npm test
npm run test:db
npm run test:browser
```

| 文件 | 用途 |
| --- | --- |
| `index.html`, `styles.css`, `ui-v2.css`, `assets/` | 页面、四主题及本地窗景 |
| `app.js`, `core.js`, `backend.js` | 聊天、身份、排序、草稿、Supabase |
| `ui-v2.js`, `notifications.js`, `sw.js` | 关系空间、联系列表、通知 |
| `features.js`, `feature-core.js`, `feature-backend.js` | 附件、纪念、一起听、回忆录 |
| `screenshot-import.js`, `screenshot-store.js`, `import-core.js`, `ocr.js`, `ocr-layout.js` | 批量截图、分片识别、草稿和安全重试 |
| `message-actions.js`, `interactions.css`, `local-music.js` | 长按多选、转发/收藏/本机删除、音频持久化 |
| `supabase/migrations/`, `supabase/INSTALL.sql` | 增量迁移及一份完整安装 SQL |
| `supabase/functions/mailbox-push/` | 经过身份检查的离线推送服务 |
| `tests/` | 逻辑、浏览器与隔离 PostgreSQL 检查 |

本机保存的邀请链接/联系人和匿名身份请自行保管；换设备不会自动恢复原身份。旧房间沿用原权限，新邀请房间才有成员隔离。原始数据与展示视图不复制成多份。
