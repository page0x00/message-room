# API 与模型 · 2.5.0

从「设置 → API 与模型」或「小小陪伴 → API 与模型」进入。每个账号可保存 12 套连接，保存并启用后，小小陪伴使用该连接。普通聊天、一起听和回忆墙不依赖这些 API。

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

先填名称、渠道、地址和该渠道的密钥；再拉取模型列表或手动填写模型 ID。部分渠道没有 `/models`，列表为空或报错时仍可手动输入。Gemini 列表最多显示当前页的前 500 项，完整模型 ID 可手动输入。测试连接只发送 `{"ok":true}` 的合成测试任务，可能产生少量费用；保存不会调用模型。

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

## 已安装项目如何更新

1. 拉取本分支代码。Supabase SQL Editor 执行 `supabase/migrations/20261008_api_connections.sql`；之前还有未安装的迁移时，执行本分支完整 `supabase/INSTALL.sql`。脚本保留旧聊天和原有数据，可重复执行。
2. **首次开通多连接时**，在 Supabase Secrets 设置 `MAILBOX_API_ENCRYPTION_KEY`，值为随机 32 字节的 Base64 编码，并设置网站的 `MAILBOX_ORIGIN`。不要把 API Key 或加密密钥放进前端源码、Git 或聊天。
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

4. 更新网页到本分支的 2.5.0 源码。在页面选择渠道并保存启用，然后到小小陪伴重新确认当前域名的聊天授权。各作者独立授权，只有授权给相同域名的文字才会进入该模型请求。原有 OpenAI 授权不会自动扩展给其他域名；更换模型或参数也会使旧配置的缓存和在途结果失效。

新网页需要新数据库和两个新函数配套部署。只上传前端不能开通后端功能。

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

配置按账号隔离。API Key 使用 AES-GCM 加密且绑定账号及连接 ID；浏览器角色不能直接读写密文表，只能通过验证 Supabase 登录身份的函数操作。设置保存有版本检查，避免不同设备互相覆盖。

自定义域名必须是公网 HTTPS；服务端解析 DNS 并拒绝私网/本地地址，连接时固定已校验的 IP、保留 TLS 主机名验证，拒绝跳转。错误不会返回服务商原始响应或请求密钥。连接/模型检查限每账号 10 秒一次、每天 60 次；真实记忆整理继续使用原有每房间每用户的授权和调用额度。

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
