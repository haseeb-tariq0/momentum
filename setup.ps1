# ============================================================
# Forecast - Setup Script (Supabase + Upstash)
# 1. Open PowerShell as Administrator
# 2. cd D:\forecast
# 3. Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
# 4. .\setup.ps1
# ============================================================

$ErrorActionPreference = "Continue"

function Write-Step($msg)  { Write-Host "`n===> $msg" -ForegroundColor Cyan }
function Write-OK($msg)    { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "  [XX] $msg" -ForegroundColor Red }

Write-Step "Checking location..."
if (-not (Test-Path ".\package.json")) { Write-Fail "Run from D:\forecast"; exit 1 }
Write-OK "In D:\forecast"

# ── Check for .env.local with real Supabase URLs ─────────────
Write-Step "Checking environment..."
if (-not (Test-Path ".\.env.local")) {
    Write-Fail ".env.local not found. Copy .env.local and fill in your Supabase + Upstash credentials first."
    exit 1
}

$envContent = Get-Content ".\.env.local" -Raw
if ($envContent -match "YOUR-PROJECT-REF") {
    Write-Host ""
    Write-Host "  ────────────────────────────────────────────────────" -ForegroundColor Yellow
    Write-Host "  ACTION REQUIRED: Fill in your Supabase credentials" -ForegroundColor Yellow
    Write-Host "  ────────────────────────────────────────────────────" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. Go to https://supabase.com → your project → Settings → Database" -ForegroundColor White
    Write-Host "  2. Copy the 'Transaction' pooler string (port 6543) → DATABASE_URL" -ForegroundColor White
    Write-Host "  3. Copy the 'Session' pooler string (port 5432) → DIRECT_URL" -ForegroundColor White
    Write-Host "  4. Go to https://upstash.com → Redis → Connect → copy Redis URL → REDIS_URL" -ForegroundColor White
    Write-Host "  5. Re-run this script after filling in the values" -ForegroundColor White
    Write-Host ""
    Write-Host "  Your .env.local is at: D:\forecast\.env.local" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}
Write-OK ".env.local looks configured"

# Also write to packages/db/.env
Copy-Item ".\.env.local" ".\packages\db\.env" -ErrorAction SilentlyContinue
Write-OK "Copied .env.local → packages/db/.env"

# ── Install Chocolatey ───────────────────────────────────────
Write-Step "Checking Chocolatey..."
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Host "  Installing Chocolatey..." -ForegroundColor Yellow
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = `
        [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString(
        'https://community.chocolatey.org/install.ps1'))
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH","User")
    Write-OK "Chocolatey installed"
} else {
    Write-OK "Chocolatey already installed"
}

# ── Install Redis (local dev) ────────────────────────────────
Write-Step "Checking Redis..."
$redisRunning = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 6379)
    $tcp.Close()
    $redisRunning = $true
    Write-OK "Redis already running on port 6379"
} catch {}

if (-not $redisRunning) {
    $redisSvc = Get-Service -Name "Redis" -ErrorAction SilentlyContinue
    if (-not $redisSvc) {
        Write-Host "  Installing Redis..." -ForegroundColor Yellow
        choco install redis-64 -y --no-progress 2>&1 | Out-Null
        Write-OK "Redis installed"
    }
    $redisSvc = Get-Service -Name "Redis" -ErrorAction SilentlyContinue
    if ($redisSvc) {
        Start-Service "Redis" -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Write-OK "Redis service started"
    } else {
        $chocoRedis = "C:\ProgramData\chocolatey\lib\redis-64\tools\redis-server.exe"
        if (Test-Path $chocoRedis) {
            Start-Process $chocoRedis -WindowStyle Hidden
            Start-Sleep -Seconds 2
            Write-OK "Redis started (background)"
        } else {
            Write-Warn "Redis not found. Install from https://github.com/tporadowski/redis/releases"
        }
    }
}

# ── pnpm install ─────────────────────────────────────────────
Write-Step "Installing Node dependencies..."
& pnpm install
if ($LASTEXITCODE -ne 0) { Write-Fail "pnpm install failed"; exit 1 }
Write-OK "Dependencies installed"

# ── Prisma generate ──────────────────────────────────────────
Write-Step "Generating Prisma client..."
& pnpm db:generate
if ($LASTEXITCODE -ne 0) { Write-Fail "Prisma generate failed"; exit 1 }
Write-OK "Prisma client generated"

# ── Prisma migrate ───────────────────────────────────────────
Write-Step "Running database migrations (Supabase)..."
& pnpm db:migrate:dev
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Migration failed — check your Supabase DATABASE_URL and DIRECT_URL"
    Write-Warn "Retry with: pnpm db:migrate:dev"
} else {
    Write-OK "Migrations applied to Supabase"
}

# ── Seed ─────────────────────────────────────────────────────
Write-Step "Seeding database..."
& pnpm db:seed
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Seed failed — retry with: pnpm db:seed"
} else {
    Write-OK "Database seeded"
}

# ── Done ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  SETUP COMPLETE" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Start the app:" -ForegroundColor White
Write-Host "    pnpm dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Open in browser:" -ForegroundColor White
Write-Host "    http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Login credentials:" -ForegroundColor White
Write-Host "    admin@acme.com   / password123  (Admin)" -ForegroundColor Cyan
Write-Host "    manager@acme.com / password123  (Manager)" -ForegroundColor Cyan
Write-Host "    member@acme.com  / password123  (Member)" -ForegroundColor Cyan
Write-Host ""
