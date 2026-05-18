param(
  [string]$JsonPath,
  [string]$XlsxPath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

$data = Get-Content -Raw -Encoding UTF8 $JsonPath | ConvertFrom-Json

function Convert-ColumnName([int]$index) {
  $name = ""
  while ($index -gt 0) {
    $mod = ($index - 1) % 26
    $name = [char](65 + $mod) + $name
    $index = [math]::Floor(($index - 1) / 26)
  }
  return $name
}

function Escape-Xml([string]$text) {
  if ($null -eq $text) { return "" }
  return [System.Security.SecurityElement]::Escape([string]$text)
}

function New-SheetXml($rows) {
  if (-not $rows -or $rows.Count -eq 0) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'
  }

  $headers = @($rows[0].PSObject.Properties.Name)
  $allRows = @()
  $allRows += ,$headers
  foreach ($row in $rows) {
    $values = @()
    foreach ($header in $headers) {
      $values += [string]$row.$header
    }
    $allRows += ,$values
  }

  $xmlRows = for ($r = 0; $r -lt $allRows.Count; $r++) {
    $rowNumber = $r + 1
    $cells = for ($c = 0; $c -lt $allRows[$r].Count; $c++) {
      $ref = "$(Convert-ColumnName ($c + 1))$rowNumber"
      $value = Escape-Xml $allRows[$r][$c]
      "<c r=""$ref"" t=""inlineStr""><is><t>$value</t></is></c>"
    }
    "<row r=""$rowNumber"">$($cells -join '')</row>"
  }

  return "<?xml version=""1.0"" encoding=""UTF-8"" standalone=""yes""?><worksheet xmlns=""http://schemas.openxmlformats.org/spreadsheetml/2006/main""><sheetData>$($xmlRows -join '')</sheetData></worksheet>"
}

function Add-Entry($archive, [string]$entryPath, [string]$content) {
  $entry = $archive.CreateEntry($entryPath)
  $writer = New-Object System.IO.StreamWriter($entry.Open(), [System.Text.UTF8Encoding]::new($false))
  try { $writer.Write($content) } finally { $writer.Dispose() }
}

$sheetDefs = @(
  @{ Name = "说明"; Rows = @(
      [pscustomobject]@{ Label = "Usage"; Content = "Maintain all upload data in this single workbook." },
      [pscustomobject]@{ Label = "Import"; Content = "Upload this workbook directly and the app will read every sheet." },
      [pscustomobject]@{ Label = "Plan"; Content = "This workbook contains baseline only." },
      [pscustomobject]@{ Label = "Source"; Content = "Generated from floor.csv and room.csv." }
    ) },
  @{ Name = "buildings"; Rows = @($data.buildings) },
  @{ Name = "floor_segments"; Rows = @($data.floor_segments) },
  @{ Name = "spaces"; Rows = @($data.spaces) },
  @{ Name = "labs"; Rows = @($data.labs) },
  @{ Name = "plans"; Rows = @($data.plans) },
  @{ Name = "plan_assignments"; Rows = @($data.plan_assignments) }
)

if (Test-Path $XlsxPath) { Remove-Item $XlsxPath -Force }
$zip = [System.IO.Compression.ZipFile]::Open($XlsxPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $overrides = @(
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
  )
  $sheetRels = @()
  $sheetNodes = @()

  for ($i = 0; $i -lt $sheetDefs.Count; $i++) {
    $index = $i + 1
    Add-Entry $zip "xl/worksheets/sheet$index.xml" (New-SheetXml $sheetDefs[$i].Rows)
    $overrides += "<Override PartName=""/xl/worksheets/sheet$index.xml"" ContentType=""application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml""/>"
    $sheetRels += "<Relationship Id=""rId$index"" Type=""http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"" Target=""worksheets/sheet$index.xml""/>"
    $sheetNodes += "<sheet name=""$(Escape-Xml $sheetDefs[$i].Name)"" sheetId=""$index"" r:id=""rId$index""/>"
  }

  Add-Entry $zip "[Content_Types].xml" "<?xml version=""1.0"" encoding=""UTF-8"" standalone=""yes""?><Types xmlns=""http://schemas.openxmlformats.org/package/2006/content-types""><Default Extension=""rels"" ContentType=""application/vnd.openxmlformats-package.relationships+xml""/><Default Extension=""xml"" ContentType=""application/xml""/>$($overrides -join '')</Types>"
  Add-Entry $zip "_rels/.rels" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  Add-Entry $zip "xl/workbook.xml" "<?xml version=""1.0"" encoding=""UTF-8"" standalone=""yes""?><workbook xmlns=""http://schemas.openxmlformats.org/spreadsheetml/2006/main"" xmlns:r=""http://schemas.openxmlformats.org/officeDocument/2006/relationships""><sheets>$($sheetNodes -join '')</sheets></workbook>"
  Add-Entry $zip "xl/_rels/workbook.xml.rels" "<?xml version=""1.0"" encoding=""UTF-8"" standalone=""yes""?><Relationships xmlns=""http://schemas.openxmlformats.org/package/2006/relationships"">$($sheetRels -join '')<Relationship Id=""rId$($sheetDefs.Count + 1)"" Type=""http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"" Target=""styles.xml""/></Relationships>"
  Add-Entry $zip "xl/styles.xml" '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
}
finally {
  $zip.Dispose()
}

Write-Output $XlsxPath
