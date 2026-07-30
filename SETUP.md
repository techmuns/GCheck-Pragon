# Getting it actually running

Written for someone who doesn't want to think about servers. Ten minutes,
mostly waiting.

## The one thing to understand first

This app is two halves:

- **The face** — the screens. Plain files. Any host serves them.
- **The engine** — the part that looks up the register, runs the news searches,
  opens articles and writes the brief.

**Cloudflare Pages can only host the face.** That is not a setting you can flip.
The build that goes to Cloudflare deletes the engine on purpose
(`scripts/build-static.mjs` moves `app/api/` out before building), because the
engine needs things Cloudflare Workers don't have: a disk to write settings to,
memory that survives between requests while you watch the progress screen, and
permission to keep working for minutes after the page has loaded.

You can check this yourself right now — open
`https://<your-site>.pages.dev/api/health`. If you get a 404, there is no
engine, and pressing "Run pre-screen" will fail no matter which keys you set
where.

## Recommended: put everything on Render, drop the split

One deploy, one URL, one place for keys, nothing to keep in sync. Free tier is
fine.

1. Go to **render.com** → sign in with GitHub → **New +** → **Blueprint**.
2. Pick this repository. Render reads `render.yaml` and offers a service called
   `paragon`. Click **Apply**.
3. It asks you for the keys marked "sync: false". Fill in the two that matter:

   | Key | Where you get it | Without it |
   |---|---|---|
   | `MUNSHOT_TOKEN` | Munshot gives you this | No news search, no article reading — briefs are built from headlines only |
   | `OPENAI_API_KEY` | platform.openai.com | No article reading, so no "did they file the complaint or answer it" |

   Leave the rest blank. Every one of them is optional and the app says plainly
   in the brief when a source is off.
4. Wait for the first build (~5 minutes — it builds a container with a browser
   inside, for the PDF export).
5. You get a URL like `https://paragon.onrender.com`. **That** is the working
   app. Use it in Munshot instead of the pages.dev one.

Free-tier Render sleeps after 15 minutes idle, so the first request after a
quiet spell takes ~30 seconds to wake. The progress screen handles that — it
holds on "Setting things up" rather than looking broken.

## If you want to keep the Cloudflare URL

You can, but you're then running two deploys and must keep them in step:

1. Do the Render steps above — you still need the engine somewhere.
2. In **Cloudflare Pages → your project → Settings → Variables**, add a
   **build-time** variable:
   `NEXT_PUBLIC_API_BASE` = `https://paragon.onrender.com` (no trailing slash)
3. Confirm the build command is `npm run build:static` and the output directory
   is `out`.
4. **Redeploy.** This value is baked into the JavaScript at build time, so
   changing it in the dashboard does nothing until you rebuild.
5. On Render, set `CORS_ALLOW_ORIGIN` to your Pages URL.

## Where secrets go, and one way to get badly burned

All three of these are called "secrets" and only one of them reaches the engine:

| Place | What can read it |
|---|---|
| **GitHub → Secrets** | GitHub Actions only. Nothing here is visible to the running app, ever. |
| **Cloudflare Pages → Variables** | The Cloudflare *build*. Correct for `NEXT_PUBLIC_API_BASE`. Nothing else here has anything to read it, because the engine isn't on Cloudflare. |
| **Render → Environment** | The running engine. **This is where `MUNSHOT_TOKEN` and `OPENAI_API_KEY` go.** |

**Never put a key in a variable whose name starts with `NEXT_PUBLIC_`.** That
prefix means "paste this into the JavaScript every visitor downloads". It is
right for a public URL and ruinous for a credential — `NEXT_PUBLIC_MUNSHOT_TOKEN`
would hand your Munshot session to anyone who opens the browser console. Every
key this app uses is read on the server only, in `lib/collectors/env.ts`.

## Checking it worked

Open `https://<your-render-url>/api/health`. You want:

```json
{ "ok": true, "status": "ok",
  "news":   { "configured": true },
  "reader": { "configured": true, "extraction": true } }
```

`"configured": false` on either means that key didn't take. `"status":
"degraded"` with a `munshotToken.state` of `expiring` means the Munshot token is
near its end — it is a login session, not a permanent key, so it will need
replacing periodically. Set `FIRECRAWL_API_KEY` if you'd rather article reading
survived that on its own.

Then run a real check: search `07013291`. You should get **CHIRAAG KAPIL**, a
verdict of REVIEW (not CLEAR), the Saarthi/Classplus litigation with him named
as the one who *filed* it, and the XPRIZE win under Positive Signals — not under
Key Concerns.
