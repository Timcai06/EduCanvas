# EduCanvas Windows 停止入口（薄包装）。
#
# 委托统一 orchestrator：默认 stop（停 core + 数据库容器，数据卷保留）；
# -KeepDb 时只停 core（stop-core），保留数据库容器运行。

param([switch]$KeepDb)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

if ($KeepDb) {
  & node (Join-Path $ProjectRoot 'tooling/local-orchestrator.mjs') stop-core
} else {
  & node (Join-Path $ProjectRoot 'tooling/local-orchestrator.mjs') stop
}
exit $LASTEXITCODE
