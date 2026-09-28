# WeChat (Windows desktop, Weixin 4.x) accessibility sidecar for the `wechat-uia` connector.
# Reads what the WeChat window exposes to Windows UI Automation (the same interface screen readers use)
# plus a PrintWindow render of the window to tell which side each bubble is on. No memory reading,
# no database decryption, no injection. Protocol: one JSON command per stdin line, one JSON reply per line.
#   {"cmd":"snapshot"}                       -> {ok, chat, sessions:[{name,preview,selected}], messages:[{cls,text,side}]}
#   {"cmd":"open","chat":"<name>"}            -> {ok}
#   {"cmd":"send","chat":"<name>","text":".."} -> {ok}
#   {"cmd":"ping"}                            -> {ok, found, minimized}
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class RelateWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
'@
[void][RelateWin]::SetProcessDPIAware()   # UIA rects and the PrintWindow bitmap must share physical pixels

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$ALL = [System.Windows.Automation.Condition]::TrueCondition
function ById($root, $id) { $root.FindFirst($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, $id))) }
function Out($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }

function MainWindow {
  $p = Get-Process Weixin -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { return $null }
  return @{ hwnd = $p.MainWindowHandle; el = $AE::FromHandle($p.MainWindowHandle) }
}

# render the whole window (works while covered by other windows; not while minimized)
function Render($hwnd) {
  $r = New-Object RelateWin+RECT; [void][RelateWin]::GetWindowRect($hwnd, [ref]$r)
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  if ($w -le 0 -or $h -le 0) { return $null }
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc()
  [void][RelateWin]::PrintWindow($hwnd, $hdc, 2)   # PW_RENDERFULLCONTENT
  $g.ReleaseHdc($hdc); $g.Dispose()
  return @{ bmp = $bmp; left = $r.Left; top = $r.Top }
}

# Whose bubble is it? WeChat draws your own bubbles green (light #95EC69, dark ~#3EB575) and aligned right;
# everyone else's are white/grey and aligned left. Calibrated against WeFlow's isSend on real chats:
# 14/14 decided correctly with these rules; anything ambiguous is '?' rather than a guess.
function Side($shot, $rect) {
  if (-not $shot) { return '?' }
  $bmp = $shot.bmp
  $x0 = [Math]::Max(0, [int]($rect.X - $shot.left)); $x1 = [Math]::Min($bmp.Width, [int]($rect.X + $rect.Width - $shot.left))
  $y0 = [Math]::Max(0, [int]($rect.Y - $shot.top)); $y1 = [Math]::Min($bmp.Height, [int]($rect.Y + $rect.Height - $shot.top))
  if ($x1 - $x0 -lt 20 -or $y1 - $y0 -lt 10) { return '?' }   # clipped out of the window
  $bg = $bmp.GetPixel($x0 + 2, $y0 + 2)
  $n = 0; $green = 0; $minX = $x1; $maxX = $x0
  for ($y = $y0 + 2; $y -lt $y1 - 2; $y += 3) {
    for ($x = $x0 + 2; $x -lt $x1 - 2; $x += 3) {
      $c = $bmp.GetPixel($x, $y); $n++
      if ($c.G -gt 140 -and ($c.G - $c.R) -gt 40 -and ($c.G - $c.B) -gt 40) { $green++ }
      if ([Math]::Abs($c.R - $bg.R) + [Math]::Abs($c.G - $bg.G) + [Math]::Abs($c.B - $bg.B) -gt 30) { if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x } }
    }
  }
  if ($n -eq 0) { return '?' }
  $w = [double]($x1 - $x0)
  $leftGap = ($minX - $x0) / $w; $rightGap = ($x1 - $maxX) / $w
  if ($green / $n -ge 0.02) { return 'me' }                      # green bubble
  if ($maxX -le $minX) { return '?' }                            # nothing drawn
  if ($rightGap -gt 0.15 -and $leftGap -lt 0.10) { return 'them' }   # content hugs the left (their avatar + bubble)
  if ($leftGap -gt 0.15 -and $rightGap -lt 0.10) { return 'me' }     # hugs the right (your image/file/sticker)
  return '?'
}

# a click posted straight to the WeChat window at an element's centre — no cursor movement, works while
# WeChat is behind other windows. (UIA Select()/Invoke() on chat cells do nothing in Weixin 4.x.)
function PostClick($hwnd, $el) {
  $r = $el.Current.BoundingRectangle
  $p = New-Object RelateWin+POINT; $p.X = [int]($r.X + $r.Width / 2); $p.Y = [int]($r.Y + $r.Height / 2)
  [void][RelateWin]::ScreenToClient($hwnd, [ref]$p)
  $lp = [IntPtr](($p.Y -shl 16) -bor ($p.X -band 0xFFFF))
  [void][RelateWin]::PostMessage($hwnd, 0x0201, [IntPtr]1, $lp)   # WM_LBUTTONDOWN
  Start-Sleep -Milliseconds 60
  [void][RelateWin]::PostMessage($hwnd, 0x0202, [IntPtr]0, $lp)   # WM_LBUTTONUP
}

