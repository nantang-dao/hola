// Hola — minimal "Login with Semi" OAuth 2.0 example
// Authorization Code + PKCE flow, server-side rendered HTML, no framework.

const PORT = Number(process.env.PORT) || 4000
const CLIENT_ID = process.env.SEMI_CLIENT_ID ?? ""
const CLIENT_SECRET = process.env.SEMI_CLIENT_SECRET ?? ""
const REDIRECT_URI = process.env.REDIRECT_URI ?? `http://localhost:${PORT}/callback`
const SEMI_FRONTEND = (process.env.SEMI_FRONTEND_URL ?? "http://localhost:3001").replace(/\/$/, "")
const SEMI_BACKEND = (process.env.SEMI_BACKEND_URL ?? "http://localhost:3000").replace(/\/$/, "")
const SCOPES = "openid profile wallet"

// ── In-memory stores (dev only) ────────────────────────────────────────
// state → { codeVerifier, createdAt }
const pendingAuths = new Map<string, { codeVerifier: string; createdAt: number }>()
// sessionId → { accessToken, refreshToken, userInfo }
const sessions = new Map<string, Session>()

interface UserInfo {
  sub: string
  handle?: string
  phone_verified?: boolean
  email_verified?: boolean
  wallet_address?: string
  scopes_granted?: string[]
}

interface Session {
  accessToken: string
  refreshToken: string
  user: UserInfo
}

// ── PKCE helpers ───────────────────────────────────────────────────────
function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64url(bytes)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest("SHA-256", encoded)
  return base64url(new Uint8Array(digest))
}

