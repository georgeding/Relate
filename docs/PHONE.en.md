# Use Relate on your phone

[中文](PHONE.md) · **English**

Relate runs on your computer. To carry it in your pocket you need three things:

1. **a dashboard password** on the space,
2. **an HTTPS address** that reaches your computer from anywhere,
3. **the dashboard saved to your home screen**, with notifications on.

About 10 minutes. Your computer needs to stay on (and awake) for the phone to reach it.

---

## Step 1 · Set a dashboard password

In the hub: **Space → Access → Dashboard password** → enter a password → **Save** → **Restart** the space.

> Relate protects you here: a space without a password only opens on the computer it runs on.
> Visits through a tunnel or from the network see a "set a dashboard password first" page instead.

Only share **space dashboards** (ports 5081, 5082…). Keep the **hub** (port 5080) on your computer — it holds
your API keys.

## Step 2 · Give it an HTTPS address

Pick one:

| | Cost | You need | Best for |
|---|---|---|---|
| **[A. Tailscale](#a-tailscale-easiest)** | free for personal use | the Tailscale app on computer + phone | the easiest, fully private setup |
| **[B. Cloudflare Tunnel](#b-cloudflare-tunnel-your-own-address)** | free | a domain on Cloudflare | a fixed address like `https://relate.example.com` |
| **[C. DDNS + port forwarding](#c-ddns--port-forwarding-advanced)** | free | a public IP and router access | people who already run a home server |

Just want to try it for five minutes? See [quick try](#quick-try-no-account).

> **In mainland China**, Tailscale and Cloudflare can be slow or unstable depending on your network.
> If so, use option C, or a domestic tunnelling service such as [cpolar](https://www.cpolar.com),
> [Oray 花生壳](https://hsk.oray.com) or a self-hosted [frp](https://github.com/fatedier/frp) — point it at
> `http://127.0.0.1:<space port>` and make sure it gives you **HTTPS**.

### A. Tailscale (easiest)

[Tailscale](https://tailscale.com) connects your devices into a private network — nothing is exposed to the internet.

1. Install Tailscale on your [computer](https://tailscale.com/download) and your [phone](https://tailscale.com/download),
   and sign in with the same account on both.
2. In the [admin console → DNS](https://login.tailscale.com/admin/dns), turn on **MagicDNS** and **HTTPS Certificates**.
3. On the computer, open a terminal and share the space (use the port shown on its card in the hub):

   ```bash
   tailscale serve --bg 5081
   ```

   It prints your address, like `https://my-pc.tail1234.ts.net`.
4. Open that address on your phone (with Tailscale switched on). Continue with [step 3](#step-3--add-it-to-your-home-screen).

More spaces: `tailscale serve --bg --https=8443 5082`. Stop sharing: `tailscale serve reset`.
Docs: [tailscale serve](https://tailscale.com/kb/1312/serve).

### B. Cloudflare Tunnel (your own address)

[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) gives your
computer a public HTTPS address without opening any ports. You need a domain whose DNS is on Cloudflare
([add a site](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/); a domain costs about
¥70 / $10 a year).

1. In the [Cloudflare dashboard](https://one.dash.cloudflare.com), go to **Zero Trust → Networks → Tunnels →
   Create a tunnel → Cloudflared**, and name it `relate`.
2. Choose your computer's system and run the install command it shows. On Windows, in a terminal
   opened **as administrator**:

   ```powershell
   winget install --id Cloudflare.cloudflared
   cloudflared.exe service install <token shown in the dashboard>
   ```

3. Add a **public hostname**: subdomain `relate`, your domain, service type **HTTP**, URL `127.0.0.1:5081`.
4. Open `https://relate.<your domain>` on your phone. Continue with [step 3](#step-3--add-it-to-your-home-screen).

The tunnel runs as a Windows service, so it comes back by itself after a restart.
Want a second lock in front? Add [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/)
with a one-time email code.

### C. DDNS + port forwarding (advanced)

For people with a **public IPv4 or IPv6** at home and access to their router.

1. Keep a domain pointed at your home IP with a DDNS tool such as [DDNS-GO](https://github.com/jeessy2/ddns-go).
2. Put a reverse proxy in front that handles HTTPS automatically, e.g. [Caddy](https://caddyserver.com):

   ```
   relate.example.com {
       reverse_proxy 127.0.0.1:5081
   }
   ```

3. Forward the proxy's port on your router. Many home connections block ports 80/443 — then use another port
   and get the certificate by [DNS challenge](https://caddyserver.com/docs/automatic-https#dns-challenge).

Never forward Relate's own ports (5080, 5081…) directly: without HTTPS, passwords and chats cross the internet in
plain text, and phones won't allow notifications.

### Quick try (no account)

```bash
cloudflared tunnel --url http://127.0.0.1:5081
```

It prints a random `https://….trycloudflare.com` address. Good for a first look — but the address **changes every
time**, so don't add it to your home screen.

## Step 3 · Add it to your home screen

**iPhone / iPad** (iOS 16.4 or newer)

1. Open your address in **Safari** and sign in with the dashboard password.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open Relate **from the new home-screen icon** (notifications only work from there).
4. Tap **🔔 开启通知** (enable notifications) → **Allow**. A test notification arrives right away.

**Android**

1. Open your address in **Chrome** and sign in.
2. Tap **⋮** → **Install app** (or **Add to Home screen**).
3. Open it from the icon, tap **🔔 开启通知** → **Allow**. A test notification arrives right away.

From now on you'll get pushes for reply reminders, upcoming festivals and anniversaries, and messages that need
care — like any other app.

## Troubleshooting

| You see | Do this |
|---|---|
| "先设置看板密码" (set a dashboard password first) | do [step 1](#step-1--set-a-dashboard-password), then restart the space |
| "此设备不支持推送" (push not supported) on iPhone | open Relate from the **home-screen icon**, not Safari; update to iOS 16.4+ |
| Notifications stopped | is the computer asleep? Windows: **Settings → System → Power → Sleep: Never** (when plugged in) |
| The home-screen app broke after a restart | your address changed (quick tunnel) — use option A or B for a fixed address, then add it again |
| Can't sign in over the address | make sure it's **https://** — the sign-in cookie only works over HTTPS |
