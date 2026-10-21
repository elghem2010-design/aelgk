<#
.SYNOPSIS
    ElajX (علاجك) — Safe Isolated PostgreSQL Staging Validation Runner for Windows.
.DESCRIPTION
    Executes Phase 5.2B staging validation strictly on a LOCAL DISPOSABLE PostgreSQL 15+ engine.
    Ensures safe, non-destructive test execution:
      - Validates that target host is strictly loopback (localhost/127.0.0.1/::1), port is valid, and username is valid.
      - Uses deterministic repository-root path resolution and verifies all required SQL files exist before creating any database.
      - Enforces that the PostgreSQL server version is 15+ via machine-readable 'SHOW server_version_num' check.
      - Uses collision-resistant disposable database names with timestamp + random nonce.
      - Deterministically verifies database names do NOT exist via 'psql -t -A' integer parsing.
      - Collisions or ambiguous responses trigger an immediate fatal safety abort without retrying or reusing databases.
      - Automatic deletion is completely disabled; all created databases and logs are preserved for operator inspection.
      - Proves legacy data preservation via deterministic record identity-set and unambiguous JSONB full-row comparisons before and after migration.
      - Prevents stdout/stderr pipe deadlocks using asynchronous reads (Task.WaitAll) compatible with Windows PowerShell 5.1.
      - Checks every native psql.exe invocation exit code and halts immediately on error.
      - Never loads .env / .env.local, prints connection strings, or exposes passwords.
.PARAMETER Hostname
    PostgreSQL server host. Must strictly be 'localhost', '127.0.0.1', or '::1'. Defaults to 'localhost'.
.PARAMETER Port
    PostgreSQL server port (1-65535). Defaults to 5432.
.PARAMETER Username
    PostgreSQL administrative user for creating disposable test databases. Defaults to 'postgres'.
#>

