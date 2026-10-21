# ElajX (علاجك) — Isolated PostgreSQL Staging Validation Package & Runbook

**Document Version:** 1.3.0 (Phase 5.2B Bounded Safety Hardened Runner)  
**Target Migration Under Test:** `supabase/migrations/20261021000001_reconcile_existing_schema.sql`  
**Classification:** Isolated Database Staging Validation Specification & Operator Runbook

---

## 1. Safety Directives & Scope Boundaries

1. **LOCAL DISPOSABLE INSTANCE ONLY:** This package must ONLY be executed against a local disposable PostgreSQL 15+ engine (`localhost` / `127.0.0.1` / `::1`). Remote host connections (such as any Supabase project, staging cluster, or production environment) are strictly forbidden and blocked by the runner.
2. **ZERO SECRET OR ENV LOADING:** Never load, print, or expose production credentials, service role keys, or `.env` files. The runner actively ignores any `.env` or `.env.local` files present in the directory.
3. **ZERO AUTOMATIC DELETION:** All automatic database deletion paths have been permanently disabled. The runner never executes `DROP DATABASE`.
4. **COLLISION-RESISTANT NAMING:** Every test database is uniquely named (`elajx_disp_fresh_<timestamp>_<nonce>` and `elajx_disp_legacy_<timestamp>_<nonce>`).
5. **DETERMINISTIC EXISTENCE VERIFICATION:** Before creating any database, the runner executes a machine-readable scalar query (`psql -t -A -c "SELECT count(*) FROM pg_database WHERE datname = '...';"`) and deterministically parses the integer result. If parsing fails, or if count &ne; 0, the runner aborts immediately without touching or modifying any database.
6. **PRESERVATION BY DEFAULT:** All test databases and logs are preserved upon test completion for DBA inspection. Manual cleanup must be a separate, carefully reviewed operator action.
7. **HONEST EXECUTION REPORTING:** No PostgreSQL engine test is marked as passed unless actually executed on a live PostgreSQL server.

---

## 2. Staging Package Artifacts

| Artifact | Location | Purpose |
| :--- | :--- | :--- |
| **Prerequisites Setup** | `supabase/staging/00_setup_prerequisites.sql` | Provisions minimal mock `auth` schema, roles (`anon`, `authenticated`, `service_role`), helper functions (`auth.uid()`, `auth.role()`), and PostgreSQL 15+ public schema grants. |
| **Legacy Baseline Fixture** | `supabase/staging/01_legacy_baseline_fixture.sql` | Seeds 33 representative legacy `public.medicines` and 33 `public.pharmacies_stock` rows to test schema reconciliation. |
| **Candidate Migration** | `supabase/migrations/20261021000001_reconcile_existing_schema.sql` | The candidate migration under test (2,082 lines of hardened DDL, RLS policies, and SECURITY DEFINER RPCs). |
| **Runtime Assertion Suite** | `supabase/staging/02_runtime_assertion_suite.sql` | Executes 8 transactional security assertions validating schema isolation, privilege escalation prevention, RLS barrier enforcement, and OTP lifecycle integrity. |
| **Windows PowerShell Runner** | `scripts/staging-validation/Run-StagingValidation.ps1` | The safe, non-destructive staging execution runner. |

---

## 3. Operator Execution Instructions for Windows

### A. Operator Environment Prerequisites Checklist

Confirm the following before launching the runner:
- [ ] Local PostgreSQL 15+ engine is running on `localhost:5432` (`Get-Service postgresql*`).
- [ ] Operator has verified that the target local PostgreSQL instance is DISPOSABLE and contains NO valuable, staging, or production data.
- [ ] `psql.exe` is available in PATH (or located in `C:\Program Files\PostgreSQL\<version>\bin`).
- [ ] Safe local authentication is configured:
  * **Option 1 (Recommended):** Windows PostgreSQL password file `%APPDATA%\postgresql\pgpass.conf` containing `localhost:5432:*:postgres:<password>` with NTFS permissions restricted exclusively to the current Windows user (`icacls`).
  * **Option 2:** Local `trust` or `sspi` (Windows Integrated Authentication) configured in `pg_hba.conf` for local administrative connections.
- [ ] Terminal is running PowerShell 5.1 or PowerShell 7+ in the ElajX repository root.
- [ ] **SAFETY CONFIRMATION:** No remote connection strings or production `.env` files are in use.

### B. Launching the Runner

From the repository root in PowerShell:

```powershell
# 1. Standard Run: Executes all scenarios; preserves disposable databases and logs
.\scripts\staging-validation\Run-StagingValidation.ps1

# 2. Custom Port or Administrative User (if non-default)
.\scripts\staging-validation\Run-StagingValidation.ps1 -Port 5432 -Username postgres
```

---

## 4. Runner Architecture & Safeguards Breakdown

### A. Database Uniqueness & Deterministic Overwrite Prevention
1. **Dynamic Unique Naming:** Databases are named using UTC timestamp and random hex nonces (e.g. `elajx_disp_fresh_20261021_173000_a1b2c3`).
2. **Deterministic Pre-Creation Scalar Parsing:** Executes `psql -t -A -c "SELECT count(*) FROM pg_database WHERE datname = '$DbName';"` and parses the scalar output with `[int]::TryParse`. If the output is non-integer or count &ne; 0, the script aborts immediately.
3. **Zero `DROP DATABASE`:** All drop execution paths have been removed. The runner never deletes databases.

