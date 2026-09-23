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
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
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

# luminance spread in a vertical strip — the avatar side of a bubble row has far more detail than empty margin
function StripSpread($shot, $x0, $x1, $y0, $y1) {
  $min = 255; $max = 0; $n = 0; $sum = 0.0; $sq = 0.0
  for ($y = [Math]::Max(0, $y0); $y -lt [Math]::Min($shot.bmp.Height, $y1); $y += 3) {
    for ($x = [Math]::Max(0, $x0); $x -lt [Math]::Min($shot.bmp.Width, $x1); $x += 3) {
      $c = $shot.bmp.GetPixel($x, $y); $l = 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
      $sum += $l; $sq += $l * $l; $n++
    }
  }
  if ($n -eq 0) { return 0 }
  $mean = $sum / $n; return [Math]::Sqrt([Math]::Max(0, $sq / $n - $mean * $mean))
}

function Side($shot, $rect) {
  if (-not $shot) { return '?' }
  $x0 = [int]($rect.X - $shot.left); $x1 = [int]($rect.X + $rect.Width - $shot.left)
  $y0 = [int]($rect.Y - $shot.top); $y1 = [int]([Math]::Min($rect.Y + $rect.Height, $rect.Y + 60) - $shot.top)   # avatar sits at the top of the row
  $L = StripSpread $shot ($x0 + 6) ($x0 + 60) $y0 $y1
  $R = StripSpread $shot ($x1 - 60) ($x1 - 6) $y0 $y1
  if ([Math]::Max($L, $R) -lt 6) { return '?' }
  if ($R -gt $L * 1.6) { return 'me' }
  if ($L -gt $R * 1.6) { return 'them' }
  return '?'
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
  $cell = ById $m.el ('session_item_' + $name)
  if (-not $cell) { return $false }
  try { $cell.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() } catch { $cell.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
  for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 100; $in = ById $m.el 'chat_input_field'; if ($in -and $in.Current.Name -eq $name) { return $true } }
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
  $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  Start-Sleep -Milliseconds 300
  $left = [string]$in.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
  if ($left.Trim().Length -gt 0) { return @{ ok = $false; error = 'text is still in the input box — WeChat did not send it' } }
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
