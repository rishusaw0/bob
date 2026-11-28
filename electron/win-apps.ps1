param(
  [string]$Task = "list-installed",
  [string]$Arg1 = "",
  [string]$Arg2 = "",
  [string]$Arg3 = ""
)

$ErrorActionPreference = "Stop"

function Assert-ValidWingetPackage {
  param([string]$Pkg)
  if (-not $Pkg -or $Pkg.StartsWith("-") -or ($Pkg -notmatch '^[a-zA-Z0-9._\-\s]+$')) {
    Write-Error "Invalid package identifier: '$Pkg'"
    exit 1
  }
}

switch ($Task) {
  "list-installed" {
    $filter = $Arg1.Trim().ToLower()
    $apps = @{}

    $regPaths = @(
      "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
      "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
      "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    foreach ($rp in $regPaths) {
      Get-ItemProperty $rp -ErrorAction SilentlyContinue | ForEach-Object {
        $name = [string]$_.DisplayName
        if ($name -and (-not $filter -or $name.ToLower().Contains($filter))) {
          $key = $name.ToLower().Trim()
          if (-not $apps.ContainsKey($key)) {
            $apps[$key] = [PSCustomObject]@{
              name = $name.Trim()
              version = [string]$_.DisplayVersion
              publisher = [string]$_.Publisher
              source = "Registry"
            }
          }
        }
      }
    }

    try {
      Get-StartApps | ForEach-Object {
        $name = [string]$_.Name
        if ($name -and (-not $filter -or $name.ToLower().Contains($filter))) {
          $key = $name.ToLower().Trim()
          if (-not $apps.ContainsKey($key)) {
            $apps[$key] = [PSCustomObject]@{
              name = $name.Trim()
              version = ""
              publisher = "Start Menu"
              source = "StartApps"
            }
          }
        }
      }
    } catch {}

    $list = @($apps.Values | Sort-Object name | Select-Object -First 150)
    if ($list.Count -eq 0) {
      Write-Output "[]"
    } else {
      Write-Output (ConvertTo-Json -InputObject $list -Compress)
    }
  }

  "winget-search" {
    $pkg = $Arg1.Trim()
    Assert-ValidWingetPackage $pkg
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Write-Error "winget is not available on this Windows system."
      exit 1
    }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $out = winget search $pkg --accept-source-agreements 2>&1
      $exit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $prevEap
    }
    $text = ($out -join "`n").Trim()
    if ($exit -ne 0) {
      Write-Error "winget search failed ($exit): $text"
      exit 1
    }
    Write-Output $text
  }

  "winget-install" {
    $pkg = $Arg1.Trim()
    Assert-ValidWingetPackage $pkg
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Write-Error "winget is not installed on this Windows system."
      exit 1
    }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $out = winget install $pkg --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1
      $exit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $prevEap
    }
    $text = ($out -join "`n").Trim()
    if ($exit -ne 0) {
      Write-Error "winget install failed ($exit): $text"
      exit 1
    }
    if ($text) { Write-Output $text } else { Write-Output "Installed $pkg successfully" }
  }

  "winget-uninstall" {
    $pkg = $Arg1.Trim()
    Assert-ValidWingetPackage $pkg
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Write-Error "winget is not installed on this Windows system."
      exit 1
    }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $out = winget uninstall $pkg --accept-source-agreements --disable-interactivity 2>&1
      $exit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $prevEap
    }
    $text = ($out -join "`n").Trim()
    if ($exit -ne 0) {
      Write-Error "winget uninstall failed ($exit): $text"
      exit 1
    }
    if ($text) { Write-Output $text } else { Write-Output "Uninstalled $pkg successfully" }
  }

  "winget-update" {
    $pkg = $Arg1.Trim()
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Write-Error "winget is not installed on this Windows system."
      exit 1
    }
    if ($pkg -and $pkg.ToLower() -ne "all") {
      Assert-ValidWingetPackage $pkg
    }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      if (-not $pkg -or $pkg.ToLower() -eq "all") {
        $out = winget upgrade --accept-package-agreements --accept-source-agreements 2>&1
      } else {
        $out = winget upgrade $pkg --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1
      }
      $exit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $prevEap
    }
    $text = ($out -join "`n").Trim()
    if ($exit -ne 0) {
      Write-Error "winget update failed ($exit): $text"
      exit 1
    }
    Write-Output $text
  }

  "window-control" {
    $action = $Arg1.Trim().ToLower()
    $target = $Arg2.Trim().ToLower()
    if (-not $target) { Write-Error "Target app/window name required"; exit 1 }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@

    $procs = Get-Process | Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and
      ($_.ProcessName.ToLower().Contains($target) -or $_.MainWindowTitle.ToLower().Contains($target))
    }

    $proc = $procs | Select-Object -First 1
    if (-not $proc) {
      Write-Error "No open window found matching '$Arg2'"
      exit 1
    }

    $hWnd = $proc.MainWindowHandle
    $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea

    switch ($action) {
      "focus" {
        [WinAPI]::ShowWindow($hWnd, 9) | Out-Null
        [WinAPI]::SetForegroundWindow($hWnd) | Out-Null
        Write-Output "Focused window: $($proc.MainWindowTitle)"
      }
      "maximize" {
        [WinAPI]::ShowWindow($hWnd, 3) | Out-Null
        [WinAPI]::SetForegroundWindow($hWnd) | Out-Null
        Write-Output "Maximized window: $($proc.MainWindowTitle)"
      }
      "minimize" {
        [WinAPI]::ShowWindow($hWnd, 6) | Out-Null
        Write-Output "Minimized window: $($proc.MainWindowTitle)"
      }
      "restore" {
        [WinAPI]::ShowWindow($hWnd, 9) | Out-Null
        [WinAPI]::SetForegroundWindow($hWnd) | Out-Null
        Write-Output "Restored window: $($proc.MainWindowTitle)"
      }
      "snap_left" {
        [WinAPI]::ShowWindow($hWnd, 9) | Out-Null
        [WinAPI]::MoveWindow($hWnd, $wa.X, $wa.Y, [int]($wa.Width / 2), $wa.Height, $true) | Out-Null
        [WinAPI]::SetForegroundWindow($hWnd) | Out-Null
        Write-Output "Snapped left: $($proc.MainWindowTitle)"
      }
      "snap_right" {
        [WinAPI]::ShowWindow($hWnd, 9) | Out-Null
        [WinAPI]::MoveWindow($hWnd, $wa.X + [int]($wa.Width / 2), $wa.Y, [int]($wa.Width / 2), $wa.Height, $true) | Out-Null
        [WinAPI]::SetForegroundWindow($hWnd) | Out-Null
        Write-Output "Snapped right: $($proc.MainWindowTitle)"
      }
      "close" {
        [WinAPI]::PostMessage($hWnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
        Write-Output "Sent close request to: $($proc.MainWindowTitle)"
      }
      default {
        Write-Error "Unknown window action: $action"
        exit 1
      }
    }
  }

  "ui-inspect" {
    $target = $Arg1.Trim().ToLower()
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgWinHelper {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

    $hWnd = [IntPtr]::Zero
    $winLabel = ""
    if (-not $target -or $target -eq "foreground" -or $target -eq "active") {
      $hWnd = [FgWinHelper]::GetForegroundWindow()
      $fgProc = Get-Process | Where-Object { $_.MainWindowHandle -eq $hWnd } | Select-Object -First 1
      if ($fgProc) { $winLabel = $fgProc.MainWindowTitle } else { $winLabel = "Active Window" }
    } else {
      $proc = Get-Process | Where-Object {
        $_.MainWindowHandle -ne [IntPtr]::Zero -and
        ($_.ProcessName.ToLower().Contains($target) -or $_.MainWindowTitle.ToLower().Contains($target))
      } | Select-Object -First 1
      if (-not $proc) { Write-Error "Open window not found for '$Arg1'"; exit 1 }
      $hWnd = $proc.MainWindowHandle
      $winLabel = $proc.MainWindowTitle
    }

    if ($hWnd -eq [IntPtr]::Zero) { Write-Error "No active window handle found"; exit 1 }
    $win = [System.Windows.Automation.AutomationElement]::FromHandle($hWnd)
    $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

    $interesting = @("Button", "MenuItem", "TabItem", "Edit", "CheckBox", "RadioButton", "ComboBox", "Hyperlink", "ListItem", "Text")
    $items = New-Object System.Collections.Generic.List[string]
    foreach ($el in $all) {
      $ct = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
      $nm = ($el.Current.Name -replace '\s+', ' ').Trim()
      if ($nm -and ($interesting -contains $ct)) {
        $items.Add("$ct : $nm")
        if ($items.Count -ge 75) { break }
      }
    }
    if ($items.Count -eq 0) {
      Write-Output "Window '$winLabel' found, no named UIA controls exposed."
    } else {
      Write-Output ("Window: $winLabel`n" + ($items -join "`n"))
    }
  }

  "screen-read" {
    $mode = if ($Arg1) { $Arg1.Trim().ToLower() } else { "read" }
    $queryText = if ($Arg2) { $Arg2.Trim().ToLower() } else { "" }

    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ScreenReaderNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
}
"@

    $hWnd = [ScreenReaderNative]::GetForegroundWindow()
    $sb = New-Object System.Text.StringBuilder 512
    [void][ScreenReaderNative]::GetWindowText($hWnd, $sb, 512)
    $winTitle = $sb.ToString().Trim()
    $pidOut = [uint32]0
    [void][ScreenReaderNative]::GetWindowThreadProcessId($hWnd, [ref]$pidOut)
    $procName = ""
    try { $procName = (Get-Process -Id $pidOut -ErrorAction SilentlyContinue).ProcessName } catch {}

    # If JEEVA itself is focused (user clicked inside JEEVA), inspect highest non-JEEVA visible app window instead
    if ($procName -match 'jeeva|electron' -or $winTitle -match 'JEEVA AI') {
      $altProc = Get-Process | Where-Object {
        $_.MainWindowHandle -ne [IntPtr]::Zero -and
        $_.MainWindowTitle -ne '' -and
        $_.ProcessName -notmatch '^(jeeva|electron|TextInputHost|ApplicationFrameHost)$'
      } | Select-Object -First 1
      if ($altProc) {
        $hWnd = $altProc.MainWindowHandle
        $winTitle = $altProc.MainWindowTitle
        $procName = $altProc.ProcessName
      }
    }

    $visibleTexts = New-Object System.Collections.Generic.List[string]
    $seenText = New-Object 'System.Collections.Generic.HashSet[string]'
    $interactive = New-Object System.Collections.Generic.List[object]

    if ($hWnd -ne [IntPtr]::Zero -and $mode -ne "ocr") {
      try {
        $elRoot = [System.Windows.Automation.AutomationElement]::FromHandle($hWnd)
        $desc = $elRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        $clickTypes = @("Button", "MenuItem", "TabItem", "Edit", "CheckBox", "RadioButton", "ComboBox", "Hyperlink", "ListItem")
        foreach ($el in $desc) {
          try {
            $cur = $el.Current
            if ($cur.IsOffscreen) { continue }
            $ct = $cur.ControlType.ProgrammaticName -replace '^ControlType\.', ''
            $nm = ($cur.Name -replace '\s+', ' ').Trim()
            if (-not $nm -or $nm.Length -lt 2) { continue }
            $rect = $cur.BoundingRectangle
            if ($rect.Width -le 0 -or $rect.Height -le 0) { continue }
            $cx = [int]($rect.X + ($rect.Width / 2))
            $cy = [int]($rect.Y + ($rect.Height / 2))

            if ($clickTypes -contains $ct -and $interactive.Count -lt 45) {
              $interactive.Add([PSCustomObject]@{ type = $ct; name = $nm.Substring(0, [Math]::Min($nm.Length, 80)); x = $cx; y = $cy })
            }
            if ($seenText.Add($nm.ToLower()) -and $visibleTexts.Count -lt 45) {
              $visibleTexts.Add($nm.Substring(0, [Math]::Min($nm.Length, 160)))
            }
          } catch {}
        }
      } catch {}
    }

    # Click target element or text on active screen
    if ($mode -eq "click_text" -and $queryText) {
      $hit = $interactive | Where-Object { $_.name.ToLower().Equals($queryText) } | Select-Object -First 1
      if (-not $hit) {
        $hit = $interactive | Where-Object { $_.name.ToLower().Contains($queryText) } | Select-Object -First 1
      }
      if ($hit) {
        [ScreenReaderNative]::SetCursorPos($hit.x, $hit.y) | Out-Null
        [ScreenReaderNative]::mouse_event(0x02, 0, 0, 0, 0)
        [ScreenReaderNative]::mouse_event(0x04, 0, 0, 0, 0)
        Write-Output "Clicked '$($hit.name)' ($($hit.type)) at ($($hit.x), $($hit.y)) in '$winTitle'"
        exit 0
      }
    }

    # Windows 10/11 Built-in Offline WinRT OCR fallback if UIA text is sparse or mode == ocr
    $ocrLines = New-Object System.Collections.Generic.List[string]
    if ($mode -eq "ocr" -or $visibleTexts.Count -lt 4 -or ($mode -eq "click_text" -and $queryText)) {
      try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
        $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
        $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType=WindowsRuntime]

        $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
          $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        })[0]

        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $gfx = [System.Drawing.Graphics]::FromImage($bmp)
        $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $gfx.Dispose()

        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        $bytes = $ms.ToArray()
        $ms.Dispose()

        $ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
        $writer = New-Object Windows.Storage.Streams.DataWriter $ras
        $writer.WriteBytes($bytes)
        $storeOp = $writer.StoreAsync()
        $storeTask = $asTaskGeneric.MakeGenericMethod([uint32]).Invoke($null, @($storeOp))
        $null = $storeTask.GetAwaiter().GetResult()
        $ras.Seek(0)

        $decOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)
        $decTask = $asTaskGeneric.MakeGenericMethod([Windows.Graphics.Imaging.BitmapDecoder]).Invoke($null, @($decOp))
        $decoder = $decTask.GetAwaiter().GetResult()

        $sbOp = $decoder.GetSoftwareBitmapAsync()
        $sbTask = $asTaskGeneric.MakeGenericMethod([Windows.Graphics.Imaging.SoftwareBitmap]).Invoke($null, @($sbOp))
        $softBmp = $sbTask.GetAwaiter().GetResult()

        $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
        if ($ocrEngine) {
          $ocrOp = $ocrEngine.RecognizeAsync($softBmp)
          $ocrTask = $asTaskGeneric.MakeGenericMethod([Windows.Media.Ocr.OcrResult]).Invoke($null, @($ocrOp))
          $ocrRes = $ocrTask.GetAwaiter().GetResult()

          if ($mode -eq "click_text" -and $queryText) {
            foreach ($line in $ocrRes.Lines) {
              if ($line.Text.ToLower().Contains($queryText)) {
                $wMatch = $line.Words | Where-Object { $queryText.Contains($_.Text.ToLower()) -or $_.Text.ToLower().Contains($queryText) } | Select-Object -First 1
                $box = if ($wMatch) { $wMatch.BoundingRect } else { $line.Words[0].BoundingRect }
                $cx = [int]($box.X + ($box.Width / 2))
                $cy = [int]($box.Y + ($box.Height / 2))
                [ScreenReaderNative]::SetCursorPos($cx, $cy) | Out-Null
                [ScreenReaderNative]::mouse_event(0x02, 0, 0, 0, 0)
                [ScreenReaderNative]::mouse_event(0x04, 0, 0, 0, 0)
                Write-Output "Clicked screen text '$($line.Text)' at ($cx, $cy) via Offline OCR"
                exit 0
              }
            }
          }

          foreach ($line in $ocrRes.Lines) {
            if ($line.Text -and $ocrLines.Count -lt 40) { $ocrLines.Add($line.Text.Trim()) }
          }
        }
        $ras.Dispose()
      } catch {}
    }

    if ($mode -eq "click_text") {
      Write-Error "Screen par '$Arg2' element ya text nahi mila."
      exit 1
    }

    $resultObj = [PSCustomObject]@{
      windowTitle = $winTitle
      processName = $procName
      visibleText = $visibleTexts
      ocrText = $ocrLines
      interactiveElements = $interactive
    }
    $resultObj | ConvertTo-Json -Depth 4
  }

  "ui-click" {
    $target = $Arg1.Trim().ToLower()
    $elemQuery = $Arg2.Trim().ToLower()
    if (-not $target -or -not $elemQuery) { Write-Error "App name and element name required"; exit 1 }

    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseHelper {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
}
"@

    $proc = Get-Process | Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and
      ($_.ProcessName.ToLower().Contains($target) -or $_.MainWindowTitle.ToLower().Contains($target))
    } | Select-Object -First 1

    if (-not $proc) { Write-Error "Open window not found for '$Arg1'"; exit 1 }
    [MouseHelper]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null

    $win = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

    $match = $null
    foreach ($el in $all) {
      $nm = ($el.Current.Name -replace '\s+', ' ').Trim()
      if ($nm -and $nm.ToLower().Equals($elemQuery)) { $match = $el; break }
    }
    if (-not $match) {
      foreach ($el in $all) {
        $nm = ($el.Current.Name -replace '\s+', ' ').Trim()
        if ($nm -and $nm.ToLower().Contains($elemQuery)) { $match = $el; break }
      }
    }
    if (-not $match) { Write-Error "UI element '$Arg2' not found in '$($proc.MainWindowTitle)'"; exit 1 }

    $clicked = $false
    foreach ($pat in @([System.Windows.Automation.InvokePattern]::Pattern, [System.Windows.Automation.SelectionItemPattern]::Pattern, [System.Windows.Automation.TogglePattern]::Pattern)) {
      $p = $null
      if ($match.TryGetCurrentPattern($pat, [ref]$p)) {
        if ($pat -eq [System.Windows.Automation.InvokePattern]::Pattern) { $p.Invoke(); $clicked = $true; break }
        if ($pat -eq [System.Windows.Automation.SelectionItemPattern]::Pattern) { $p.Select(); $clicked = $true; break }
        if ($pat -eq [System.Windows.Automation.TogglePattern]::Pattern) { $p.Toggle(); $clicked = $true; break }
      }
    }
    if (-not $clicked) {
      $pt = New-Object System.Windows.Point
      if ($match.TryGetClickablePoint([ref]$pt)) {
        [MouseHelper]::SetCursorPos([int]$pt.X, [int]$pt.Y) | Out-Null
        [MouseHelper]::mouse_event(0x02, 0, 0, 0, 0)
        [MouseHelper]::mouse_event(0x04, 0, 0, 0, 0)
        $clicked = $true
      }
    }
    if (-not $clicked) { Write-Error "Could not invoke or click '$Arg2'"; exit 1 }
    Write-Output "Clicked '$($match.Current.Name)' in '$($proc.MainWindowTitle)'"
  }

  "ui-set-text" {
    $target = $Arg1.Trim().ToLower()
    $elemQuery = $Arg2.Trim().ToLower()
    $val = $Arg3
    if (-not $target -or -not $elemQuery) { Write-Error "App name and element name required"; exit 1 }

    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName System.Windows.Forms

    $proc = Get-Process | Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and
      ($_.ProcessName.ToLower().Contains($target) -or $_.MainWindowTitle.ToLower().Contains($target))
    } | Select-Object -First 1

    if (-not $proc) { Write-Error "Open window not found for '$Arg1'"; exit 1 }
    $win = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

    $match = $null
    foreach ($el in $all) {
      $nm = ($el.Current.Name -replace '\s+', ' ').Trim()
      if ($nm -and $nm.ToLower().Contains($elemQuery)) { $match = $el; break }
    }
    if (-not $match) { Write-Error "Input element '$Arg2' not found"; exit 1 }

    $vp = $null
    if ($match.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      $vp.SetValue($val)
      Write-Output "Set text in '$($match.Current.Name)'"
    } else {
      $match.SetFocus()
      $escapedVal = [regex]::Replace([string]$val, '([+^%~()\[\]{}])', '{$1}')
      [System.Windows.Forms.SendKeys]::SendWait($escapedVal)
      Write-Output "Focused and typed into '$($match.Current.Name)'"
    }
  }

  default {
    Write-Error "Unknown win-apps task: $Task"
    exit 1
  }
}
