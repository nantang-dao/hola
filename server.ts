// Local dev entry point — wraps the Vercel-compatible handler with Bun.serve.
import handler from "./api/index"

const PORT = Number(process.env.PORT) || 4000
const server = Bun.serve({ port: PORT, fetch: handler })

const frontend = (process.env.SEMI_FRONTEND_URL ?? "http://localhost:3001").replace(/\/$/, "")
const backend = (process.env.SEMI_BACKEND_URL ?? "http://localhost:3000").replace(/\/$/, "")

console.log(`\n🌟 Hola running at http://localhost:${server.port}`)
console.log(`   Semi frontend : ${frontend}`)
console.log(`   Semi backend  : ${backend}`)
if (!process.env.SEMI_CLIENT_ID) console.warn("\n⚠️  SEMI_CLIENT_ID not set — register an app at http://localhost:3001/oauth/apps\n")
