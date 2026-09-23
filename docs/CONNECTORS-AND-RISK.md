# Connectors: what each one does, and the risks

Relate only processes data you already have access to, on your own machine. Some platforms still don't want
third-party software reading or sending on your behalf. Read this before enabling a connector.
*This is not legal advice.*

| Connector | How it gets messages | Can send | Main risk |
|---|---|---|---|
| **Telegram (bot)** | Official Bot API | Yes | None beyond Telegram's bot rules — this is the sanctioned route |
| **Custom source** | Your own bridge pushes over HTTP/SSE | Via your webhook | Whatever your bridge does |
| **Plaud recordings** | Transcript files dropped in a folder (export/share from the Plaud app) | No | None — files you exported yourself |
| **WeChat (via WeFlow)** | HTTP client for the separately installed WeFlow app's local API | No (WeFlow has no send API) | WeFlow itself decrypts WeChat's local database; that is WeFlow's responsibility and may breach WeChat's terms |
| **WeChat (screen reader mode)** | Reads the WeChat window through Windows UI Automation, like a screen reader | Optional, off by default | Automating the WeChat client can breach WeChat's terms; **automated sending can get an account restricted**. Keep sending low-volume and human-approved |

## Why this repo never ships WeChat decryption

Tools that extract WeChat's database key and decrypt its local storage bypass a technical protection
measure. Distributing that kind of code is what anti-circumvention law (e.g. DMCA §1201 in the US) targets,
and several open-source WeChat export tools have been taken down or abandoned under pressure.

So Relate draws a hard line:

* **No decryption, memory reading or code injection** in this repository — ever. Pull requests that add
  them will be closed.
* The **WeFlow connector** is only an HTTP client for an app the user installs and runs themselves. It
  knows nothing about how WeFlow gets its data.
* The **screen reader connector** only reads what WeChat already renders on screen through the operating
  system's accessibility interface, the same interface assistive technology uses.

A client for someone else's local API, and an accessibility reader, are much further from circumvention
than a decryptor — but "further" is not "risk-free". If you run Relate as a service for other people, or
sell it, get legal advice about the WeChat connectors specifically.

## Sending safely

* Sending is always opt-in per connector.
* When the assistant proposes to send, it goes to the **approval queue** — nothing is sent until a person
  approves it on the dashboard.
* The screen-reader WeChat connector enforces a minimum gap between sends (default 20 s).
