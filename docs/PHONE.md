# 在手机上使用 Relate

**中文** · [English](PHONE.en.md)

Relate 运行在你的电脑上。想把它装进口袋随身携带，你需要准备三样东西：

1. 空间的**看板密码**，
2. 一个能从任何地方访问你电脑的 **HTTPS 地址**，
3. 把**看板添加到主屏幕**，并开启通知。

全程大约 10 分钟。手机要能访问 Relate，你的电脑需要保持开机（且不休眠）。

---

## 第 1 步 · 设置看板密码

在控制台（hub）中：**空间 → 访问 → 看板密码** → 输入密码 → **保存** → **重启**空间。

> Relate 在这里会替你把关：没设密码的空间只能在其运行的那台电脑上打开。
> 通过隧道或局域网访问时，看到的会是一个“请先设置看板密码”的提示页。

只分享**空间看板**（端口 5081、5082……）。**控制台（hub）**（端口 5080）请留在自己电脑上——里面存着你的 API 密钥。

## 第 2 步 · 给它一个 HTTPS 地址

三选一：

| | 费用 | 你需要 | 适合场景 |
|---|---|---|---|
| **[A. Tailscale](#a-tailscale最简单)** | 个人使用免费 | 电脑和手机都装 Tailscale 应用 | 最简单、完全私有的方案 |
| **[B. Cloudflare Tunnel](#b-cloudflare-tunnel你自己的专属地址)** | 免费 | 一个托管在 Cloudflare 的域名 | 想要 `https://relate.example.com` 这样的固定地址 |
| **[C. DDNS + 端口转发](#c-ddns--端口转发进阶)** | 免费 | 公网 IP 和路由器管理权限 | 已经在跑家庭服务器的人 |

只想花五分钟随便试试？看[快速体验](#快速体验无需注册)。

> **在中国大陆**，Tailscale 和 Cloudflare 可能会慢或不稳定，取决于你的网络环境。
> 如果遇到这种情况，可以选方案 C，或使用国内的内网穿透服务，例如 [cpolar](https://www.cpolar.com)、
> [Oray 花生壳](https://hsk.oray.com) 或自建的 [frp](https://github.com/fatedier/frp)——把它们指向
> `http://127.0.0.1:<空间端口>`，并确保能提供 **HTTPS**。

### A. Tailscale（最简单）

[Tailscale](https://tailscale.com) 会把你的设备组成一个私有网络——不会向互联网暴露任何东西。

1. 在[电脑](https://tailscale.com/download)和[手机](https://tailscale.com/download)上安装 Tailscale，
   两边登录同一个账号。
2. 在[管理后台 → DNS](https://login.tailscale.com/admin/dns) 中，开启 **MagicDNS** 和 **HTTPS Certificates**。
3. 在电脑上打开终端，运行下面的命令分享这个空间，端口用它在控制台（hub）卡片上显示的那个：

   ```bash
   tailscale serve --bg 5081
   ```

   它会打印出你的地址，比如 `https://my-pc.tail1234.ts.net`。
4. 在手机上打开这个地址（保持 Tailscale 开启），然后继续[第 3 步](#第-3-步--添加到主屏幕)。

分享更多空间：`tailscale serve --bg --https=8443 5082`。停止分享：`tailscale serve reset`。
文档：[tailscale serve](https://tailscale.com/kb/1312/serve)。

### B. Cloudflare Tunnel（你自己的专属地址）

[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 能让你的电脑获得一个公共 HTTPS 地址，无需开放任何端口。你需要一个 DNS 托管在 Cloudflare 上的域名（[添加站点](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/)；域名一年大约 ¥70 / $10）。

1. 打开 [Cloudflare 面板](https://one.dash.cloudflare.com)，依次进入 **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**，命名为 `relate`。
2. 选择你电脑的操作系统，运行页面给出的安装命令。在 Windows 上，需要用**管理员身份**打开的终端来执行：

   ```powershell
   winget install --id Cloudflare.cloudflared
   cloudflared.exe service install <页面上显示的令牌>
   ```

3. 添加一个**公共主机名**：子域名填 `relate`，域名选你自己的，服务类型选 **HTTP**，URL 填 `127.0.0.1:5081`。
4. 在手机上打开 `https://relate.<你的域名>`，然后继续[第 3 步](#第-3-步--添加到主屏幕)。

隧道会以 Windows 服务的方式运行，电脑重启后会自动恢复。

想再上一道锁？可以配置 [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/)（访问），用一次性邮箱验证码登录。

### C. DDNS + 端口转发（进阶）

适合家里有**公网 IPv4 或 IPv6**、且能管理路由器的用户。

1. 使用 [DDNS-GO](https://github.com/jeessy2/ddns-go) 等 DDNS 工具，让域名始终指向你的家庭 IP。
2. 在前面加一层能自动处理 HTTPS 的反向代理，例如 [Caddy](https://caddyserver.com)：

   ```
   relate.example.com {
       reverse_proxy 127.0.0.1:5081
   }
   ```

3. 在路由器上转发该代理的端口。很多家庭宽带会屏蔽 80/443 端口——这时可以改用其他端口，并通过 [DNS 验证](https://caddyserver.com/docs/automatic-https#dns-challenge) 获取证书。

千万不要直接转发 Relate 自身的端口（5080、5081……）：没有 HTTPS，密码和聊天内容会以明文形式在互联网上传输，手机端也无法使用通知功能。

### 快速体验（无需注册）

```bash
cloudflared tunnel --url http://127.0.0.1:5081
```

它会输出一个随机的 `https://….trycloudflare.com` 地址。适合先快速体验一下——不过这个地址**每次都会变**，所以别把它添加到主屏幕。

## 第 3 步 · 添加到主屏幕

**iPhone / iPad**（iOS 16.4 或更高版本）

1. 用 **Safari** 打开你的地址，输入看板密码登录。
2. 依次点按 **分享** → **添加到主屏幕** → **添加**。
3. **从主屏幕上的新图标**打开 Relate（通知只有从这里进入才能生效）。
4. 点按 **🔔 开启通知** → **允许**。很快就会收到一条测试通知。

**Android**

1. 用 **Chrome** 打开你的地址并登录。
2. 点按 **⋮** → **安装应用**（或 **添加到主屏幕**）。
3. 从图标打开，点按 **🔔 开启通知** → **允许**。很快就会收到一条测试通知。

从此以后，回复提醒、临近的节日和纪念日、需要用心对待的消息，都会像其他应用一样推送到你手机上。

## 故障排查

| 现象 | 解决办法 |
|---|---|
| 提示“先设置看板密码” | 先完成 [第 1 步](#第-1-步--设置看板密码)，然后重启空间 |
| iPhone 上提示“此设备不支持推送” | 从**主屏幕图标**打开 Relate，不要用 Safari；并升级到 iOS 16.4 及以上 |
| 通知收不到了 | 电脑是不是睡眠了？Windows：**设置 → 系统 → 电源 → 睡眠：从不**（接通电源时） |
| 重启后主屏幕上的应用打不开了 | 你的地址变了（快速体验用的临时隧道）——改用方案 A 或方案 B 获取固定地址，再重新添加一次 |
| 用这个地址登录不了 | 确认地址是 **https://** 开头——登录 Cookie 只在 HTTPS 下生效 |