### B. Reliable Error Handling & Immediate Halting
- **Native Process Wrapper:** `Invoke-PsqlOperation` launches `psql.exe` directly via `System.Diagnostics.Process`, capturing `StandardOutput` and `StandardError`.
- **Exit Code Checking:** Every invocation checks `$proc.ExitCode`. If non-zero, it immediately writes the full error log to `scripts/staging-validation/logs/` and throws a terminating exception.
- **Fail-Fast:** Halts execution at the exact failing stage. Subsequent stages and scenarios are never executed if an earlier stage fails.
- **Never False Pass:** The script will never print `[PASS]` or declare success if any exit code was non-zero.

### C. Comprehensive Idempotency Assertions
In Scenario C, repeat migration execution is validated by querying catalog definitions in the `public` schema:
- Duplicate non-internal triggers on public tables: `SELECT count(*) - count(DISTINCT (tgname, tgrelid)) FROM pg_trigger ...`
- Duplicate policies on public tables: `SELECT count(*) - count(DISTINCT (polname, polrelid)) FROM pg_policy ...`
- Duplicate indexes in public namespace: `SELECT count(*) - count(DISTINCT relname) FROM pg_class WHERE relkind = 'i' ...`
- Duplicate constraints on public tables: `SELECT count(*) - count(DISTINCT (conname, conrelid)) FROM pg_constraint ...`

### D. Credentials & Credential Leakage Prevention
- **No Plaintext Passwords in Scripts:** Passwords are never embedded in script files, command-line arguments, or environment variable dumps.
- **Credential-Free Logging:** Connection parameters in logs are strictly limited to `-h localhost -p 5432 -U postgres -d <disposable_db>`.
- **Protected Environment:** `.env` and `.env.local` are explicitly ignored.

---

## 5. Test Execution Scenarios

### Scenario A: Fresh Schema Validation
1. Verify local PostgreSQL connectivity and version.
2. Verify `$dbFresh` does not exist; create `$dbFresh`.
3. Apply `00_setup_prerequisites.sql` (mock `auth` schema, roles, and public grants).
4. Apply candidate migration `20261021000001_reconcile_existing_schema.sql`.
5. Apply `02_runtime_assertion_suite.sql` (8 runtime security assertions).
6. Verify exit code 0 for all stages.
7. Preserve `$dbFresh` and `staging_fresh_<timestamp>.log`.

### Scenario B: Legacy Schema Reconciliation Validation
1. Verify `$dbLegacy` does not exist; create `$dbLegacy`.
2. Apply `00_setup_prerequisites.sql`.
3. Apply `01_legacy_baseline_fixture.sql` (33 legacy medicines + 33 stock records).
4. Apply candidate migration `20261021000001_reconcile_existing_schema.sql`.
5. Verify records presence in `public.medicines` and `public.medicine_catalog`.
6. Apply `02_runtime_assertion_suite.sql`.
7. Verify exit code 0 for all stages.
8. Preserve `$dbLegacy` and `staging_legacy_<timestamp>.log`.

### Scenario C: Migration Idempotency Validation
1. Re-run candidate migration a second time on `$dbLegacy`.
2. Verify exit code 0.
3. Query `pg_trigger`, `pg_policy`, `pg_class`, and `pg_constraint` to verify zero duplicate triggers, policies, indexes, or constraints.
4. Re-run `02_runtime_assertion_suite.sql` on the re-migrated database.
5. Verify exit code 0.
6. Preserve `staging_idempotency_<timestamp>.log`.

---

## 6. Execution Status Matrix

| Component | Status | Verification Method |
| :--- | :--- | :--- |
| **Runner Syntax & Parameter Checking** | **VERIFIED** | Static lexical inspection of runner script |
| **TypeScript Domain & Invariant Tests** | **PASSED (212 / 212)** | `npx tsx scripts/verify-integrity.ts` |
| **Local PostgreSQL Engine Connectivity** | **NOT RUN** (Engine unavailable in AI Studio sandbox) | Requires execution by Windows operator |
| **Fresh Schema Migration (Scenario A)** | **NOT RUN** (Engine unavailable in AI Studio sandbox) | Requires execution by Windows operator |
| **Legacy Schema Reconciliation (Scenario B)** | **NOT RUN** (Engine unavailable in AI Studio sandbox) | Requires execution by Windows operator |
| **Migration Idempotency (Scenario C)** | **NOT RUN** (Engine unavailable in AI Studio sandbox) | Requires execution by Windows operator |
| **Runtime Security Assertions (T.1–T.8)** | **NOT RUN** (Engine unavailable in AI Studio sandbox) | Requires execution by Windows operator |

---

## 7. Manual Inspection Runbook

By default, all databases are preserved. To inspect after a run:

```bash
# Connect to fresh database:
psql -h localhost -p 5432 -U postgres -d elajx_disp_fresh_<timestamp>_<nonce>

# Connect to legacy database:
psql -h localhost -p 5432 -U postgres -d elajx_disp_legacy_<timestamp>_<nonce>
```

When finished with inspection, drop only the specific disposable databases recorded in your session summary:

```sql
DROP DATABASE elajx_disp_fresh_<timestamp>_<nonce>;
DROP DATABASE elajx_disp_legacy_<timestamp>_<nonce>;
```
