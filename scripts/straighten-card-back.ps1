# 检测卡背内容中轴（PCA），旋转扶正并裁掉黑边
Add-Type -AssemblyName System.Drawing

$src = 'e:\桌面\oc 2.0\oc (2)\oc\oc\images\card-back.png'
$dst = 'e:\桌面\oc 2.0\oc (2)\oc\oc\images\card-back.png'
$threshold = 28

function Get-NonBlackBoundsAndAngle([System.Drawing.Bitmap]$bmp) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $bmp.PixelFormat)
  $stride = $data.Stride
  $bytes = New-Object byte[] ($stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)

  $w = $bmp.Width
  $h = $bmp.Height
  $sumX = 0.0
  $sumY = 0.0
  $count = 0
  $minX = $w
  $minY = $h
  $maxX = 0
  $maxY = 0

  for ($y = 0; $y -lt $h; $y++) {
    $row = $y * $stride
    for ($x = 0; $x -lt $w; $x++) {
      $i = $row + $x * 4
      $b = $bytes[$i]
      $g = $bytes[$i + 1]
      $r = $bytes[$i + 2]
      if ($r -gt $threshold -or $g -gt $threshold -or $b -gt $threshold) {
        $sumX += $x
        $sumY += $y
        $count++
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }

  if ($count -eq 0) { throw 'No content pixels found' }

  $cx = $sumX / $count
  $cy = $sumY / $count
  $mu20 = 0.0
  $mu02 = 0.0
  $mu11 = 0.0

  for ($y = 0; $y -lt $h; $y++) {
    $row = $y * $stride
    for ($x = 0; $x -lt $w; $x++) {
      $i = $row + $x * 4
      $b = $bytes[$i]
      $g = $bytes[$i + 1]
      $r = $bytes[$i + 2]
      if ($r -gt $threshold -or $g -gt $threshold -or $b -gt $threshold) {
        $dx = $x - $cx
        $dy = $y - $cy
        $mu20 += $dx * $dx
        $mu02 += $dy * $dy
        $mu11 += $dx * $dy
      }
    }
  }

  $angleRad = [Math]::Atan2(2 * $mu11, $mu20 - $mu02) / 2.0
  $angleDeg = $angleRad * 180.0 / [Math]::PI
  # 主轴对齐竖直（90°）
  $correction = 90.0 - $angleDeg
  while ($correction -gt 90) { $correction -= 180 }
  while ($correction -lt -90) { $correction += 180 }

  [PSCustomObject]@{
    Correction = $correction
    CenterX    = $cx
    CenterY    = $cy
    MinX       = $minX
    MinY       = $minY
    MaxX       = $maxX
    MaxY       = $maxY
    Count      = $count
  }
}

function Rotate-Bitmap([System.Drawing.Bitmap]$srcBmp, [double]$degrees) {
  $w = $srcBmp.Width
  $h = $srcBmp.Height
  $rad = $degrees * [Math]::PI / 180.0
  $cos = [Math]::Abs([Math]::Cos($rad))
  $sin = [Math]::Abs([Math]::Sin($rad))
  $nw = [int][Math]::Ceiling($w * $cos + $h * $sin)
  $nh = [int][Math]::Ceiling($w * $sin + $h * $cos)

  $out = New-Object System.Drawing.Bitmap $nw, $nh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  $out.SetResolution($srcBmp.HorizontalResolution, $srcBmp.VerticalResolution)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.TranslateTransform($nw / 2.0, $nh / 2.0)
  $g.RotateTransform($degrees)
  $g.TranslateTransform(-$w / 2.0, -$h / 2.0)
  $g.DrawImage($srcBmp, 0, 0, $w, $h)
  $g.Dispose()
  return $out
}

function Crop-Content([System.Drawing.Bitmap]$bmp, [int]$threshold) {
  $info = Get-NonBlackBoundsAndAngle $bmp
  $pad = 2
  $x = [Math]::Max(0, $info.MinX - $pad)
  $y = [Math]::Max(0, $info.MinY - $pad)
  $cw = [Math]::Min($bmp.Width - $x, $info.MaxX - $info.MinX + 1 + $pad * 2)
  $ch = [Math]::Min($bmp.Height - $y, $info.MaxY - $info.MinY + 1 + $pad * 2)
  $cropRect = New-Object System.Drawing.Rectangle $x, $y, $cw, $ch
  return $bmp.Clone($cropRect, $bmp.PixelFormat)
}

function Scale-ToRatio([System.Drawing.Bitmap]$bmp, [int]$outW, [int]$outH) {
  $out = New-Object System.Drawing.Bitmap $outW, $outH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.DrawImage($bmp, 0, 0, $outW, $outH)
  $g.Dispose()
  return $out
}

$srcBmp = [System.Drawing.Bitmap]::FromFile($src)
$meta = Get-NonBlackBoundsAndAngle $srcBmp
Write-Host ("Detected tilt: {0:N2} deg (correction {1:N2})" -f (90 - $meta.Correction), $meta.Correction)

$rotated = Rotate-Bitmap $srcBmp $meta.Correction
$srcBmp.Dispose()

$cropped = Crop-Content $rotated $threshold
$rotated.Dispose()

# 2:3 卡槽比例
$final = Scale-ToRatio $cropped 504 756
$cropped.Dispose()

$final.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$len = (Get-Item -LiteralPath $dst).Length
Write-Host "Saved $dst (${len} bytes, 504x756)"
$final.Dispose()
