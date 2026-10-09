# API 与模型 · 2.7.3

从「设置 → API 与模型」或「小小陪伴 → API 与模型」进入。默认打开**本机直连**，填写 URL、Key 和模型，点击「测试连接」或「保存并启用」。配置名称可不填，模型可从接口拉取后选择。每种模式最多保存 12 套连接。普通聊天、一起听和回忆墙不依赖这些 API。

## 本机直连，不用数据库保存 Key

- 模型和模型列表由浏览器直接请求所填渠道。API Key 不传给 Supabase，不经过 Edge Function，也不需要配置 `MAILBOX_API_ENCRYPTION_KEY`。
- 默认保存在当前标签页会话中，刷新仍可使用，关闭标签页后失效；退出账号会清除该账号的会话配置。勾选「记住本机」后才写入此浏览器的持久存储，适合自己的设备。
- 本机保存不等于加密保管：此浏览器的网站数据、同源脚本和有权限的扩展可能读取它。页面不会回显已存 Key；可以删除单套配置或点「清空本机配置」。本机连接不会自动同步到其他设备。
- 改变接口域名需要重新填写该渠道的 Key。切换到「账号同步」只是查看云端配置，必须点击保存并启用才会改变调用方式；不会自动把本机 Key 上传。
- 接口需允许本网站的浏览器跨域请求（CORS）。网络失败、跨域阻止和重定向可能无法由 JavaScript 精确区分，页面会提示检查这些因素，不会自动改走第三方代理或账号同步。
- 多协议、参数、排除规则和请求预览与账号同步模式共用，作用于浏览器实际发送的请求。

**仅配置、拉取模型和测试直连：更新前端即可，不需要 API 数据库、Secrets 或函数部署。**

**小小陪伴的聊天授权和生成结果同步**仍用现有数据库，Key 不参与这部分请求。站点主人需核对 `main` 的 `supabase/INSTALL.sql` 所含迁移是否已应用；已完成 2.5.0 SQL 的项目只需执行 `supabase/migrations/20261009_direct_api.sql`。新增的两个 RPC 按登录身份读取已授权文字、检查来源并保存私有结果，不接收 API Key 或完整配置，只接收授权域名和不含密钥的配置指纹。本机模式不需要部署 `mailbox-api` / `mailbox-pet`。

浏览器生成结果不能像服务端调用那样证明一定出自模型；数据库仍会验证结果结构、来源属于已授权聊天、用户身份、调用预算和未过期请求。结果仅本人可见。

## 可选：账号同步

如需跨设备同步配置，手动选择「账号同步」再保存并启用，继续使用服务端加密配置及调用链。此模式的部署步骤见下文，只有选择此模式才需要加密密钥与 API Edge Functions。

## 两种模式支持的渠道

| 渠道 | 预设协议 | 地址填写方式 |
| --- | --- | --- |
| OpenAI 官方 | Responses | 默认 `https://api.openai.com/v1` |
| Anthropic 官方 | Messages | 默认 `https://api.anthropic.com/v1` |
| Google Gemini 官方 | generateContent | 默认 `https://generativelanguage.googleapis.com/v1beta` |
| DeepSeek 官方 | Chat Completions | 默认 `https://api.deepseek.com/v1` |
| Azure OpenAI 云托管 | Chat Completions | `https://你的资源名.openai.azure.com/openai/v1`，模型填部署名 |
| OpenRouter 聚合渠道 | Chat Completions | 默认 `https://openrouter.ai/api/v1`，模型 ID 包含供应商前缀 |
| 第三方 / 公益站 | 可选四种协议 | 填渠道提供的 HTTPS Base URL，地址变更后可直接修改 |

这些是协议预设，不代表应用与任何渠道有商业合作。自定义配置同样支持 Bearer、api-key、x-api-key 和 x-goog-api-key 鉴权。不支持 AWS SigV4 或需要 OAuth 登录的接口。模型权限、费用及参数支持由相应渠道决定。

先填渠道、地址和该渠道的密钥；再拉取模型列表或手动填写模型 ID。部分渠道没有 `/models`，列表为空或报错时仍可手动输入。Gemini 列表最多显示当前页的前 500 项，完整模型 ID 可手动输入。测试连接只发送 `{"ok":true}` 的合成测试任务，可能产生少量费用；保存不会调用模型。

## 参数与排除

常用项有 temperature、top_p、最大输出 tokens、频率/存在惩罚、seed、top_k、停止词、思考强度和超时。界面只显示当前协议支持的常用项；留空不会强行发送，最大输出默认 1800，超时默认 55 秒。`0` 是有效值，不会被当成空值丢掉。

高级参数填写 JSON 对象，例如 OpenRouter 路由偏好或模型专有的思考参数。合并顺序为 **默认请求 → 常用设置 → 高级参数 → 排除规则**。排除填写的是最终请求中的真实字段名，可用点路径，每行一项：

```text
temperature
response_format
max_tokens
reasoning.effort
```

例如一个 Chat Completions 模型要求 `max_completion_tokens`：高级参数填写 `{"max_completion_tokens":3000}`，排除 `max_tokens`。Responses 可排除 `text.format`；Gemini 可排除 `generationConfig.responseMimeType` / `generationConfig.responseJsonSchema`。Anthropic 的 `max_tokens` 是必需项，不能排除。模型、聊天内容、工具调用、流式模式和存储开关由应用管理，不能通过高级参数覆盖。