function Snapshot {
  $m = MainWindow; if (-not $m) { return @{ ok = $false; error = 'WeChat (Weixin) window not found — is WeChat running and logged in?' } }
  $minimized = [RelateWin]::IsIconic($m.hwnd)   # text is readable while minimized, but sender side needs the rendered window
  $sessions = @()
  $sl = ById $m.el 'session_list'
  if ($sl) {
    foreach ($c in $sl.FindAll($TS::Children, $ALL)) {
      $id = [string]$c.Current.AutomationId
      if (-not $id.StartsWith('session_item_')) { continue }
      $name = $id.Substring(13)
      $full = [string]$c.Current.Name
      $preview = if ($full.StartsWith($name)) { $full.Substring($name.Length).Trim() } else { $full }
      $sel = $false; try { $sel = $c.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected } catch {}
      $sessions += @{ name = $name; preview = $preview; selected = $sel }
    }
  }
  $chat = ''
  $input = ById $m.el 'chat_input_field'
  if ($input) { $chat = [string]$input.Current.Name }   # the input box is labelled with the open chat's name
  $messages = @()
  $ml = if ($minimized) { $null } else { ById $m.el 'chat_message_list' }
  if ($ml) {
    $shot = $null; try { $shot = Render $m.hwnd } catch {}
    foreach ($it in $ml.FindAll($TS::Children, $ALL)) {
      if ($it.Current.IsOffscreen) { continue }
      $cls = ([string]$it.Current.ClassName) -replace '^mmui::', ''
      $messages += @{ cls = $cls; text = [string]$it.Current.Name; side = (Side $shot $it.Current.BoundingRectangle) }
    }
    if ($shot) { $shot.bmp.Dispose() }
  }
  return @{ ok = $true; chat = $chat; sessions = $sessions; messages = $messages; minimized = $minimized }
}

function OpenChat($name) {
  $m = MainWindow; if (-not $m) { return $false }
  $cur = ById $m.el 'chat_input_field'
  if ($cur -and [string]$cur.Current.Name -eq $name) { return $true }   # already open — clicking it again would CLOSE it
  $cell = ById $m.el ('session_item_' + $name)
  if (-not $cell) { return $false }
  if ([RelateWin]::IsIconic($m.hwnd)) { return $false }
  PostClick $m.hwnd $cell
  for ($i = 0; $i -lt 25; $i++) { Start-Sleep -Milliseconds 100; $in = ById $m.el 'chat_input_field'; if ($in -and $in.Current.Name -eq $name) { return $true } }
  return $false
}

function Send($name, $text) {
  if (-not (OpenChat $name)) { return @{ ok = $false; error = "chat not found in the WeChat chat list: $name" } }
  $m = MainWindow
  $in = ById $m.el 'chat_input_field'
  $in.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($text)
  Start-Sleep -Milliseconds 150
  # the Send button is the 发送/Send button nearest below-right of the input box
  $ir = $in.Current.BoundingRectangle
  $btn = @($m.el.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))) |
    Where-Object { $_.Current.Name -match '^(发送|Send)' -and -not $_.Current.IsOffscreen } |
    Sort-Object { [Math]::Abs($_.Current.BoundingRectangle.Bottom - $ir.Bottom) + [Math]::Abs($_.Current.BoundingRectangle.Right - $ir.Right) }) | Select-Object -First 1
  if (-not $btn) { return @{ ok = $false; error = 'Send button not found' } }
  $vp = $in.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  if (([string]$vp.Current.Value).Trim() -ne $text.Trim()) { return @{ ok = $false; error = 'could not put the text into the WeChat input box' } }
  try { $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch {}
  Start-Sleep -Milliseconds 400
  if (([string]$vp.Current.Value).Trim().Length -gt 0) { PostClick $m.hwnd $btn; Start-Sleep -Milliseconds 500 }   # Invoke ignored → real click
  if (([string]$vp.Current.Value).Trim().Length -gt 0) { return @{ ok = $false; error = 'text is still in the input box — WeChat did not send it' } }
  return @{ ok = $true }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  try {
    $q = $line | ConvertFrom-Json
    switch ($q.cmd) {
      'ping' { $m = MainWindow; Out @{ ok = $true; found = [bool]$m; minimized = [bool]($m -and [RelateWin]::IsIconic($m.hwnd)) } }
      'snapshot' { Out (Snapshot) }
      'open' { Out @{ ok = (OpenChat $q.chat) } }
      'send' { Out (Send $q.chat $q.text) }
      default { Out @{ ok = $false; error = "unknown cmd $($q.cmd)" } }
    }
  } catch { Out @{ ok = $false; error = $_.Exception.Message } }
}
