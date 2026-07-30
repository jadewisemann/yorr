<#
.SYNOPSIS
  족보 콜아웃 음성(S15P11A406-138) 생성기.

.DESCRIPTION
  Windows SAPI의 한국어 여성 음성(Microsoft Heami)으로 public/audio/hand-voice/*.wav를 만든다.
  SAPI 원본은 앞뒤 무음이 100ms 넘게 붙고 피크가 40% 정도라 그대로 쓰면 콜아웃 텍스트가
  뜬 뒤에 뒤늦게, 작게 들린다. 그래서 생성 → 무음 트림 → 피크 정규화까지 여기서 끝낸다.

  톤을 바꾸고 싶으면 -Pitch · -Rate만 조정해 다시 돌리면 된다. 성우 녹음이나 상용 TTS로
  교체할 때도 같은 경로·파일명에 덮어쓰면 코드 변경 없이 반영된다.

.EXAMPLE
  pwsh -File scripts/generate-hand-voice.ps1
  pwsh -File scripts/generate-hand-voice.ps1 -Pitch 35 -Rate 20

.NOTES
  이 파일은 반드시 BOM 있는 UTF-8로 저장한다. Windows PowerShell 5.1은 BOM이 없으면
  스크립트를 시스템 ANSI 코드페이지(CP949)로 읽어 아래 한글 발화 텍스트가 깨진 채
  SAPI에 전달된다 — 소리는 나지만 전혀 다른 말이 녹음된다.
#>
param(
  # 기본 음높이 대비 상대 피치(%). 성인 여성 기본음을 올려 하이톤을 만든다.
  [int]$Pitch = 25,
  # 발화 속도(%). 살짝 빠르게 해서 씩씩한 느낌을 준다.
  [int]$Rate = 15,
  [string]$VoiceName = 'Microsoft Heami Desktop',
  # 22.05kHz 모노면 짧은 외침에 충분하고, 5개 합쳐도 100KB 안쪽이다.
  [int]$SampleRate = 22050,
  # 정규화 목표 피크(0~1). 1.0은 클리핑 위험이 있어 -1dB 정도로 둔다.
  [double]$TargetPeak = 0.89
)

$ErrorActionPreference = 'Stop'

# 화면에 뜨는 족보 텍스트(categoryLabel)와 같은 말을 읽는다. 표기가 다르면 자막과 목소리가
# 어긋나 오히려 헷갈린다 — yachtCategoryView.ts의 categoryLabel이 기준이다.
$lines = [ordered]@{
  'yacht'          = '요트!'
  'large-straight' = '라지 스트레이트!'
  'small-straight' = '스몰 스트레이트!'
  'full-house'     = '풀하우스!'
  'four-of-a-kind' = '포커!'
}

$outputDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'public/audio/hand-voice'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Add-Type -AssemblyName System.Speech

<# PCM WAV에서 (samples, sampleRate)를 읽는다. RIFF 청크를 순회해 data 위치를 찾는다. #>
function Read-PcmWave([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $pos = 12
  $dataOffset = -1
  $dataLength = 0
  $rate = 0
  while ($pos -lt $bytes.Length - 8) {
    $id = [System.Text.Encoding]::ASCII.GetString($bytes, $pos, 4)
    $size = [System.BitConverter]::ToUInt32($bytes, $pos + 4)
    if ($id -eq 'fmt ') { $rate = [System.BitConverter]::ToUInt32($bytes, $pos + 12) }
    elseif ($id -eq 'data') { $dataOffset = $pos + 8; $dataLength = $size }
    $pos += 8 + $size + ($size % 2)
  }
  if ($dataOffset -lt 0) { throw "data 청크를 찾지 못했습니다: $path" }

  $count = [int]($dataLength / 2)
  $samples = New-Object 'System.Int16[]' $count
  [System.Buffer]::BlockCopy($bytes, $dataOffset, $samples, 0, $count * 2)
  return @{ Samples = $samples; SampleRate = $rate }
}

<# 16bit 모노 PCM WAV로 쓴다. 헤더는 44바이트 표준형 하나만 쓴다. #>
function Write-PcmWave([string]$path, [int16[]]$samples, [int]$rate) {
  $dataSize = $samples.Length * 2
  $stream = [System.IO.File]::Create($path)
  $writer = New-Object System.IO.BinaryWriter($stream)
  try {
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
    $writer.Write([uint32](36 + $dataSize))
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
    $writer.Write([uint32]16)
    $writer.Write([uint16]1)          # PCM
    $writer.Write([uint16]1)          # mono
    $writer.Write([uint32]$rate)
    $writer.Write([uint32]($rate * 2))
    $writer.Write([uint16]2)
    $writer.Write([uint16]16)
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('data'))
    $writer.Write([uint32]$dataSize)
    $pcm = New-Object 'System.Byte[]' $dataSize
    [System.Buffer]::BlockCopy($samples, 0, $pcm, 0, $dataSize)
    $writer.Write($pcm)
  }
  finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

<#
  앞뒤 무음을 걷어내고 피크를 목표치까지 올린다.
  머리는 20ms만 남겨 콜아웃 텍스트가 뜨는 순간과 첫 음절을 맞추고,
  꼬리는 60ms 남겨 갑자기 끊긴 느낌을 없앤다.
#>
function Get-TrimmedNormalized([int16[]]$samples, [int]$rate, [double]$targetPeak) {
  $silenceFloor = 700
  $first = -1
  $last = -1
  $peak = 0
  for ($i = 0; $i -lt $samples.Length; $i++) {
    $magnitude = [math]::Abs([int]$samples[$i])
    if ($magnitude -gt $peak) { $peak = $magnitude }
    if ($magnitude -gt $silenceFloor) {
      if ($first -lt 0) { $first = $i }
      $last = $i
    }
  }
  if ($first -lt 0) { throw '무음만 생성되었습니다. 음성 이름과 발화 텍스트를 확인하세요.' }

  $start = [math]::Max(0, $first - [int]($rate * 0.02))
  $end = [math]::Min($samples.Length - 1, $last + [int]($rate * 0.06))
  $gain = if ($peak -gt 0) { ($targetPeak * 32767) / $peak } else { 1 }

  $trimmed = New-Object 'System.Int16[]' ($end - $start + 1)
  for ($i = 0; $i -lt $trimmed.Length; $i++) {
    $value = [int][math]::Round($samples[$start + $i] * $gain)
    $trimmed[$i] = [int16][math]::Max(-32768, [math]::Min(32767, $value))
  }
  return @{ Samples = $trimmed; Gain = $gain }
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $installed = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
  if ($installed -notcontains $VoiceName) {
    throw "'$VoiceName' 음성이 없습니다. 설치된 음성: $($installed -join ', ')"
  }
  $synth.SelectVoice($VoiceName)
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    $SampleRate,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
  )

  foreach ($name in $lines.Keys) {
    $text = $lines[$name]
    $rawPath = Join-Path ([System.IO.Path]::GetTempPath()) "yorr-hand-voice-$name.wav"
    $ssml = @"
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko-KR"><prosody pitch="+$Pitch%" rate="+$Rate%">$text</prosody></speak>
"@

    $synth.SetOutputToWaveFile($rawPath, $format)
    $synth.SpeakSsml($ssml)
    $synth.SetOutputToNull()

    $raw = Read-PcmWave $rawPath
    $clip = Get-TrimmedNormalized $raw.Samples $raw.SampleRate $TargetPeak
    $outPath = Join-Path $outputDir "$name.wav"
    Write-PcmWave $outPath $clip.Samples $raw.SampleRate
    Remove-Item $rawPath -Force

    $durationMs = [int](1000 * $clip.Samples.Length / $raw.SampleRate)
    $sizeKb = [math]::Round((Get-Item $outPath).Length / 1KB, 1)
    "$name.wav  '$text'  ${durationMs}ms  ${sizeKb}KB  (gain x$([math]::Round($clip.Gain, 2)))"
  }
}
finally {
  $synth.Dispose()
}
