# EduCanvas Windows 启动入口（薄包装）。
#
# 所有启动业务逻辑（环境检查、数据库、迁移、Web/Gateway/Worker 就绪、
# 日志会话、优雅停止）统一收敛在 tooling/local-orchestrator.mjs，
# 与 macOS/Linux 的 make all 语义完全一致。本脚本只负责：
#   1. 定位仓库根目录；
#   2. 检查 .env 存在；
#   3. 以 all 模式调用统一 orchestrator。
#
# 需要详细日志时用 `node tooling/local-orchestrator.mjs all-verbose`；
# 查看状态/日志/停止分别用 `... status|logs|stop`。

param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3101
)

$ErrorActionPreference = 'Stop'

# Keep all runtime state beside the script so a double-click works from any cwd.
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

$EnvPath = Join-Path $ProjectRoot '.env'
if (-not (Test-Path -LiteralPath $EnvPath)) {
  throw ".env not found: $EnvPath. Copy .env.example to .env first."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node.exe is not available in PATH.'
}

$env:PORT = "$Port"
& node (Join-Path $ProjectRoot 'tooling/local-orchestrator.mjs') all
exit $LASTEXITCODE
