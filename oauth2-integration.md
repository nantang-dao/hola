# Semi OAuth2 集成指南

Semi 提供基于 **OAuth 2.0 Authorization Code Flow + PKCE** 的第三方登录与授权能力，支持 OpenID Connect 标准。第三方应用可通过该协议获取用户的身份信息、钱包地址等数据，无需处理用户凭据。

---

## 目录

1. [快速概览](#1-快速概览)
2. [注册 OAuth 应用](#2-注册-oauth-应用)
3. [可申请的权限范围（Scopes）](#3-可申请的权限范围scopes)
4. [授权流程（Authorization Code + PKCE）](#4-授权流程authorization-code--pkce)
5. [接口参考](#5-接口参考)
6. [Token 管理](#6-token-管理)
7. [验证 ID Token（OIDC）](#7-验证-id-tokenoidc)
8. [错误处理](#8-错误处理)
9. [安全注意事项](#9-安全注意事项)
10. [示例代码](#10-示例代码)

---

## 1. 快速概览

| 项目 | 值 |
|---|---|
| **Issuer** | `https://api.semi.im` |
| **授权端点** | `https://api.semi.im/oauth/authorize` |
| **Token 端点** | `https://api.semi.im/oauth/token` |
| **用户信息端点** | `https://api.semi.im/oauth/userinfo` |
| **Token 吊销端点** | `https://api.semi.im/oauth/revoke` |
| **JWKS 端点** | `https://api.semi.im/oauth/jwks` |
| **OIDC Discovery** | `https://api.semi.im/.well-known/openid-configuration` |
| **支持的 Grant Type** | `authorization_code`, `refresh_token` |
| **PKCE** | 必须（仅支持 `S256`） |
| **Token 签名算法** | RS256 |
| **Client 认证方式** | `client_secret_post` |

---

## 2. 注册 OAuth 应用

在使用 Semi OAuth 之前，需要先注册一个 OAuth 应用以获取 `client_id` 和 `client_secret`。

### 2.1 创建应用

登录 Semi 后访问 **设置 → OAuth 应用**（`/oauth/apps`），点击「新建应用」，填写：

| 字段 | 说明 |
|---|---|
| **应用名称** | 用户授权时展示的应用名 |
| **回调地址（redirect_uris）** | 授权完成后跳转的 URL，可填写多个，支持 HTTPS |
| **申请的权限（Scopes）** | 选择应用所需的数据范围（见第 3 节） |

创建成功后，页面将**一次性**展示 `client_secret`，请立即保存。之后只能重置，无法再次查看。

### 2.2 client_id 格式

```
semi_<32位十六进制字符串>
```

示例：`semi_a1b2c3d4e5f6...`

### 2.3 应用状态

| 状态 | 说明 |
|---|---|
| `draft` | 草稿，授权流程不可用 |
| `active` | 激活，可正常使用 |
| `disabled` | 已禁用 |

---

## 3. 可申请的权限范围（Scopes）

| Scope | 描述 | 返回字段 |
|---|---|---|
| `openid` | **必须**。验证用户身份，获取用户唯一 ID | `sub` |
| `profile` | 用户公开资料 | `handle`、`phone_verified`、`email_verified` |
| `wallet` | 用户的主 EVM 钱包地址 | `wallet_address` |
| `token:read` | 用户的 Token 和积分余额 | `token_balance`、`points_balance` |

> `openid` 必须包含在所有授权请求中。

---

## 4. 授权流程（Authorization Code + PKCE）

Semi 仅支持带 PKCE 的授权码流程，适用于所有类型的应用（服务端应用、SPA、移动应用）。

### 流程总览

```
+-----------+                               +----------------+          +-----------+
|   Client  |                               |  Semi (AuthZ)  |          |   User    |
+-----------+                               +----------------+          +-----------+
      |                                             |                        |
      |  1. 生成 code_verifier & code_challenge     |                        |
      |                                             |                        |
      |  2. 重定向用户到 /oauth/authorize            |                        |
      |-------------------------------------------->|                        |
      |                                             |  3. 展示授权同意页      |
      |                                             |----------------------->|
      |                                             |  4. 用户点击「授权」    |
      |                                             |<-----------------------|
      |  5. 带 code 重定向回 redirect_uri           |                        |
      |<--------------------------------------------|                        |
      |                                             |                        |
      |  6. POST /oauth/token (code + verifier)     |                        |
      |-------------------------------------------->|                        |
      |  7. 返回 access_token + refresh_token       |                        |
      |<--------------------------------------------|                        |
      |                                             |                        |
      |  8. GET /oauth/userinfo (Bearer token)      |                        |
      |-------------------------------------------->|                        |
      |  9. 返回用户数据                            |                        |
      |<--------------------------------------------|                        |
```

---

### 第一步：生成 PKCE 参数

在发起授权请求前，生成一对 `code_verifier` / `code_challenge`：

```javascript
// 生成 code_verifier（32字节随机字符串，base64url 编码）
function generateCodeVerifier() {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// 生成 code_challenge（code_verifier 的 SHA-256 哈希，base64url 编码）
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
```

**务必将 `code_verifier` 临时保存在本地**（如 sessionStorage），后续换取 Token 时需要用到。

---

### 第二步：重定向用户到授权页

构建授权 URL 并将用户浏览器重定向过去：

```
GET https://api.semi.im/oauth/authorize
  ?response_type=code
  &client_id=semi_xxxxxxxx
  &redirect_uri=https://yourapp.com/callback
  &scope=openid%20profile%20wallet
  &state=随机防CSRF字符串
  &code_challenge=BASE64URL(SHA256(code_verifier))
  &code_challenge_method=S256
```

| 参数 | 必须 | 说明 |
|---|---|---|
| `response_type` | ✅ | 固定值 `code` |
| `client_id` | ✅ | 注册应用时获得 |
| `redirect_uri` | ✅ | 必须与注册时完全匹配 |
| `scope` | ✅ | 空格分隔的权限列表，必须包含 `openid` |
| `state` | 推荐 | 随机字符串，用于防止 CSRF；Semi 会原样返回 |
| `code_challenge` | ✅ | PKCE 挑战值 |
| `code_challenge_method` | ✅ | 固定值 `S256` |

用户会看到 Semi 的授权同意页，展示应用名称及所申请的权限，用户确认后跳回 `redirect_uri`。

---

### 第三步：接收授权码

用户授权后，Semi 将重定向到你的 `redirect_uri`：

```
https://yourapp.com/callback
  ?code=AUTHORIZATION_CODE
  &state=原样返回的state
```

> **验证 `state`**：确保返回的 `state` 与第二步发送的一致，以防 CSRF 攻击。

---

### 第四步：用授权码换取 Token

向 Token 端点发送 POST 请求：

```http
POST https://api.semi.im/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=AUTHORIZATION_CODE
&redirect_uri=https://yourapp.com/callback
&client_id=semi_xxxxxxxx
&client_secret=YOUR_CLIENT_SECRET
&code_verifier=原始code_verifier
```

| 参数 | 必须 | 说明 |
|---|---|---|
| `grant_type` | ✅ | 固定值 `authorization_code` |
| `code` | ✅ | 第三步收到的授权码（60 秒内有效，一次性） |
| `redirect_uri` | ✅ | 与授权请求完全一致 |
| `client_id` | ✅ | 应用 client_id |
| `client_secret` | ✅ | 应用 client_secret |
| `code_verifier` | ✅ | 第一步生成的原始 code_verifier |

**成功响应（200）：**

```json
{
  "access_token": "a1b2c3d4...（64位十六进制）",
  "token_type": "Bearer",
  "expires_in": 315360000,
  "refresh_token": "e5f6g7h8...（64位十六进制）",
  "scope": "openid profile wallet"
}
```

---

### 第五步：获取用户信息

使用 `access_token` 请求用户数据：

```http
GET https://api.semi.im/oauth/userinfo
Authorization: Bearer ACCESS_TOKEN
```

**响应示例：**

```json
{
  "sub": "01HXYZ...",
  "handle": "alice",
  "phone_verified": true,
  "email_verified": false,
  "wallet_address": "0xAbCd...1234",
  "scopes_granted": ["openid", "profile", "wallet"]
}
```

返回字段取决于授权的 scope（见第 3 节）。

---

## 5. 接口参考

### 5.1 OIDC Discovery

```http
GET https://api.semi.im/.well-known/openid-configuration
```

返回所有端点 URL、支持的 scope、算法等配置信息，建议在应用启动时缓存。

---

### 5.2 Authorization Endpoint

```
GET https://api.semi.im/oauth/authorize
```

参数见第 4 节第二步。

---

### 5.3 Token Endpoint

```
POST https://api.semi.im/oauth/token
Content-Type: application/x-www-form-urlencoded
```

**授权码换 Token：**

| 参数 | 值 |
|---|---|
| `grant_type` | `authorization_code` |
| `code` | 授权码 |
| `redirect_uri` | 回调地址 |
| `client_id` | 应用 ID |
| `client_secret` | 应用密钥 |
| `code_verifier` | PKCE verifier |

**刷新 Token：**

| 参数 | 值 |
|---|---|
| `grant_type` | `refresh_token` |
| `refresh_token` | 当前 refresh_token |
| `client_id` | 应用 ID |
| `client_secret` | 应用密钥 |

---

### 5.4 UserInfo Endpoint

```
GET https://api.semi.im/oauth/userinfo
Authorization: Bearer <access_token>
```

| 字段 | 类型 | Scope | 描述 |
|---|---|---|---|
| `sub` | string | openid | 用户唯一 ID（TSID） |
| `handle` | string | profile | 用户名（@handle） |
| `phone_verified` | boolean | profile | 手机号是否已验证 |
| `email_verified` | boolean | profile | 邮箱是否已验证 |
| `wallet_address` | string | wallet | 主 EVM 钱包地址（0x...） |
| `scopes_granted` | string[] | - | 本次授权的所有 scope |

---

### 5.5 Token 吊销

```
POST https://api.semi.im/oauth/revoke
Content-Type: application/x-www-form-urlencoded

token=TOKEN_TO_REVOKE
&client_id=semi_xxxxxxxx
&client_secret=YOUR_CLIENT_SECRET
```

`token` 可以是 `access_token` 或 `refresh_token`，吊销 `refresh_token` 会同时吊销关联的 `access_token`。

---

### 5.6 JWKS Endpoint

```
GET https://api.semi.im/oauth/jwks
```

返回用于验证 RS256 签名 Token 的 RSA 公钥（JWK 格式）。

---

## 6. Token 管理

### Token 有效期

| Token | 有效期 |
|---|---|
| 授权码（code） | **60 秒**，一次性，使用后立即失效 |
| access_token | 约 **10 年**（315,360,000 秒） |
| refresh_token | **30 天** |

### 刷新 Token

当 `access_token` 过期或需要获取新 Token 时，使用 `refresh_token` 换取新的 Token 对：

```http
POST https://api.semi.im/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=YOUR_REFRESH_TOKEN
&client_id=semi_xxxxxxxx
&client_secret=YOUR_CLIENT_SECRET
```

> **注意**：Semi 采用 **Refresh Token Rotation**（令牌轮换）机制。每次刷新后，旧的 `refresh_token` 立即失效，响应中会返回一个全新的 `refresh_token`，请及时更新本地存储。

---

## 7. 验证 ID Token（OIDC）

如需在服务端验证用户身份而不调用 userinfo 接口，可通过 JWKS 验证 access_token 签名。

### 验证步骤

1. **获取公钥**：从 `GET /oauth/jwks` 获取 JWK 公钥集，建议缓存（1小时以上）。
2. **匹配 kid**：Token Header 中的 `kid` 对应 JWKS 中的密钥。
3. **验证签名**：使用匹配的 RSA 公钥验证 RS256 签名。
4. **验证 claims**：检查 `iss`（`https://api.semi.im`）、`exp`（过期时间）等。

```javascript
// 使用 jose 库验证（Node.js 示例）
import { createRemoteJWKSet, jwtVerify } from 'jose'

const JWKS = createRemoteJWKSet(new URL('https://api.semi.im/oauth/jwks'))

async function verifyToken(accessToken) {
  const { payload } = await jwtVerify(accessToken, JWKS, {
    issuer: 'https://api.semi.im',
  })
  return payload
}
```

---

## 8. 错误处理

### Token 端点错误

```json
{
  "error": "invalid_grant",
  "error_description": "Code has expired or already been used"
}
```

| error | 含义 |
|---|---|
| `invalid_request` | 缺少必填参数或格式错误 |
| `invalid_client` | client_id 或 client_secret 不正确 |
| `invalid_grant` | 授权码无效、已过期或已使用；PKCE 验证失败；redirect_uri 不匹配 |
| `unauthorized_client` | 应用未激活（draft 或 disabled 状态） |
| `invalid_scope` | 请求的 scope 超出应用允许的范围 |
| `unsupported_grant_type` | 不支持的 grant_type |

### UserInfo 端点错误

| HTTP 状态 | 含义 |
|---|---|
| `401 Unauthorized` | Token 无效、已过期或已吊销 |

---

## 9. 安全注意事项

1. **始终使用 PKCE**：Semi 强制要求 PKCE（S256 方法），无论客户端类型。

2. **验证 state 参数**：每次授权请求使用唯一随机 `state`，回调时验证一致性，防止 CSRF。

3. **安全存储 client_secret**：
   - 服务端应用：存储在环境变量或密钥管理服务中，不能出现在前端代码或版本库中。
   - 纯前端/移动应用：不应持有 `client_secret`（考虑使用公开客户端方案，联系 Semi 团队）。

4. **Redirect URI 严格匹配**：注册时填写的回调地址必须与请求中完全一致（包括路径、查询参数），不支持通配符。

5. **使用 HTTPS**：所有与 Semi 服务器的通信必须通过 HTTPS，`redirect_uri` 必须是 HTTPS 地址。

6. **处理 Token 轮换**：刷新 Token 后立即保存新的 `refresh_token`，旧 Token 立即作废。

7. **授权码一次性使用**：授权码 60 秒内有效且只能使用一次，请勿重试已用过的 code。

---

## 10. 示例代码

### Node.js / Express 服务端示例

```javascript
import express from 'express'
import crypto from 'crypto'

const app = express()
const CLIENT_ID = process.env.SEMI_CLIENT_ID
const CLIENT_SECRET = process.env.SEMI_CLIENT_SECRET
const REDIRECT_URI = 'https://yourapp.com/auth/callback'
const SEMI_BASE = 'https://api.semi.im'

// 工具函数
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url')
}

async function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

// 1. 发起授权
app.get('/auth/login', async (req, res) => {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = crypto.randomBytes(16).toString('hex')

  // 存储 verifier 和 state（生产环境应使用加密 session）
  req.session.codeVerifier = codeVerifier
  req.session.oauthState = state

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile wallet',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  res.redirect(`${SEMI_BASE}/oauth/authorize?${params}`)
})

// 2. 处理回调
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query

  // 验证 state
  if (state !== req.session.oauthState) {
    return res.status(400).send('State mismatch')
  }

  // 换取 Token
  const tokenRes = await fetch(`${SEMI_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: req.session.codeVerifier,
    }),
  })

  const tokens = await tokenRes.json()
  if (!tokenRes.ok) {
    return res.status(400).json(tokens)
  }

  // 获取用户信息
  const userRes = await fetch(`${SEMI_BASE}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const user = await userRes.json()

  // 用 user.sub 作为唯一标识查找或创建本地账户
  console.log('User logged in:', user.sub, user.handle)

  // 保存 tokens，重定向到应用
  req.session.accessToken = tokens.access_token
  req.session.refreshToken = tokens.refresh_token
  res.redirect('/dashboard')
})

app.listen(3000)
```

### 刷新 Token 示例

```javascript
async function refreshAccessToken(refreshToken) {
  const res = await fetch(`${SEMI_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  })

  if (!res.ok) throw new Error('Token refresh failed')

  const tokens = await res.json()
  // 必须更新存储中的 refresh_token（旧的已失效）
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token, // 新的 refresh_token
  }
}
```

---

## 示例项目

| 项目 | 说明 |
|---|---|
| [nantang-dao/hola](https://github.com/nantang-dao/hola) | 使用 Semi OAuth2 登录的完整集成示例，可作为接入参考 |

---

## 联系与支持

- 如需申请应用上线审核或有集成问题，请联系 Semi 团队
- OAuth 应用管理页面：[https://www.semi.im/semi/oauth/apps](https://www.semi.im/semi/oauth/apps)
- OIDC Discovery 文档：`https://api.semi.im/.well-known/openid-configuration`