预览展示合成测试的最终 URL 和请求体，不包含密钥和真实聊天。JSON 模式或严格 Schema 报错时，可改用提示词约束；所有模式最终都要通过完整 JSON、真实消息来源和长度校验，失败不会覆盖已有记忆。不支持流式回应或工具执行。

## 账号同步模式如何部署

1. 拉取 `main` 最新代码。核对迁移记录，尚未安装时在 Supabase SQL Editor 执行 `supabase/migrations/20261008_api_connections.sql`；之前还有未安装的迁移时，执行完整 `supabase/INSTALL.sql`。脚本保留旧聊天和原有数据，可重复执行。
2. **首次开通账号同步模式时**，在 Supabase Secrets 设置 `MAILBOX_API_ENCRYPTION_KEY`，值为随机 32 字节的 Base64 编码，并设置网站的 `MAILBOX_ORIGIN`。不要把 API Key 或加密密钥放进前端源码、Git 或聊天。
3. 部署下面两个函数。现有 `mailbox-push` 无需重新配置。

```sh
supabase functions deploy mailbox-api --project-ref yuzgbxeprpohlakxjcut
supabase functions deploy mailbox-pet --project-ref yuzgbxeprpohlakxjcut
```

在已有 Supabase CLI 的 Termux / 电脑终端，可用下面命令**首次**生成并上传加密密钥，不在终端输出密钥内容。需要本机有 `openssl`：

```sh
umask 077
api_secret_file="$(mktemp)"
printf 'MAILBOX_API_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" > "$api_secret_file"
supabase secrets set --env-file "$api_secret_file" --project-ref yuzgbxeprpohlakxjcut
rm "$api_secret_file"
```

**正常更新只重新部署函数，不重新生成加密密钥。** 更换该密钥后，旧密文无法解密，需要在每套连接重新填写 API Key。密钥输入留空表示保留已存密钥；更换接口域名时必须重新填写，避免把旧渠道的密钥带到新站点。删除配置同时删除对应密文。

4. 正式网页已包含本机直连与账号同步面板；自行部署时使用 `main` 最新源码。在页面选择渠道并保存启用，然后到小小陪伴重新确认当前域名的聊天授权。各作者独立授权，只有授权给相同域名的文字才会进入该模型请求。原有 OpenAI 授权不会自动扩展给其他域名；更换模型或参数也会使旧配置的缓存和在途结果失效。

账号同步模式需要数据库和两个函数配套部署。本机 API 直连不依赖这两个函数；小小陪伴的授权与结果同步只需更新 SQL。

## 已有站点默认配置

保留 `OPENAI_API_KEY` + `MAILBOX_PET_MODEL` 的旧 OpenAI Responses 配置。选择「使用站点默认」时才使用它；个人连接启用后优先使用个人配置。

若之前把 **OpenRouter 的密钥填在 `OPENAI_API_KEY`**，它不会因此变成 OpenAI 密钥。推荐直接在页面建 OpenRouter 连接；也可把默认环境变量改为：

```text
MAILBOX_API_BASE_URL=https://openrouter.ai/api/v1
MAILBOX_API_PROTOCOL=chat
MAILBOX_API_AUTH=bearer
MAILBOX_API_FORMAT=json
MAILBOX_PET_MODEL=你的供应商/模型ID
```

默认密钥可放 `MAILBOX_API_KEY`（优先）或沿用 `OPENAI_API_KEY`。默认配置的格式可选 `schema`、`json`、`prompt`，具体模型不支持 JSON 模式时用 `prompt`。默认密钥不回传浏览器。

## 数据与验证

账号同步模式的配置按账号隔离。API Key 使用 AES-GCM 加密且绑定账号及连接 ID；浏览器角色不能直接读写密文表，只能通过验证 Supabase 登录身份的函数操作。设置保存有版本检查，避免不同设备互相覆盖。

自定义域名必须是公网 HTTPS；账号同步模式在服务端解析 DNS 并拒绝私网/本地地址，连接时固定已校验的 IP、保留 TLS 主机名验证，拒绝跳转。错误不会返回服务商原始响应或请求密钥。账号同步模式的连接/模型检查限每账号 10 秒一次、每天 60 次；真实记忆整理继续使用原有每房间每用户的授权和调用额度。

Responses 请求保留 `store:false`；其他渠道的保留规则由其自身约定。撤回授权会清除本应用派生记忆并拦截在途结果，不等于追溯删除服务商已处理的数据。

```sh
npm run check
npm test
npm run test:db
npm run test:api
npm run test:companion
```

本地验证使用模拟模型，不使用真实付费密钥，也不修改线上 Supabase。部署后需用自己的渠道完成一次连接测试。

协议参考：[OpenRouter](https://openrouter.ai/docs/api-reference/overview)、[Anthropic](https://platform.claude.com/docs/en/api/overview)、[Gemini](https://ai.google.dev/api/generate-content)、[DeepSeek](https://api-docs.deepseek.com/)、[Azure OpenAI v1](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/switching-endpoints)、[OpenAI Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)。

浏览器直连参考：[CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)、[Anthropic 浏览器调用选项](https://github.com/anthropics/anthropic-sdk-typescript)。
