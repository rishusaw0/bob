param(
  [string]$AiName = "Jeeva",
  [double]$MinConfidence = 0.56
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

# Prefer en-IN or en-US recognizer for Romanized Hinglish + English accuracy
$picked = $recognizers | Where-Object { $_.Culture.Name -eq "en-IN" } | Select-Object -First 1
if (-not $picked) { $picked = $recognizers | Where-Object { $_.Culture.Name -like "en-*" } | Select-Object -First 1 }
if (-not $picked) { $picked = $recognizers | Select-Object -First 1 }

$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($picked.Culture)
try {
  $engine.SetInputToDefaultAudioDevice()
} catch {
  Emit-Event @{ type = "unavailable"; reason = "No default audio input microphone device found" }
  $engine.Dispose()
  exit 0
}

$cleanName = ($AiName -replace '[^a-zA-Z0-9\s]', '').Trim()
if (-not $cleanName) { $cleanName = "Jeeva" }

$wakeChoices = New-Object System.Speech.Recognition.Choices
$wakePhrases = @(
  "hey $cleanName",
  "hi $cleanName",
  "hello $cleanName",
  "ok $cleanName",
  "okay $cleanName",
  "listen $cleanName",
  $cleanName
)
foreach ($p in $wakePhrases) { $wakeChoices.Add($p) }

$cmdChoices = New-Object System.Speech.Recognition.Choices
$offlineCmds = @(
  "volume up", "volume down", "mute", "unmute",
  "brightness up", "brightness down",
  "wifi on", "wifi off", "wifi status",
  "screenshot", "dark mode", "light mode", "minimize all",
  "battery status", "cpu status", "top processes", "clipboard history",
  "open chrome", "open notepad", "open vscode", "open calculator",
  "coding mode", "night mode", "play music", "pause music", "next track", "stop"
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
        Start-Sleep -Milliseconds 150
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