[CmdletBinding()]
param(
    [string]$Hostname = "localhost",
    [int]$Port = 5432,
    [string]$Username = "postgres"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ==============================================================================
# 1. Critical Host, Parameter & Safety Validation
# ==============================================================================
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  ElajX (علاجك) — Isolated Staging Validation Runner (Windows)  " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

# Safety Rule 1: Strictly reject non-loopback targets
if ($Hostname -notin @("localhost", "127.0.0.1", "::1")) {
    Write-Error "[SECURITY VIOLATION] Target host '$Hostname' is not a local loopback address. Remote targets are strictly forbidden."
    exit 2
}

# Safety Rule 2: Validate Port Range
if ($Port -lt 1 -or $Port -gt 65535) {
    Write-Error "[PARAMETER ERROR] Port $Port is invalid. Port must be an integer between 1 and 65535."
    exit 2
}

# Safety Rule 3: Validate Username Format
if ($Username -notmatch '^[a-zA-Z0-9_]{1,63}$') {
    Write-Error "[PARAMETER ERROR] Username '$Username' contains invalid characters. Must be alphanumeric/underscore."
    exit 2
}

# Safety Rule 4: Refuse to load any .env files
if (Test-Path ".env") {
    Write-Host "[SAFETY] Local .env detected in directory; strictly IGNORING it to prevent secret leakage." -ForegroundColor Yellow
}
if (Test-Path ".env.local") {
    Write-Host "[SAFETY] Local .env.local detected in directory; strictly IGNORING it to prevent secret leakage." -ForegroundColor Yellow
}

# Mandatory Operator Safety Warning
Write-Host "`n[CRITICAL OPERATOR SAFETY NOTICE]" -ForegroundColor Yellow
Write-Host "This runner operates strictly against a local DISPOSABLE PostgreSQL instance." -ForegroundColor Yellow
Write-Host "The operator MUST verify that the target local PostgreSQL instance at ${Hostname}:$Port" -ForegroundColor Yellow
Write-Host "contains NO valuable, staging, or production data before proceeding.`n" -ForegroundColor Yellow

# ==============================================================================
# 2. Deterministic Repository Root & File Existence Verification
# ==============================================================================
try {
    $scriptParent = Split-Path -Parent $PSScriptRoot
    $repoRoot = (Resolve-Path (Join-Path $scriptParent "..")).Path
} catch {
    Write-Error "[INIT ERROR] Failed to resolve repository root from script directory '$PSScriptRoot'."
    exit 3
}

$prereqFile = Join-Path $repoRoot "supabase\staging\00_setup_prerequisites.sql"
$legacyFixtureFile = Join-Path $repoRoot "supabase\staging\01_legacy_baseline_fixture.sql"
$candidateMigrationFile = Join-Path $repoRoot "supabase\migrations\20261021000001_reconcile_existing_schema.sql"
$assertionSuiteFile = Join-Path $repoRoot "supabase\staging\02_runtime_assertion_suite.sql"

$requiredSqlFiles = @(
    @{ Path = $prereqFile; Name = "00_setup_prerequisites.sql" },
    @{ Path = $legacyFixtureFile; Name = "01_legacy_baseline_fixture.sql" },
    @{ Path = $candidateMigrationFile; Name = "20261021000001_reconcile_existing_schema.sql" },
    @{ Path = $assertionSuiteFile; Name = "02_runtime_assertion_suite.sql" }
)

foreach ($item in $requiredSqlFiles) {
    if (-not (Test-Path -LiteralPath $item.Path)) {
        Write-Error "[PRE-CHECK FAILED] Required SQL file '$($item.Name)' not found at '$($item.Path)'. Aborting before database creation."
        exit 3
    }
}

Write-Host "[INIT] Repository root verified: $repoRoot" -ForegroundColor Gray
Write-Host "[INIT] All 4 required staging and migration SQL files verified on disk." -ForegroundColor Gray

# Locate psql.exe binary
$psqlCmd = Get-Command psql.exe -ErrorAction SilentlyContinue
$psqlPath = if ($psqlCmd) { $psqlCmd.Source } else { $null }
if (-not $psqlPath) {
    $commonPaths = @(
        "C:\Program Files\PostgreSQL\15\bin\psql.exe",
        "C:\Program Files\PostgreSQL\16\bin\psql.exe",
        "C:\Program Files\PostgreSQL\17\bin\psql.exe"
    )
    foreach ($cand in $commonPaths) {
        if (Test-Path $cand) {
            $psqlPath = $cand
            break
        }
    }
}

if (-not $psqlPath) {
    Write-Error "[ERROR] psql.exe could not be located in PATH or standard PostgreSQL installation paths."
    exit 3
}

Write-Host "[INIT] Using psql binary: $psqlPath" -ForegroundColor Gray
Write-Host "[INIT] Target host: ${Hostname}:$Port (User: $Username)" -ForegroundColor Gray

# Create logs directory
$logDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$sessionTimestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmss")
$sessionNonce = [System.IO.Path]::GetRandomFileName().Substring(0, 6)

# Array to track ONLY databases successfully created by this specific session
$script:createdDatabases = [System.Collections.Generic.List[string]]::new()

# ==============================================================================
# 3. Reliable Command Execution Helpers (Deadlock-Free Asynchronous I/O)
# ==============================================================================
function Invoke-PsqlOperation {
    param(
        [Parameter(Mandatory=$true)][string]$Database,
        [Parameter(Mandatory=$false)][string]$Query,
        [Parameter(Mandatory=$false)][string]$FilePath,
        [Parameter(Mandatory=$true)][string]$StageName,
        [Parameter(Mandatory=$true)][string]$LogFile
    )

    $logHeader = "`n--- [STAGE: $StageName] [$(Get-Date -Format 'u')] Database: $Database ---`n"
    Add-Content -Path $LogFile -Value $logHeader

    $baseArgs = @(
        "-h", $Hostname,
        "-p", $Port.ToString(),
        "-U", $Username,
        "-d", $Database,
        "-v", "ON_ERROR_STOP=1",
        "-X" # Do not read ~/.psqlrc
    )

    if ($FilePath) {
        if (-not (Test-Path -LiteralPath $FilePath)) {
            throw "[ERROR] Target SQL file '$FilePath' not found on disk."
        }
        $cmdArgs = $baseArgs + @("-f", $FilePath)
    } elseif ($Query) {
        $cmdArgs = $baseArgs + @("-c", $Query)
    } else {
        throw "[ERROR] Neither FilePath nor Query specified for Invoke-PsqlOperation."
    }

    Write-Host "  -> Executing: $StageName..." -NoNewline

    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = $psqlPath
    $processInfo.Arguments = ($cmdArgs | ForEach-Object {
        if ($_ -match '\s') { "`"$_`"" } else { $_ }
    }) -join ' '
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::Start($processInfo)

    # Deadlock prevention: start asynchronous reads of stdout and stderr concurrently
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()

    $proc.WaitForExit()
    [System.Threading.Tasks.Task]::WaitAll(@($stdoutTask, $stderrTask))

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $proc.ExitCode

    if ($stdout) { Add-Content -Path $LogFile -Value $stdout }
    if ($stderr) { Add-Content -Path $LogFile -Value "[STDERR]`n$stderr" }

    if ($exitCode -ne 0) {
        Write-Host " [FAILED (ExitCode: $exitCode)]" -ForegroundColor Red
        Write-Host "`n[FATAL ERROR in Stage '$StageName']" -ForegroundColor Red
        if ($stderr) {
            Write-Host $stderr -ForegroundColor DarkRed
        }
        throw "Stage '$StageName' failed with exit code $exitCode. Full output preserved in $LogFile"
    }

    Write-Host " [OK]" -ForegroundColor Green
    return $stdout
}

function Invoke-PsqlScalar {
    param(
        [Parameter(Mandatory=$true)][string]$Database,
        [Parameter(Mandatory=$true)][string]$Query,
        [Parameter(Mandatory=$true)][string]$StageName,
        [Parameter(Mandatory=$true)][string]$LogFile
    )

    $cmdArgs = @(
        "-h", $Hostname,
        "-p", $Port.ToString(),
        "-U", $Username,
        "-d", $Database,
        "-t", "-A", # Unadorned tuple-only, unaligned output
        "-v", "ON_ERROR_STOP=1",
        "-X",
        "-c", $Query
    )

    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = $psqlPath
    $processInfo.Arguments = ($cmdArgs | ForEach-Object {
        if ($_ -match '\s') { "`"$_`"" } else { $_ }
    }) -join ' '
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::Start($processInfo)

    # Deadlock prevention: start asynchronous reads concurrently
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()

    $proc.WaitForExit()
    [System.Threading.Tasks.Task]::WaitAll(@($stdoutTask, $stderrTask))

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $proc.ExitCode

    if ($stdout) { Add-Content -Path $LogFile -Value "`n[SCALAR OUTPUT: $StageName]`n$stdout" }
    if ($stderr) { Add-Content -Path $LogFile -Value "`n[SCALAR STDERR: $StageName]`n$stderr" }

    if ($exitCode -ne 0) {
        throw "Scalar query in '$StageName' failed with exit code $exitCode. Error: $stderr"
    }

    return $stdout.Trim()
}

function Invoke-PsqlJsonRows {
    param(
        [Parameter(Mandatory=$true)][string]$Database,
        [Parameter(Mandatory=$true)][string]$Query,
        [Parameter(Mandatory=$true)][string]$StageName,
        [Parameter(Mandatory=$true)][string]$LogFile,
        [Parameter(Mandatory=$false)][bool]$AllowEmpty = $false
    )

    $logHeader = "`n--- [STAGE: $StageName] [$(Get-Date -Format 'u')] Database: $Database (Multi-Row JSON Query) ---`n"
    Add-Content -Path $LogFile -Value $logHeader

    $cmdArgs = @(
        "-h", $Hostname,
        "-p", $Port.ToString(),
        "-U", $Username,
        "-d", $Database,
        "-t", "-A", # Unadorned tuple-only, unaligned output
        "-v", "ON_ERROR_STOP=1",
        "-X",
        "-c", $Query
    )

    Write-Host "  -> Executing multi-row query: $StageName..." -NoNewline

    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = $psqlPath
    $processInfo.Arguments = ($cmdArgs | ForEach-Object {
        if ($_ -match '\s') { "`"$_`"" } else { $_ }
    }) -join ' '
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::Start($processInfo)

    # Deadlock prevention: start asynchronous reads concurrently
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()

    $proc.WaitForExit()
    [System.Threading.Tasks.Task]::WaitAll(@($stdoutTask, $stderrTask))

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $proc.ExitCode

    if ($stderr) {
        Add-Content -Path $LogFile -Value "[STDERR: $StageName]`n$stderr"
    }

    if ($exitCode -ne 0) {
        Write-Host " [FAILED (ExitCode: $exitCode)]" -ForegroundColor Red
        throw "[FATAL ERROR] Query in stage '$StageName' failed with exit code $exitCode. Error: $stderr"
    }

    # Parse multi-row JSON output into a Hashtable (id -> canonical_json)
    $recordMap = @{}

    if ([string]::IsNullOrWhiteSpace($stdout)) {
        if (-not $AllowEmpty) {
            Write-Host " [FAILED (Empty Result)]" -ForegroundColor Red
            throw "[VALIDATION ERROR] Stage '$StageName' returned an empty result set, but table was expected to contain records."
        }
        Add-Content -Path $LogFile -Value "[INFO: $StageName] Query completed. Returned 0 records (empty table allowed)."
        Write-Host " [OK: 0 records]" -ForegroundColor Green
        return $recordMap
    }

    # Only strip the final stream-terminating newline
    $trimmedStdout = $stdout.TrimEnd("`r", "`n")
    $lines = $trimmedStdout -split "`r?`n"

    $lineIndex = 0
    foreach ($line in $lines) {
        $lineIndex++
        if ([string]::IsNullOrWhiteSpace($line)) {
            Write-Host " [FAILED (Blank Line)]" -ForegroundColor Red
            throw "[VALIDATION ERROR] Blank or whitespace record line detected at line $lineIndex in stage '$StageName'."
        }

        $parsed = $null
        try {
            $parsed = $line | ConvertFrom-Json
        } catch {
            Write-Host " [FAILED (Malformed JSON)]" -ForegroundColor Red
            throw "[VALIDATION ERROR] Malformed JSON record at line $lineIndex in stage '$StageName': $_"
        }

        if ($null -eq $parsed) {
            throw "[VALIDATION ERROR] Parsed JSON returned null at line $lineIndex in stage '$StageName'."
        }

        if ($null -eq $parsed.id) {
            throw "[VALIDATION ERROR] Missing 'id' property in JSON record at line $lineIndex in stage '$StageName'."
        }

        $id = [string]$parsed.id
        if ($id -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
            throw "[VALIDATION ERROR] Identity '$id' at line $lineIndex in stage '$StageName' does not match UUID format."
        }

        $normId = $id.ToLowerInvariant()
        if ($recordMap.ContainsKey($normId)) {
            throw "[VALIDATION ERROR] Duplicate identity '$normId' encountered at line $lineIndex in stage '$StageName'."
        }

        if ($null -eq $parsed.canonical_json) {
            throw "[VALIDATION ERROR] Missing 'canonical_json' property in JSON record at line $lineIndex in stage '$StageName'."
        }

        $canonicalStr = [string]$parsed.canonical_json
        if ([string]::IsNullOrWhiteSpace($canonicalStr)) {
            throw "[VALIDATION ERROR] Empty 'canonical_json' payload for ID '$normId' at line $lineIndex in stage '$StageName'."
        }

        # Verify that canonical_json itself is strictly valid JSON
        try {
            $null = $canonicalStr | ConvertFrom-Json
        } catch {
            throw "[VALIDATION ERROR] Malformed canonical_json payload for ID '$normId' at line $lineIndex in stage '$StageName': $_"
        }

        $recordMap[$normId] = $canonicalStr
    }

    # Data separation rule: do NOT write entire table records to log files
    Add-Content -Path $LogFile -Value "[INFO: $StageName] Query completed successfully. Retrieved $($recordMap.Count) records."
    Write-Host " [OK: $($recordMap.Count) records]" -ForegroundColor Green

    return $recordMap
}

function Assert-RecordPreservation {
    param(
        [Parameter(Mandatory=$true)][string]$TableName,
        [Parameter(Mandatory=$true)][hashtable]$PreMigrationMap,
        [Parameter(Mandatory=$true)][hashtable]$PostMigrationMap
    )

    Write-Host "  -> Verifying exact identity-set and full-row content preservation for $TableName..." -NoNewline

    # 1. Non-empty baseline assertion
    if ($PreMigrationMap.Count -eq 0) {
        throw "[INVARIANT VIOLATION] Baseline pre-migration record set for '$TableName' is unexpectedly empty."
    }

    # 2. Total record count preservation
    if ($PostMigrationMap.Count -ne $PreMigrationMap.Count) {
        throw "[INVARIANT VIOLATION] Record count mismatch in '$TableName': pre-migration had $($PreMigrationMap.Count), post-migration has $($PostMigrationMap.Count)."
    }

    # 3. Identity-set preservation and full-row representation comparison
    foreach ($id in $PreMigrationMap.Keys) {
        if (-not $PostMigrationMap.ContainsKey($id)) {
            throw "[INVARIANT VIOLATION] Identity loss in '$TableName'! Pre-existing record ID '$id' is missing after migration."
        }
        $preCanonical = $PreMigrationMap[$id]
        $postCanonical = $PostMigrationMap[$id]
        if (-not [string]::Equals($preCanonical, $postCanonical, [System.StringComparison]::Ordinal)) {
            # Parse both JSON representations to pinpoint the exact differing columns
            $preObj = $preCanonical | ConvertFrom-Json
            $postObj = $postCanonical | ConvertFrom-Json
            $diffList = [System.Collections.Generic.List[string]]::new()
            foreach ($prop in $preObj.psobject.Properties) {
                $colName = $prop.Name
                $vPre = $prop.Value
                $vPost = $postObj.$colName
                $sPre = if ($null -eq $vPre) { "<null>" } else { [string]$vPre }
                $sPost = if ($null -eq $vPost) { "<null>" } else { [string]$vPost }
                if (-not [string]::Equals($sPre, $sPost, [System.StringComparison]::Ordinal)) {
                    $diffList.Add("${colName}: pre='$sPre', post='$sPost'")
                }
            }
            $diffSummary = if ($diffList.Count -gt 0) { $diffList -join "; " } else { "Binary representation difference" }
            throw "[INVARIANT VIOLATION] Full-row content corruption in '$TableName' for ID '$id'! Column diffs: $diffSummary"
        }
    }

    # 4. Spurious/unaccounted record check
    foreach ($id in $PostMigrationMap.Keys) {
        if (-not $PreMigrationMap.ContainsKey($id)) {
            throw "[INVARIANT VIOLATION] Spurious record detected in '$TableName'! ID '$id' was not present in the pre-migration baseline."
        }
    }

    Write-Host " [OK: $($PreMigrationMap.Count) records verified identical]" -ForegroundColor Green
}

# ==============================================================================
# 4. Connectivity & Machine-Readable Server Version Verification
# ==============================================================================
$initLog = Join-Path $logDir "staging_init_${sessionTimestamp}.log"
Write-Host "`n>>> [STEP 0] Verifying Local PostgreSQL Connectivity & Engine Version..." -ForegroundColor Yellow

try {
    # Check machine-readable integer version num (e.g. 150002 for 15.2, 160001 for 16.1)
    $rawVersionNum = Invoke-PsqlScalar -Database "postgres" -Query "SHOW server_version_num;" `
        -StageName "Verify-ServerVersionNum" -LogFile $initLog

    $versionNum = 0
    $isVersionInt = [int]::TryParse($rawVersionNum, [ref]$versionNum)

    if (-not $isVersionInt) {
        Write-Error "[SAFETY ABORT] Unexpected non-integer response from 'SHOW server_version_num;': '$rawVersionNum'. Aborting before database creation."
        exit 4
    }

    # Minimum required: PostgreSQL 15.0 (version num 150000)
    if ($versionNum -lt 150000) {
        Write-Error "[VERSION ERROR] Local PostgreSQL server version num ($versionNum) is older than PostgreSQL 15 (150000 required). Aborting before database creation."
        exit 4
    }

    $rawVersionStr = Invoke-PsqlScalar -Database "postgres" -Query "SHOW server_version;" `
        -StageName "Verify-ServerVersionStr" -LogFile $initLog

    Write-Host "  ✓ Local PostgreSQL connection verified: version $rawVersionStr (server_version_num: $versionNum >= 150000)." -ForegroundColor Green
} catch {
    Write-Error "[PRE-CHECK FAILED] Could not connect to local PostgreSQL at ${Hostname}:$Port as user $Username. Error: $_"
    exit 4
}

# Deterministic database uniqueness check using machine-readable integer parsing
function Assert-DatabaseDoesNotExist {
    param([string]$DbName)
    $checkSql = "SELECT count(*) FROM pg_database WHERE datname = '$DbName';"
    $rawResult = Invoke-PsqlScalar -Database "postgres" -Query $checkSql `
        -StageName "Check-Db-Uniqueness-$DbName" -LogFile $initLog

    $count = 0
    $isInteger = [int]::TryParse($rawResult, [ref]$count)

    if (-not $isInteger) {
        throw "[SAFETY ABORT] Expected integer scalar from pg_database query for '$DbName', got: '$rawResult'. Aborting immediately without modifying databases."
    }

    if ($count -ne 0) {
        throw "[SAFETY ABORT] Database '$DbName' already exists in PostgreSQL (count=$count)! Will NOT overwrite, modify, or drop existing database."
    }
}

function Create-DisposableDatabase {
    param([string]$DbName)
    Assert-DatabaseDoesNotExist -DbName $DbName

    # AMBIGUOUS CREATION & CLIENT DISCONNECTION SAFEGUARD:
    # If the CREATE DATABASE command raises an error or times out on the client,
    # the PostgreSQL server may have already committed the database creation in the background.
    # IN STRICT ADHERENCE TO NON-DESTRUCTIVE SAFETY DIRECTIVES:
    # The runner will NEVER attempt to DROP, reuse, overwrite, or automatically retry creating this database.
    # Execution halts immediately, preserving whatever state exists on the server for operator review.
    try {
        $createSql = "CREATE DATABASE $DbName;"
        Invoke-PsqlOperation -Database "postgres" -Query $createSql `
            -StageName "Create-Disposable-Database-$DbName" -LogFile $initLog | Out-Null
    } catch {
        throw "[FATAL CREATION ERROR] Error or client disconnection during 'CREATE DATABASE $DbName;'. Server state may be partially created or committed. As a strict safety invariant, the runner will NOT drop, reuse, or retry creating this database. Manual operator inspection is required: $_"
    }

    # Record in session registry
    $script:createdDatabases.Add($DbName)
    Write-Host "  ✓ Disposable database '$DbName' created and recorded in session registry." -ForegroundColor Green
}

# ==============================================================================
# 5. Scenario A: Fresh-Schema Validation
# ==============================================================================
$dbFresh = "elajx_disp_fresh_${sessionTimestamp}_${sessionNonce}"
$logFresh = Join-Path $logDir "staging_fresh_${sessionTimestamp}.log"

Write-Host "`n>>> [SCENARIO A] Fresh Schema Validation Starting..." -ForegroundColor Yellow
Write-Host "    Target Disposable DB: $dbFresh" -ForegroundColor Gray
Write-Host "    Log Destination: $logFresh" -ForegroundColor Gray

try {
    Create-DisposableDatabase -DbName $dbFresh

    Invoke-PsqlOperation -Database $dbFresh -FilePath $prereqFile `
        -StageName "ScenarioA-00-Prerequisites" -LogFile $logFresh

    Invoke-PsqlOperation -Database $dbFresh -FilePath $candidateMigrationFile `
        -StageName "ScenarioA-01-CandidateMigration" -LogFile $logFresh

    Invoke-PsqlOperation -Database $dbFresh -FilePath $assertionSuiteFile `
        -StageName "ScenarioA-02-RuntimeAssertions" -LogFile $logFresh

    Write-Host "✓ [SCENARIO A PASSED] Fresh schema compilation, migration, and runtime assertions succeeded." -ForegroundColor Green
} catch {
    Write-Error "[SCENARIO A FAILED] Halting runner. Inspect $logFresh for exact database error."
    exit 5
}

# ==============================================================================
# 6. Scenario B: Legacy Schema Reconciliation Validation
# ==============================================================================
$dbLegacy = "elajx_disp_legacy_${sessionTimestamp}_${sessionNonce}"
$logLegacy = Join-Path $logDir "staging_legacy_${sessionTimestamp}.log"

Write-Host "`n>>> [SCENARIO B] Legacy Schema Reconciliation Starting..." -ForegroundColor Yellow
Write-Host "    Target Disposable DB: $dbLegacy" -ForegroundColor Gray
Write-Host "    Log Destination: $logLegacy" -ForegroundColor Gray

try {
    Create-DisposableDatabase -DbName $dbLegacy

    Invoke-PsqlOperation -Database $dbLegacy -FilePath $prereqFile `
        -StageName "ScenarioB-00-Prerequisites" -LogFile $logLegacy

    Invoke-PsqlOperation -Database $dbLegacy -FilePath $legacyFixtureFile `
        -StageName "ScenarioB-01-LegacyBaselineFixture" -LogFile $logLegacy

    # 1. Capture exact pre-migration baseline scalar counts and unambiguous full-row JSON representations
    $rawPreMed = Invoke-PsqlScalar -Database $dbLegacy `
        -Query "SELECT count(*) FROM public.medicines;" `
        -StageName "ScenarioB-PreMigration-MedicinesCount" -LogFile $logLegacy
    $rawPreStock = Invoke-PsqlScalar -Database $dbLegacy `
        -Query "SELECT count(*) FROM public.pharmacies_stock;" `
        -StageName "ScenarioB-PreMigration-StockCount" -LogFile $logLegacy

    $preMedicinesCount = 0
    $preStockCount = 0
    if (-not [int]::TryParse($rawPreMed, [ref]$preMedicinesCount) -or -not [int]::TryParse($rawPreStock, [ref]$preStockCount)) {
        throw "[VALIDATION ERROR] Non-integer response for pre-migration baseline counts: medicines='$rawPreMed', stock='$rawPreStock'."
    }

    # Prove candidate columns (name_ar, name_en, prescription_required) are absent from baseline public.medicines
    $rawPreColsCheck = Invoke-PsqlScalar -Database $dbLegacy `
        -Query "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'medicines' AND column_name IN ('name_ar', 'name_en', 'prescription_required');" `
        -StageName "ScenarioB-PreMigration-CandidateColumnsAbsenceCheck" -LogFile $logLegacy
    $preColsCount = 0
    if (-not [int]::TryParse($rawPreColsCheck, [ref]$preColsCount) -or $preColsCount -ne 0) {
        throw "[INVARIANT VIOLATION] Baseline public.medicines already contains candidate columns! Expected 0, got '$rawPreColsCheck'."
    }

    # Unambiguous JSON queries for legacy tables:
    # 1. public.medicines: baseline fixture defines 8 columns:
    #    (id, name, active_ingredient, dosage_form, strength, manufacturer, alternative_price, created_at).
    #    Candidate migration explicitly adds 3 new columns:
    #    - Line 394: ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS name_ar TEXT;
    #    - Line 395: ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS name_en TEXT;
    #    - Line 401: ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS prescription_required BOOLEAN DEFAULT NULL;
    #    We extract (to_jsonb(m) - '{name_ar, name_en, prescription_required}'::text[]) which captures 100% of the
    #    baseline columns, with zero ambiguity between NULL and empty strings, ordered deterministically by primary key 'id'.
    $medJsonQuery = "SELECT json_build_object('id', m.id, 'canonical_json', (to_jsonb(m) - '{name_ar, name_en, prescription_required}'::text[])::text)::text FROM public.medicines m ORDER BY m.id;"
    $preMedRecords = Invoke-PsqlJsonRows -Database $dbLegacy -Query $medJsonQuery `
        -StageName "ScenarioB-PreMigration-MedicinesRecords" -LogFile $logLegacy

    # 2. public.pharmacies_stock: baseline fixture defines 6 columns:
    #    (id, pharmacy_id, medicine_id, in_stock, unit_price, created_at).
    #    Candidate migration performs no ALTER TABLE ADD COLUMN on this table.
    #    We serialize 100% of to_jsonb(s) with zero exclusions, ordered deterministically by primary key 'id'.
    $stockJsonQuery = "SELECT json_build_object('id', s.id, 'canonical_json', (to_jsonb(s))::text)::text FROM public.pharmacies_stock s ORDER BY s.id;"
    $preStockRecords = Invoke-PsqlJsonRows -Database $dbLegacy -Query $stockJsonQuery `
        -StageName "ScenarioB-PreMigration-StockRecords" -LogFile $logLegacy

    if ($preMedRecords.Count -ne $preMedicinesCount) {
        throw "[VALIDATION ERROR] Pre-migration medicines record count ($($preMedRecords.Count)) does not match scalar count ($preMedicinesCount)."
    }
    if ($preStockRecords.Count -ne $preStockCount) {
        throw "[VALIDATION ERROR] Pre-migration stock record count ($($preStockRecords.Count)) does not match scalar count ($preStockCount)."
    }

    # 2. Execute candidate migration over legacy baseline
    Invoke-PsqlOperation -Database $dbLegacy -FilePath $candidateMigrationFile `
        -StageName "ScenarioB-02-CandidateMigration" -LogFile $logLegacy

    # 3. Capture post-migration scalar counts and unambiguous full-row JSON representations
    $rawPostMed = Invoke-PsqlScalar -Database $dbLegacy `
        -Query "SELECT count(*) FROM public.medicines;" `
        -StageName "ScenarioB-PostMigration-MedicinesCount" -LogFile $logLegacy
    $rawPostStock = Invoke-PsqlScalar -Database $dbLegacy `
        -Query "SELECT count(*) FROM public.pharmacies_stock;" `
        -StageName "ScenarioB-PostMigration-StockCount" -LogFile $logLegacy
    $rawCatalogSeeded = Invoke-PsqlScalar -Database $dbLegacy `
        -Query "SELECT count(*) FROM public.medicine_catalog WHERE source_table = 'legacy_medicines';" `
        -StageName "ScenarioB-PostMigration-CatalogCount" -LogFile $logLegacy
    $rawUnmappedMed = Invoke-PsqlScalar -Database $dbLegacy `
        -Query "SELECT count(*) FROM public.medicines m WHERE NOT EXISTS (SELECT 1 FROM public.medicine_catalog c WHERE c.id = m.id AND c.source_table = 'legacy_medicines');" `
        -StageName "ScenarioB-PostMigration-UnmappedMedicines" -LogFile $logLegacy

    $postMedicinesCount = 0
    $postStockCount = 0
    $catalogSeededCount = 0
    $unmappedCount = 0

    if (-not [int]::TryParse($rawPostMed, [ref]$postMedicinesCount) -or
        -not [int]::TryParse($rawPostStock, [ref]$postStockCount) -or
        -not [int]::TryParse($rawCatalogSeeded, [ref]$catalogSeededCount) -or
        -not [int]::TryParse($rawUnmappedMed, [ref]$unmappedCount)) {
        throw "[VALIDATION ERROR] Non-integer response for post-migration counts: medicines='$rawPostMed', stock='$rawPostStock', catalog='$rawCatalogSeeded', unmapped='$rawUnmappedMed'."
    }

    $postMedRecords = Invoke-PsqlJsonRows -Database $dbLegacy -Query $medJsonQuery `
        -StageName "ScenarioB-PostMigration-MedicinesRecords" -LogFile $logLegacy

    $postStockRecords = Invoke-PsqlJsonRows -Database $dbLegacy -Query $stockJsonQuery `
        -StageName "ScenarioB-PostMigration-StockRecords" -LogFile $logLegacy

    # 4. Enforce strict legacy data-preservation and catalog reconciliation invariants:
    #    a) Prove exact identity-set and full-row content preservation for public.medicines
    Assert-RecordPreservation -TableName "public.medicines" `
        -PreMigrationMap $preMedRecords -PostMigrationMap $postMedRecords

    #    b) Verify candidate columns were added to public.medicines schema
    $rawPostColsCheck = Invoke-PsqlScalar -Database $dbLegacy `
        -Query "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'medicines' AND column_name IN ('name_ar', 'name_en', 'prescription_required');" `
        -StageName "ScenarioB-PostMigration-CandidateColumnsPresenceCheck" -LogFile $logLegacy
    $postColsCount = 0
    if (-not [int]::TryParse($rawPostColsCheck, [ref]$postColsCount) -or $postColsCount -ne 3) {
        throw "[INVARIANT VIOLATION] Candidate columns missing from public.medicines after migration! Expected 3, got '$rawPostColsCheck'."
    }

    #    c) Prove that all newly added columns on legacy public.medicines rows remain strictly NULL (no fabricated data)
    $rawNewColsCheck = Invoke-PsqlScalar -Database $dbLegacy `
        -Query "SELECT count(*) FROM public.medicines WHERE name_ar IS NOT NULL OR name_en IS NOT NULL OR prescription_required IS NOT NULL;" `
        -StageName "ScenarioB-PostMigration-NewColumnsNullCheck" -LogFile $logLegacy
    $newColsPopulatedCount = 0
    if (-not [int]::TryParse($rawNewColsCheck, [ref]$newColsPopulatedCount) -or $newColsPopulatedCount -ne 0) {
        throw "[INVARIANT VIOLATION] Expected 0 legacy medicine records with non-null newly-added columns, got '$rawNewColsCheck'."
    }

    #    d) Prove exact identity-set and full-row content preservation for public.pharmacies_stock
    Assert-RecordPreservation -TableName "public.pharmacies_stock" `
        -PreMigrationMap $preStockRecords -PostMigrationMap $postStockRecords

    #    e) Supplementary scalar count assertions:
    if ($postMedicinesCount -ne $preMedicinesCount) {
        throw "[INVARIANT VIOLATION] Row count mismatch in public.medicines: expected $preMedicinesCount, got $postMedicinesCount."
    }
    if ($postStockCount -ne $preStockCount) {
        throw "[INVARIANT VIOLATION] Row count mismatch in public.pharmacies_stock: expected $preStockCount, got $postStockCount."
    }

    #    f) Verify catalog bridging invariants:
    #       - Every legacy medicine bridged into public.medicine_catalog (source_table='legacy_medicines')
    if ($catalogSeededCount -ne $preMedicinesCount) {
        throw "[INVARIANT VIOLATION] Bridged catalog count mismatch: expected $preMedicinesCount records, got $catalogSeededCount."
    }
    #       - Zero unmapped legacy medicine IDs
    if ($unmappedCount -ne 0) {
        throw "[INVARIANT VIOLATION] Detected $unmappedCount legacy medicines not bridged into public.medicine_catalog."
    }

    #       - Exact ID mapping verification: bi-directional mapping between legacy medicines and bridged catalog
    #       Query bridged catalog records using Invoke-PsqlJsonRows (guarantees strict UUID validation, duplicate detection, and zero skipped blank lines)
    $catalogJsonQuery = "SELECT json_build_object('id', c.id, 'canonical_json', json_build_object('id', c.id)::text)::text FROM public.medicine_catalog c WHERE c.source_table = 'legacy_medicines' ORDER BY c.id;"
    $catalogRecords = Invoke-PsqlJsonRows -Database $dbLegacy -Query $catalogJsonQuery `
        -StageName "ScenarioB-PostMigration-CatalogRecords" -LogFile $logLegacy

    # Bi-directional set equality:
    # 1. Every pre-migration legacy medicine ID must exist in the bridged catalog
    foreach ($legacyId in $preMedRecords.Keys) {
        if (-not $catalogRecords.ContainsKey($legacyId)) {
            throw "[INVARIANT VIOLATION] Legacy medicine ID '$legacyId' is missing from bridged public.medicine_catalog!"
        }
    }
    # 2. Every bridged catalog record (source_table='legacy_medicines') must correspond to a pre-migration legacy medicine ID
    foreach ($catId in $catalogRecords.Keys) {
        if (-not $preMedRecords.ContainsKey($catId)) {
            throw "[INVARIANT VIOLATION] Bridged catalog record '$catId' does not correspond to any pre-migration legacy medicine!"
        }
    }

    Write-Host "  -> Diagnostic check: public.medicines records (count=$postMedicinesCount, 100% full-row representations preserved)." -ForegroundColor Gray
    Write-Host "  -> Diagnostic check: public.pharmacies_stock records (count=$postStockCount, 100% full-row representations preserved)." -ForegroundColor Gray
    Write-Host "  -> Diagnostic check: bridged catalog records=$catalogSeededCount (100% legacy IDs confirmed in catalog, unmapped=$unmappedCount)." -ForegroundColor Gray

    Invoke-PsqlOperation -Database $dbLegacy -FilePath $assertionSuiteFile `
        -StageName "ScenarioB-03-RuntimeAssertions" -LogFile $logLegacy

    Write-Host "✓ [SCENARIO B PASSED] Exact baseline identity and column-value representation checks passed, migration reconciliation invariants matched, and assertions succeeded." -ForegroundColor Green
} catch {
    Write-Error "[SCENARIO B FAILED] Halting runner. Inspect $logLegacy for exact database error."
    exit 6
}

# ==============================================================================
# 7. Scenario C: Migration Repeat-Execution Validation
# ==============================================================================
$logIdempotency = Join-Path $logDir "staging_idempotency_${sessionTimestamp}.log"

Write-Host "`n>>> [SCENARIO C] Migration Repeat-Execution Test Starting..." -ForegroundColor Yellow
Write-Host "    Target Database: $dbLegacy (2nd Execution)" -ForegroundColor Gray
Write-Host "    Log Destination: $logIdempotency" -ForegroundColor Gray

try {
    # Re-run candidate migration a 2nd time on the legacy database
    Invoke-PsqlOperation -Database $dbLegacy -FilePath $candidateMigrationFile `
        -StageName "ScenarioC-01-RepeatMigration" -LogFile $logIdempotency

    # Re-run runtime assertions to confirm engine state integrity
    Invoke-PsqlOperation -Database $dbLegacy -FilePath $assertionSuiteFile `
        -StageName "ScenarioC-02-RuntimeAssertionsAfterRepeat" -LogFile $logIdempotency

    Write-Host "✓ [SCENARIO C PASSED] Candidate migration completed second execution without errors, and runtime assertions passed." -ForegroundColor Green
} catch {
    Write-Error "[SCENARIO C FAILED] Halting runner. Inspect $logIdempotency for exact database error."
    exit 7
}

# ==============================================================================
# 8. Post-Run Summary & Database Preservation Policy
# ==============================================================================
Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  ISOLATED STAGING VALIDATION COMPLETED SUCCESSFULLY!           " -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Created Disposable Databases (Preserved by default for DBA inspection):"
foreach ($db in $script:createdDatabases) {
    Write-Host "  - $db" -ForegroundColor Green
}
Write-Host "Preserved Session Logs:"
Write-Host "  - $initLog" -ForegroundColor Gray
Write-Host "  - $logFresh" -ForegroundColor Gray
Write-Host "  - $logLegacy" -ForegroundColor Gray
Write-Host "  - $logIdempotency" -ForegroundColor Gray

Write-Host "`n[DATABASE PRESERVATION POLICY]" -ForegroundColor Cyan
Write-Host "Automatic database deletion is DISABLED by policy to prevent accidental data loss." -ForegroundColor Gray
Write-Host "To inspect a created disposable database in psql:" -ForegroundColor Gray
Write-Host "  psql -h $Hostname -p $Port -U $Username -d $($script:createdDatabases[0])" -ForegroundColor Gray
Write-Host "`nWhen finished with inspection, drop only these specific databases manually:" -ForegroundColor Gray
foreach ($db in $script:createdDatabases) {
    Write-Host "  DROP DATABASE $db;" -ForegroundColor Gray
}
