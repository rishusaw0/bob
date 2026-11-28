param(
  [string]$AiName = "Jeeva",
  [double]$MinConfidence = 0.52,
  [string]$Mode = "wake",
  [int]$TimeoutSec = 7,
  [string]$Culture = "auto"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Emit-Event($obj) {
  Write-Output ($obj | ConvertTo-Json -Compress)
  [Console]::Out.Flush()
}

try {
  Add-Type -AssemblyName System.Speech
} catch {
  Emit-Event @{ type = "unavailable"; reason = "System.Speech assembly unavailable" }
  exit 0
}

$recognizers = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
if (-not $recognizers -or $recognizers.Count -eq 0) {
  Emit-Event @{ type = "unavailable"; reason = "No Windows Speech Recognition pack installed" }
  exit 0
}

# Pick the requested installed recognizer for dictation; never claim a language pack that is absent.
$requestedCulture = [string]$Culture
$picked = $null
if ($requestedCulture -eq "hi") {
  $picked = $recognizers | Where-Object { $_.Culture.Name -like "hi-*" } | Select-Object -First 1
} elseif ($requestedCulture -eq "en") {
  $picked = $recognizers | Where-Object { $_.Culture.Name -like "en-IN" } | Select-Object -First 1
  if (-not $picked) { $picked = $recognizers | Where-Object { $_.Culture.Name -like "en-*" } | Select-Object -First 1 }
} else {
  $picked = $recognizers | Where-Object { $_.Culture.Name -eq "en-IN" } | Select-Object -First 1
  if (-not $picked) { $picked = $recognizers | Where-Object { $_.Culture.Name -eq "hi-IN" } | Select-Object -First 1 }
  if (-not $picked) { $picked = $recognizers | Where-Object { $_.Culture.Name -like "en-*" } | Select-Object -First 1 }
}
if (-not $picked) {
  Emit-Event @{ type = "unavailable"; reason = "No installed Windows SAPI recognizer matches requested culture: $requestedCulture" }
  exit 0
}

$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($picked.Culture)
try {
  $engine.SetInputToDefaultAudioDevice()
} catch {
  Emit-Event @{ type = "unavailable"; reason = "No default audio input microphone device found" }
  $engine.Dispose()
  exit 0
}

if ($Mode -eq "dictate") {
  try {
    $dictGrammar = New-Object System.Speech.Recognition.DictationGrammar
    $dictGrammar.Name = "FreeDictation"
    $engine.LoadGrammar($dictGrammar)
    $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds([Math]::Max(3, [Math]::Min(12, $TimeoutSec)))
    $engine.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(650)
    $result = $engine.Recognize([TimeSpan]::FromSeconds([Math]::Max(4, $TimeoutSec + 2)))
    if ($result -and $result.Text -and $result.Confidence -ge 0.25) {
      Emit-Event @{ type = "dictation"; text = $result.Text.Trim(); confidence = [math]::Round($result.Confidence, 2); culture = $picked.Culture.Name }
    } else {
      Emit-Event @{ type = "dictation"; text = ""; confidence = 0; culture = $picked.Culture.Name }
    }
  } catch {
    Emit-Event @{ type = "dictation"; text = ""; error = $_.Exception.Message }
  } finally {
    $engine.Dispose()
  }
  exit 0
}

$rawParts = $AiName -split '\|'
$cleanName = ($rawParts[0] -replace '[^a-zA-Z0-9\s]', '').Trim()
if (-not $cleanName) { $cleanName = "Jeeva" }
$customTrigger = if ($rawParts.Count -gt 1) { ($rawParts[1] -replace '[^a-zA-Z0-9\s]', '').Trim() } else { "" }

$wakeChoices = New-Object System.Speech.Recognition.Choices
$wakeList = New-Object System.Collections.Generic.List[string]
foreach ($p in @(
  "hey $cleanName",
  "hi $cleanName",
  "hello $cleanName",
  "ok $cleanName",
  "okay $cleanName",
  "listen $cleanName",
  "suno $cleanName",
  $cleanName
)) {
  if ($p -and -not $wakeList.Contains($p)) { $wakeList.Add($p) }
}
if ($customTrigger -and -not $wakeList.Contains($customTrigger)) {
  $wakeList.Insert(0, $customTrigger)
}
$wakePhrases = $wakeList.ToArray()
foreach ($p in $wakePhrases) { $wakeChoices.Add($p) }

$cmdChoices = New-Object System.Speech.Recognition.Choices
$offlineCmds = @(
  "volume up", "volume down", "volume 20", "volume 40", "volume 50", "volume 60", "volume 80", "volume 100",
  "mute", "unmute", "brightness up", "brightness down", "brightness 50", "brightness 80",
  "wifi on", "wifi off", "wifi status",
  "screenshot", "read screen", "screen reader", "dark mode", "light mode", "minimize all",
  "battery status", "cpu status", "ram status", "top processes", "clipboard history",
  "organize downloads", "clean temp", "running apps", "installed apps",
  "open chrome", "open notepad", "open vscode", "open calculator", "open settings",
  "close chrome", "close notepad",
  "new tab", "close tab", "next tab", "previous tab", "skip ad",
  "coding mode", "night mode", "power saver mode", "high performance mode",
  "play music", "pause music", "next track", "previous track", "stop",
  "scroll down", "scroll up", "copy", "paste", "undo", "save", "press enter", "lock pc", "active reminders",
  "what time is it", "what is the date", "what did i ask yesterday"
)
foreach ($c in $offlineCmds) { $cmdChoices.Add($c) }

$gbWakeOnly = New-Object System.Speech.Recognition.GrammarBuilder
$gbWakeOnly.Append($wakeChoices)
$gWakeOnly = New-Object System.Speech.Recognition.Grammar($gbWakeOnly)
$gWakeOnly.Name = "WakeOnly"

$gbWakeCmd = New-Object System.Speech.Recognition.GrammarBuilder
$gbWakeCmd.Append($wakeChoices)
$gbWakeCmd.Append($cmdChoices)
$gWakeCmd = New-Object System.Speech.Recognition.Grammar($gbWakeCmd)
$gWakeCmd.Name = "WakeCmd"

$engine.LoadGrammar($gWakeOnly)
$engine.LoadGrammar($gWakeCmd)

$sub = Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -SourceIdentifier "JeevaOfflineSpeech"

try {
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  Emit-Event @{
    type = "ready"
    culture = $picked.Culture.Name
    aiName = $cleanName
  }

  while ($true) {
    $ev = Wait-Event -SourceIdentifier "JeevaOfflineSpeech" -Timeout 2
    if ($null -eq $ev) {
      # Break cleanly if parent closed stdin
      if ([Console]::IsInputRedirected -and [Console]::In.Peek() -eq -1) {
        break
      }
      continue
    }
    $res = $ev.SourceEventArgs.Result
    Remove-Event -EventIdentifier $ev.EventIdentifier
    if ($null -eq $res) { continue }
    if ($res.Confidence -lt $MinConfidence) { continue }

    $text = [string]$res.Text
    $cmdPart = ""
    foreach ($prefix in $wakePhrases) {
      if ($text.ToLower().StartsWith($prefix.ToLower())) {
        $cmdPart = $text.Substring($prefix.Length).Trim()
        break
      }
    }
    Emit-Event @{
      type = "wake"
      phrase = $text
      command = $cmdPart
      confidence = [math]::Round($res.Confidence, 2)
    }
  }
} finally {
  Unregister-Event -SourceIdentifier "JeevaOfflineSpeech" -ErrorAction SilentlyContinue
  try { $engine.RecognizeAsyncCancel() } catch {}
  $engine.Dispose()
}
