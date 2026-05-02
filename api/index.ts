// Hola — "Login with Semi" OAuth 2.0 example
// Runs on Vercel Serverless (Node.js) and Bun (local dev).
// PKCE state and sessions are stored in HMAC-signed cookies — no in-memory state needed.

const CLIENT_ID = process.env.SEMI_CLIENT_ID ?? ""
const CLIENT_SECRET = process.env.SEMI_CLIENT_SECRET ?? ""
const REDIRECT_URI = process.env.REDIRECT_URI ?? ""
const SEMI_FRONTEND = (process.env.SEMI_FRONTEND_URL ?? "http://localhost:3001").replace(/\/$/, "")
const SEMI_BACKEND = (process.env.SEMI_BACKEND_URL ?? "http://localhost:3000").replace(/\/$/, "")
const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-secret"
const SCOPES = "openid profile wallet"

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

// ── PKCE helpers ──────────────────────────────────────────────────────
function generateCodeVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

function base64url(bytes: Uint8Array): string {
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function base64urlDecode(s: string): Uint8Array {
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

// ── HTML escaping ─────────────────────────────────────────────────────
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// ── Cookie helpers ────────────────────────────────────────────────────
function getCookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? ""
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return match ? match[1] : null
}

function clearCookie(name: string): string {
  return `${name}=; HttpOnly; Path=/; Max-Age=0`
}

// ── HMAC-signed session cookie ────────────────────────────────────────
async function hmacSign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  return base64url(new Uint8Array(sig))
}

async function createSessionCookie(session: Session): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(session)))
  const sig = await hmacSign(payload)
  const secure = REDIRECT_URI.startsWith("https") ? "; Secure" : ""
  return `hola_sid=${payload}.${sig}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax${secure}`
}

async function getSession(req: Request): Promise<Session | null> {
  const raw = getCookieValue(req, "hola_sid")
  if (!raw) return null
  const dot = raw.lastIndexOf(".")
  if (dot === -1) return null
  const payload = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  if (sig !== await hmacSign(payload)) return null
  try {
    return JSON.parse(new TextDecoder().decode(base64urlDecode(payload))) as Session
  } catch {
    return null
  }
}

// ── PKCE state cookie (10 min) ────────────────────────────────────────
// Format: hola_pkce=<state>~<codeVerifier>  (both are base64url, no ~ inside)
function setPkceCookie(state: string, codeVerifier: string): string {
  return `hola_pkce=${state}~${codeVerifier}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`
}

function getPkce(req: Request): { state: string; codeVerifier: string } | null {
  const raw = getCookieValue(req, "hola_pkce")
  if (!raw) return null
  const tilde = raw.indexOf("~")
  if (tilde === -1) return null
  return { state: raw.slice(0, tilde), codeVerifier: raw.slice(tilde + 1) }
}

// ── HTML templates ────────────────────────────────────────────────────
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
  const errHtml = error ? `<p class="error">${esc(error)}</p>` : ""
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
  const initial = esc((u.handle ?? u.sub)?.[0]?.toUpperCase() ?? "?")
  const rows: [string, string][] = [
    ["用户 ID", esc(u.sub ?? "—")],
    ["用户名", esc(u.handle ?? "—")],
    ["手机验证", u.phone_verified ? '<span class="badge">已验证</span>' : '<span class="badge no">未验证</span>'],
    ["邮箱验证", u.email_verified ? '<span class="badge">已验证</span>' : '<span class="badge no">未验证</span>'],
    ["钱包地址", u.wallet_address ? esc(`${u.wallet_address.slice(0, 8)}…${u.wallet_address.slice(-6)}`) : "—"],
    ["授权范围", esc((u.scopes_granted ?? []).join(", ") || "—")],
  ]
  return layout("个人资料", `
    <div class="profile-avatar">${initial}</div>
    <h1>${esc(u.handle ?? "匿名用户")}</h1>
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

// ── Route handlers ────────────────────────────────────────────────────
async function handleLogin(): Promise<Response> {
  if (!CLIENT_ID) {
    return html(homePage("未配置 SEMI_CLIENT_ID，请先设置环境变量"), 500)
  }
  if (!REDIRECT_URI) {
    return html(homePage("未配置 REDIRECT_URI，请先设置环境变量"), 500)
  }

  const state = base64url(crypto.getRandomValues(new Uint8Array(16)))
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  })

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${SEMI_FRONTEND}/oauth/authorize?${params}`,
      "Set-Cookie": setPkceCookie(state, codeVerifier),
    },
  })
}

async function handleCallback(req: Request, url: URL): Promise<Response> {
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")

  if (error) return html(homePage(`授权被拒绝: ${error}`))
  if (!code || !state) return html(homePage("无效的回调参数"))

  const pkce = getPkce(req)
  if (!pkce || pkce.state !== state) {
    return html(homePage("state 不匹配或已过期，请重新登录"))
  }

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
        code_verifier: pkce.codeVerifier,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any
      return html(homePage(`令牌交换失败: ${err.message ?? err.statusMessage ?? res.statusText}`))
    }
    tokenData = await res.json()
  } catch {
    return html(homePage(`无法连接到 Semi 后端 (${SEMI_BACKEND})`))
  }

  // Fetch userinfo
  let user: UserInfo
  try {
    const res = await fetch(`${SEMI_BACKEND}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    if (!res.ok) return html(homePage("获取用户信息失败"))
    user = await res.json()
  } catch {
    return html(homePage("获取用户信息失败"))
  }

  const sessionCookie = await createSessionCookie({
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    user,
  })

  const headers = new Headers()
  headers.set("Location", "/profile")
  headers.append("Set-Cookie", clearCookie("hola_pkce"))
  headers.append("Set-Cookie", sessionCookie)
  return new Response(null, { status: 302, headers })
}

async function handleProfile(req: Request): Promise<Response> {
  const session = await getSession(req)
  if (!session) return Response.redirect("/", 302)
  return html(profilePage(session))
}

function handleLogout(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": clearCookie("hola_sid"),
    },
  })
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } })
}

// ── Main handler ──────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pathname } = url

  if (pathname === "/") return html(homePage())
  if (pathname === "/login") return handleLogin()
  if (pathname === "/callback") return handleCallback(req, url)
  if (pathname === "/profile") return handleProfile(req)
  if (pathname === "/logout") return handleLogout()

  return new Response("Not found", { status: 404 })
}
