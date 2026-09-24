#Requires -Version 7
<#
.SYNOPSIS
Regenerates test/fixtures/parity-expected.json by pushing parity-input.json through the real
workbook in Excel. Re-run whenever the workbook's formulas change, then run the parity test.
#>
param(
  [string]$Workbook = (Join-Path $PSScriptRoot '..\Masjid_Fundraiser_Tracker_v3.xlsx'),
  [string]$InputPath = (Join-Path $PSScriptRoot '..\test\fixtures\parity-input.json'),
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\test\fixtures\parity-expected.json')
)
$ErrorActionPreference = 'Stop'

$fixture = Get-Content -Raw -Encoding utf8 $InputPath | ConvertFrom-Json -DateKind String
$workingCopy = Join-Path ([IO.Path]::GetTempPath()) ("parity-" + [guid]::NewGuid() + '.xlsx')
Copy-Item $Workbook $workingCopy

function Test-Present($value) { $null -ne $value -and [string]$value -ne '' }
function ConvertTo-Serial([string]$iso) {
  [DateTime]::ParseExact($iso, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture).ToOADate()
}
# Text format first, so '0551234' keeps its leading zero exactly as a volunteer typed it.
function Set-Text($cell, [string]$value) { $cell.NumberFormat = '@'; $cell.Value2 = $value }
function Read-Cell($cell, [switch]$AsDate) {
  $value = $cell.Value2
  if ($null -eq $value -or ($value -is [string] -and $value -eq '')) { return $null }
  if ($AsDate -and $value -is [double]) { return [DateTime]::FromOADate($value).ToString('yyyy-MM-dd') }
  return $value
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $book = $excel.Workbooks.Open($workingCopy)
  $pledgeSheet = $book.Worksheets.Item('Pledges')
  $paymentSheet = $book.Worksheets.Item('Payments')
  $summarySheet = $book.Worksheets.Item('Summary')
  foreach ($sheet in @($pledgeSheet, $paymentSheet, $summarySheet)) { $sheet.Unprotect() }

  $row = 5
  foreach ($p in $fixture.pledges) {
    if (Test-Present $p.phone) { Set-Text $pledgeSheet.Range("A$row") $p.phone }
    if (Test-Present $p.name) { Set-Text $pledgeSheet.Range("B$row") $p.name }
    if (Test-Present $p.datePledged) { $pledgeSheet.Range("C$row").Value2 = ConvertTo-Serial $p.datePledged }
    if (Test-Present $p.amountPledged) { $pledgeSheet.Range("D$row").Value2 = [double]$p.amountPledged }
    if (Test-Present $p.notes) { Set-Text $pledgeSheet.Range("J$row") $p.notes }
    $row++
  }
  $row = 5
  foreach ($p in $fixture.payments) {
    if (Test-Present $p.phone) { Set-Text $paymentSheet.Range("A$row") $p.phone }
    if (Test-Present $p.dateReceived) { $paymentSheet.Range("C$row").Value2 = ConvertTo-Serial $p.dateReceived }
    if (Test-Present $p.amountReceived) { $paymentSheet.Range("D$row").Value2 = [double]$p.amountReceived }
    if (Test-Present $p.method) { Set-Text $paymentSheet.Range("E$row") $p.method }
    if (Test-Present $p.notes) { Set-Text $paymentSheet.Range("F$row") $p.notes }
    $row++
  }
  $summarySheet.Range('B4').Value2 = [double]$fixture.settings.goal
  $excel.CalculateFullRebuild()

  $pledgeResults = for ($i = 0; $i -lt $fixture.pledges.Count; $i++) {
    $r = 5 + $i
    [ordered]@{
      id = $fixture.pledges[$i].id
      E = Read-Cell $pledgeSheet.Range("E$r") -AsDate
      F = Read-Cell $pledgeSheet.Range("F$r")
      G = Read-Cell $pledgeSheet.Range("G$r")
      H = Read-Cell $pledgeSheet.Range("H$r")
      I = Read-Cell $pledgeSheet.Range("I$r")
    }
  }
  $paymentResults = for ($i = 0; $i -lt $fixture.payments.Count; $i++) {
    [ordered]@{ id = $fixture.payments[$i].id; B = Read-Cell $paymentSheet.Range("B$(5 + $i)") }
  }
  $summary = [ordered]@{}
  foreach ($r in @(5..16) + @(21..26) + @(30..37)) { $summary["B$r"] = Read-Cell $summarySheet.Range("B$r") }

  $lookupResults = foreach ($query in $fixture.lookups) {
    $lookupCell = $summarySheet.Range('B41')
    if ($query -eq '') { [void]$lookupCell.ClearContents() } else { Set-Text $lookupCell $query }
    $excel.Calculate()
    $result = [ordered]@{ input = $query }
    foreach ($r in 42..50) { $result["B$r"] = Read-Cell $summarySheet.Range("B$r") -AsDate:($r -in 43, 45) }
    $result
  }
  $book.Close($false)
}
finally {
  $excel.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  Remove-Item $workingCopy -ErrorAction SilentlyContinue
}

[ordered]@{
  source   = 'Masjid_Fundraiser_Tracker_v3.xlsx'
  today    = (Get-Date).ToString('yyyy-MM-dd')
  pledges  = @($pledgeResults)
  payments = @($paymentResults)
  summary  = $summary
  lookups  = @($lookupResults)
} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8NoBOM $OutputPath
Write-Host "Wrote $OutputPath"
