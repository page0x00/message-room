# 小小留言室

轻量的异步留言网站，静态前端 + 原有 Supabase。无需构建即可部署；本轮开发直接进入 `main`。

- 简洁 / 暖色主题，手机与平板适配。
- 聊天里自己在左、对方在右；双方昵称头像可自定义。
- 最近加入房间、本机草稿、最多 8 条多引用。
- 聊天 / 日记 / 回忆墙使用同一份消息，显示日期独立于真实发送时间。
- 保留旧链接与旧文字数据；新邀请房间支持匿名 Auth、成员资料与邀请权限。

**先读 [SETUP.md](SETUP.md)**：代码更新不等于数据库已经迁移。旧房间沿用原权限，新房间需要依次执行两份 SQL 并启用 Anonymous Sign-Ins。

一起听、附件、关系页、OCR、回忆录编辑器尚未实现，见 [后续计划](docs/V2_PLAN.md)。

## 开发与验证

```sh
npm ci
npm run check
npm test
npm run test:db
npm run test:browser
```

浏览器测试会启动本地静态服务并拦截所有 Supabase 请求。日常开发可用任意静态 HTTP 服务启动仓库根目录；GitHub Pages 部署时保留完整文件结构。

## 文件说明

| 路径                        | 用途                                   |
| --------------------------- | -------------------------------------- |
| `index.html` / `styles.css` | 页面结构与双主题                       |
| `app.js`                    | 交互、房间、草稿与三种视图             |
| `core.js`                   | 校验、身份显示判断、排序等纯逻辑       |
| `backend.js`                | Supabase Auth / 数据 / Realtime        |
| `vendor/`                   | 固定版本 SDK 与许可证                  |
| `supabase/migrations/`      | 增量数据库迁移，不删除旧消息           |
| `tests/`                    | 逻辑、浏览器与隔离 PostgreSQL 权限测试 |
