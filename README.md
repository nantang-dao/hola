# Hola

使用 **Semi** 身份登录的示例应用，演示 OAuth 2.0 Authorization Code + PKCE 完整流程。基于 Bun 实现，无任何框架依赖，服务端渲染纯 HTML。

## 快速开始

### 第一步：在 Semi 注册 OAuth 应用

1. 启动 Semi 后端和前端（端口默认分别为 3000、3001）
2. 登录后访问 `https://www.semi.im/oauth/apps`
3. 点击 **注册应用**，填写以下信息：

   | 字段 | 填写内容 |
   |------|---------|
   | 应用名称 | Hola（或任意名称）|
   | 回调地址 | `http://localhost:4000/callback` |
   | 授权范围 | `openid`、`profile`、`wallet` |

4. 点击 **创建**，在弹出的对话框中复制 `client_id` 和 `client_secret`（**secret 只显示一次**）
5. 点击编辑按钮，将应用状态改为 **已上线**（`active`）

> ⚠️ 回调地址必须与 `.env` 中的 `REDIRECT_URI` 完全一致，否则授权会报错。

### 第二步：配置环境变量

复制示例文件并填写：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 应用监听端口
PORT=4000

# 第一步注册应用时获得的凭证
SEMI_CLIENT_ID=semi_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SEMI_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Semi 前端和后端地址（本地开发默认值）
SEMI_FRONTEND_URL=https://www.semi.im
SEMI_BACKEND_URL=https://api.semi.im

# 回调地址，必须与注册时填写的一致
REDIRECT_URI=http://localhost:4000/callback
```

### 第三步：启动

```bash
bun run dev   # 开发模式（热重载）
bun start     # 生产模式
```

打开 `http://localhost:4000`，点击 **使用 Semi 登录** 体验完整流程。

---

## 环境变量说明

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 否 | 服务监听端口，默认 `4000` |
| `SEMI_CLIENT_ID` | 是 | 注册应用时获得的 client_id |
| `SEMI_CLIENT_SECRET` | 是 | 注册应用时获得的 client_secret（仅显示一次） |
| `SEMI_FRONTEND_URL` | 否 | Semi 前端地址，默认 `https://www.semi.im` |
| `SEMI_BACKEND_URL` | 否 | Semi 后端地址，默认 `https://api.semi.im` |
| `REDIRECT_URI` | 否 | OAuth 回调地址，默认 `http://localhost:{PORT}/callback` |

---

## 授权流程说明

```
浏览器                    Hola (4000)              Semi 前端 (3001)       Semi 后端 (3000)
  │                           │                          │                      │
  │  GET /login               │                          │                      │
  │──────────────────────────>│  生成 PKCE verifier+challenge                   │
  │  302 → /oauth/authorize   │                          │                      │
  │<──────────────────────────│                          │                      │
  │                           │                          │                      │
  │  GET /oauth/authorize?... │                          │                      │
  │─────────────────────────────────────────────────────>│                      │
  │  用户同意授权页面          │                          │                      │
  │<─────────────────────────────────────────────────────│                      │
  │  （用户点击授权）          │                          │                      │
  │─────────────────────────────────────────────────────>│ POST /oauth/authorize│
  │                           │                          │─────────────────────>│
  │  302 → /callback?code=... │                          │  { code }            │
  │<─────────────────────────────────────────────────────│<─────────────────────│
  │                           │                          │                      │
  │  GET /callback?code=...   │                          │                      │
  │──────────────────────────>│ POST /oauth/token (code + code_verifier)        │
  │                           │────────────────────────────────────────────────>│
  │                           │  { access_token, refresh_token }                │
  │                           │<────────────────────────────────────────────────│
  │                           │ GET /oauth/userinfo                             │
  │                           │────────────────────────────────────────────────>│
  │                           │  { sub, handle, wallet_address, ... }           │
  │                           │<────────────────────────────────────────────────│
  │  302 → /profile           │                          │                      │
  │<──────────────────────────│                          │                      │
```

### PKCE 安全机制

Hola 在 `/login` 时本地生成一对随机值：

- **code_verifier**：32 字节随机数，base64url 编码，存于内存（与 `state` 绑定，10 分钟有效）
- **code_challenge**：对 verifier 做 SHA-256 再 base64url，发送给 Semi

用户授权后，Semi 返回 `code`；Hola 用 `code` + 原始 `code_verifier` 换取 token。Semi 后端验证 `SHA-256(verifier) == challenge`，确保只有发起授权的一方能完成兑换，防止授权码被截获后滥用。

---

## 接入其他应用

参考以下核心步骤，即可在任意语言的项目中集成 Semi 登录：

### 1. 发起授权

将用户跳转到 Semi 授权页，携带以下参数：

```
GET {SEMI_FRONTEND_URL}/oauth/authorize
  ?response_type=code
  &client_id={CLIENT_ID}
  &redirect_uri={REDIRECT_URI}
  &scope=openid profile wallet
  &state={随机字符串，防 CSRF}
  &code_challenge={SHA-256(verifier) base64url}
  &code_challenge_method=S256
```

### 2. 处理回调

用户授权后，Semi 会跳转到你的 `redirect_uri`，附带 `code` 和 `state`：

```
GET /callback?code=xxxxx&state=xxxxx
```

验证 `state` 一致后，用 `code` 换取 token：

```http
POST {SEMI_BACKEND_URL}/oauth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "xxxxx",
  "client_id": "{CLIENT_ID}",
  "client_secret": "{CLIENT_SECRET}",
  "redirect_uri": "{REDIRECT_URI}",
  "code_verifier": "{第1步生成的 verifier}"
}
```

响应：

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "...",
  "scope": "openid profile wallet"
}
```

### 3. 获取用户信息

```http
GET {SEMI_BACKEND_URL}/oauth/userinfo
Authorization: Bearer {access_token}
```

响应字段（按授权范围返回）：

| 字段 | 所需 scope | 说明 |
|------|-----------|------|
| `sub` | `openid` | 用户唯一 ID |
| `handle` | `profile` | 用户名 |
| `phone_verified` | `profile` | 手机是否已验证 |
| `email_verified` | `profile` | 邮箱是否已验证 |
| `wallet_address` | `wallet` | 主钱包 EVM 地址 |
| `scopes_granted` | 任意 | 实际授予的权限列表 |

### 4. 刷新 Token

```http
POST {SEMI_BACKEND_URL}/oauth/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "refresh_token": "...",
  "client_id": "{CLIENT_ID}",
  "client_secret": "{CLIENT_SECRET}"
}
```

每次刷新会返回新的 `access_token` 和 `refresh_token`，旧的立即失效（token rotation）。

### 5. 吊销 Token

```http
POST {SEMI_BACKEND_URL}/oauth/revoke
Content-Type: application/json

{
  "token": "...",
  "client_id": "{CLIENT_ID}",
  "client_secret": "{CLIENT_SECRET}"
}
```

---

## 常见问题

**Q: 授权页报错 `redirect_uri not registered`**

检查注册应用时填写的回调地址与 `.env` 中 `REDIRECT_URI` 是否完全一致（包括端口号）。

**Q: 令牌交换报错 `Invalid code_verifier`**

`code_verifier` 必须由发起授权的一方持有并在回调时原样提交。不要在中间环节重新生成 PKCE 参数。

**Q: 报错 `Application is not active`**

进入 `https://www.semi.im/oauth/apps`，将应用状态改为 **已上线**。