function base64url(bytes: Uint8Array): string {
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

// ── Cookie helpers ─────────────────────────────────────────────────────
function getSessionId(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? ""
  const match = cookie.match(/hola_sid=([^;]+)/)
  return match ? match[1] : null
}

function setSessionCookie(sessionId: string): string {
  return `hola_sid=${sessionId}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`
}

function clearSessionCookie(): string {
  return "hola_sid=; HttpOnly; Path=/; Max-Age=0"
}

// ── HTML templates ─────────────────────────────────────────────────────
function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Hola</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f5f7; color: #1d1d1f;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
    }
    .card {
      background: #fff; border-radius: 18px; padding: 48px 40px;
      box-shadow: 0 4px 24px rgba(0,0,0,.08); max-width: 400px; width: 100%;
      text-align: center;
    }
    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 8px; }
    .subtitle { color: #6e6e73; font-size: 0.95rem; margin-bottom: 32px; line-height: 1.5; }
    .btn {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 12px 24px; border-radius: 980px; font-size: 0.95rem;
      font-weight: 600; text-decoration: none; border: none; cursor: pointer;
      transition: opacity .15s;
    }
    .btn:hover { opacity: .85; }
    .btn-primary { background: #0071e3; color: #fff; }
    .btn-secondary { background: #e8e8ed; color: #1d1d1f; font-size: 0.85rem; }
    .semi-logo {
      width: 22px; height: 22px; border-radius: 6px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      display: inline-flex; align-items: center; justify-content: center;
      color: #fff; font-size: 12px; font-weight: 700; flex-shrink: 0;
    }
    .profile-avatar {
      width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #8b5cf6);
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 28px; font-weight: 700; margin: 0 auto 20px;
    }
    .info-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 0; border-bottom: 1px solid #f0f0f0; text-align: left; font-size: 0.9rem;
    }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #6e6e73; }
    .info-value { font-weight: 500; word-break: break-all; max-width: 220px; text-align: right; }
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 980px; font-size: 0.75rem;
      font-weight: 600; background: #e8fce8; color: #1a8a1a;
    }
    .badge.no { background: #fce8e8; color: #c00; }
    .info-table { width: 100%; margin: 20px 0 28px; }
    .actions { display: flex; flex-direction: column; gap: 10px; }
    .error { color: #c00; font-size: 0.9rem; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">${body}</div>
</body>
</html>`
}

function homePage(error?: string): string {
  const errHtml = error ? `<p class="error">${error}</p>` : ""
  return layout("首页", `
    <h1>¡Hola!</h1>
    <p class="subtitle">这是一个使用 Semi 身份登录的示例应用。<br/>点击下方按钮体验 OAuth 2.0 授权流程。</p>
    ${errHtml}
    <a href="/login" class="btn btn-primary">
      <span class="semi-logo">S</span>
      使用 Semi 登录
    </a>
  `)
}

function profilePage(session: Session): string {
  const u = session.user
  const initial = (u.handle ?? u.sub)?.[0]?.toUpperCase() ?? "?"
  const rows = [
    ["用户 ID", u.sub ?? "—"],
    ["用户名", u.handle ?? "—"],
    ["手机验证", u.phone_verified ? '<span class="badge">已验证</span>' : '<span class="badge no">未验证</span>'],
    ["邮箱验证", u.email_verified ? '<span class="badge">已验证</span>' : '<span class="badge no">未验证</span>'],
    ["钱包地址", u.wallet_address ? `${u.wallet_address.slice(0, 8)}…${u.wallet_address.slice(-6)}` : "—"],
    ["授权范围", (u.scopes_granted ?? []).join(", ") || "—"],
  ]
  return layout("个人资料", `
    <div class="profile-avatar">${initial}</div>
    <h1>${u.handle ?? "匿名用户"}</h1>
    <p class="subtitle">已通过 Semi 身份验证登录</p>
    <table class="info-table">
      ${rows.map(([label, value]) => `
        <tr class="info-row">
          <td class="info-label">${label}</td>
          <td class="info-value">${value}</td>
        </tr>`).join("")}
    </table>
    <div class="actions">
      <a href="/logout" class="btn btn-secondary">退出登录</a>
    </div>
  `)
}

// ── Route handlers ─────────────────────────────────────────────────────
async function handleLogin(): Promise<Response> {
  if (!CLIENT_ID) {
    return html(homePage("未配置 SEMI_CLIENT_ID，请先在 .env 中设置并重启"), 500)
  }

  const state = base64url(crypto.getRandomValues(new Uint8Array(16)))
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  // Store verifier server-side keyed by state (expires after 10 min)
  pendingAuths.set(state, { codeVerifier, createdAt: Date.now() })
  // Clean up stale entries
  for (const [k, v] of pendingAuths) {
    if (Date.now() - v.createdAt > 10 * 60 * 1000) pendingAuths.delete(k)
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  })

  return Response.redirect(`${SEMI_FRONTEND}/oauth/authorize?${params}`, 302)
}

async function handleCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")

  if (error) {
    return html(homePage(`授权被拒绝: ${error}`))
  }
  if (!code || !state) {
    return html(homePage("无效的回调参数"))
  }

  const pending = pendingAuths.get(state)
  if (!pending) {
    return html(homePage("state 不匹配或已过期，请重新登录"))
  }
  pendingAuths.delete(state)

  // Exchange code for tokens
  let tokenData: { access_token: string; refresh_token: string }
  try {
    const res = await fetch(`${SEMI_BACKEND}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code_verifier: pending.codeVerifier,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return html(homePage(`令牌交换失败: ${err.message ?? res.statusText}`))
    }
    tokenData = await res.json()
  } catch (e) {
    return html(homePage(`无法连接到 Semi 后端 (${SEMI_BACKEND})`))
  }

  // Fetch userinfo
  let user: UserInfo
  try {
    const res = await fetch(`${SEMI_BACKEND}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    user = await res.json()
  } catch {
    return html(homePage("获取用户信息失败"))
  }

  // Create session
  const sessionId = base64url(crypto.getRandomValues(new Uint8Array(24)))
  sessions.set(sessionId, {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    user,
  })

  return new Response(null, {
    status: 302,
    headers: { Location: "/profile", "Set-Cookie": setSessionCookie(sessionId) },
  })
}

function handleProfile(req: Request): Response {
  const sessionId = getSessionId(req)
  const session = sessionId ? sessions.get(sessionId) : null
  if (!session) {
    return Response.redirect("/", 302)
  }
  return html(profilePage(session))
}

function handleLogout(req: Request): Response {
  const sessionId = getSessionId(req)
  if (sessionId) sessions.delete(sessionId)
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": clearSessionCookie() },
  })
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } })
}

// ── Server ─────────────────────────────────────────────────────────────
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const { pathname } = url

    if (pathname === "/") return html(homePage())
    if (pathname === "/login") return handleLogin()
    if (pathname === "/callback") return handleCallback(url)
    if (pathname === "/profile") return handleProfile(req)
    if (pathname === "/logout") return handleLogout(req)

    return new Response("Not found", { status: 404 })
  },
})

console.log(`\n🌟 Hola running at http://localhost:${server.port}`)
console.log(`   Semi frontend : ${SEMI_FRONTEND}`)
console.log(`   Semi backend  : ${SEMI_BACKEND}`)
if (!CLIENT_ID) console.warn("\n⚠️  SEMI_CLIENT_ID not set — register an app at http://localhost:3001/oauth/apps\n")
