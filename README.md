# Hola

Minimal example app demonstrating "Login with Semi" via OAuth 2.0 Authorization Code + PKCE.

## Setup

### 1. Register an OAuth app on Semi

1. Start semi-backend (`bin/rails server`) and semi-app (`bun run dev`)
2. Visit `http://localhost:3001/oauth/apps`
3. Click **注册应用**, fill in:
   - **Name**: Hola
   - **Redirect URI**: `http://localhost:4000/callback`
   - **Scopes**: `openid`, `profile`, `wallet`
4. Click **创建** and copy the `client_id` and `client_secret` from the reveal modal
5. Change the app status to **已上线** (active) via the edit button

### 2. Configure .env

```
SEMI_CLIENT_ID=semi_<your client_id>
SEMI_CLIENT_SECRET=<your client_secret>
```

### 3. Run

```bash
bun run dev   # with hot reload
# or
bun start
```

Open `http://localhost:4000`.

## Flow

```
Browser                     Hola (port 4000)          Semi frontend (3001)    Semi backend (3000)
   │                              │                           │                       │
   │  GET /                       │                           │                       │
   │─────────────────────────────>│                           │                       │
   │  HTML homepage               │                           │                       │
   │<─────────────────────────────│                           │                       │
   │                              │                           │                       │
   │  GET /login                  │                           │                       │
   │─────────────────────────────>│ generate PKCE verifier+challenge                  │
   │  302 → Semi /oauth/authorize │                           │                       │
   │<─────────────────────────────│                           │                       │
   │                              │                           │                       │
   │  GET /oauth/authorize?...    │                           │                       │
   │─────────────────────────────────────────────────────────>│                       │
   │  consent page HTML           │                           │                       │
   │<─────────────────────────────────────────────────────────│                       │
   │  (user clicks Authorize)     │                           │                       │
   │─────────────────────────────────────────────────────────>│ POST /oauth/authorize │
   │                              │                           │──────────────────────>│
   │  302 → /callback?code=...    │                           │  { code }             │
   │<─────────────────────────────────────────────────────────│<──────────────────────│
   │                              │                           │                       │
   │  GET /callback?code=...      │                           │                       │
   │─────────────────────────────>│ POST /oauth/token (code + code_verifier)          │
   │                              │──────────────────────────────────────────────────>│
   │                              │  { access_token, refresh_token }                  │
   │                              │<──────────────────────────────────────────────────│
   │                              │ GET /oauth/userinfo                               │
   │                              │──────────────────────────────────────────────────>│
   │                              │  { sub, handle, wallet_address, ... }             │
   │                              │<──────────────────────────────────────────────────│
   │  302 → /profile              │                           │                       │
   │<─────────────────────────────│                           │                       │
   │  profile page HTML           │                           │                       │
   │<─────────────────────────────│                           │                       │
```
