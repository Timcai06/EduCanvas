# MinerU 部署手册（2080 Ti / GPU 版）

- 状态：`draft`
- 负责人：hzlgou
- 创建时间：2026-08-11
- 相关分支：`docs/20260811-input-md-canvas-research`
- 目的：在部署机（2080 Ti）上起 `mineru-api` 独立服务，供 EduCanvas worker 以 REST 调用；本文档是**可复现操作手册**

## 一、部署机环境（已实测，2026-08-11）

| 项 | 实测值 | MinerU 要求 | 结论 |
|----|--------|-------------|------|
| GPU | NVIDIA RTX 2080 Ti，11GB（11264MiB） | hybrid-engine 需 8GB+ | ✓ |
| CUDA / 驱动 | CUDA 13.2 / 驱动 595.84 | torch 2.6+ 兼容 | ✓ |
| 内存 | 31GB | ≥16GB（推荐 32） | ✓ |
| 磁盘 | 可用 558GB | ≥25GB | ✓ |
| Python | **3.14.6**（conda base） | **`>=3.10,<3.14`** | ✗ **必须建 ≤3.13 环境** |

> ⚠️ **最关键一条**：MinerU `pyproject.toml` 声明 `requires-python = ">=3.10,<3.14"`，系统默认 Python 3.14 **不受支持**。**不要**在 base 环境直接 `pip install mineru`，必须先建 conda 环境（下文用 3.11）。

## 二、部署步骤

```bash
# ─── 0. 前置检查（本机已全部通过）─────────────────
nvidia-smi          # GPU 可见：RTX 2080 Ti 11GB ✓
free -h             # 内存 ≥ 16GB ✓（31GB）
df -h /             # 磁盘 ≥ 25GB ✓（558GB 可用）

# ─── 1. 建 conda 环境（Python 3.11，避开 3.14 不兼容）───
conda create -n mineru python=3.11 -y
conda activate mineru
python --version    # 应输出 3.11.x

# ─── 2. 安装 MinerU ──────────────────────────────
# ⚠️ 仅 `pip install mineru` 只装核心（office 解析 + API 服务），不含 torch！
# torch 在 extras 里：pipeline（PDF 小模型）+ vlm（hybrid 的 VLM 部分）都要
pip install "mineru[pipeline,vlm]" -i https://pypi.tuna.tsinghua.edu.cn/simple

# ─── 3. 确认 torch 认到 GPU（关键自检）───────────
python -c "import torch; print('CUDA:', torch.cuda.is_available(), '|', torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"
# 期望：CUDA: True | NVIDIA GeForce RTX 2080 Ti
# 若 False：装到了 CPU torch，重装 GPU 版后重跑：
#   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# ─── 4. 下载模型（国内走 ModelScope，约 3GB+）────
export MINERU_MODEL_SOURCE=modelscope
mineru-models-download
# 完成会打印模型路径并写回 ~/mineru.json

# ─── 5. 启动服务（后台，记录日志）────────────────
# 2080 Ti → hybrid-engine（默认后端，OmniDocBench 95.39）
# --enable-vlm-preload：启动即预载 VLM，首个任务响应更快
# MINERU_API_MAX_CONCURRENT_REQUESTS=1：11GB 显存起步别开满并发，防 OOM
export MINERU_API_MAX_CONCURRENT_REQUESTS=1
nohup mineru-api --host 0.0.0.0 --port 8000 --enable-vlm-preload true \
  > ~/mineru-api.log 2>&1 &

# ─── 6. 验证服务 ─────────────────────────────────
curl http://127.0.0.1:8000/health
# 期望：HTTP 200 + JSON 统计（queued/processing/completed/failed）
# 首次启动 VLM 预载较慢，盯进度：
tail -f ~/mineru-api.log

# ─── 7. 本地试转（连刚起的服务）──────────────────
mineru -p /path/to/your.pdf -o ~/mineru-output --api-url http://127.0.0.1:8000
# 产出 ~/mineru-output/<文件名>/ 下：<名>.md + content_list_v2.json + images/
```

## 三、回滚 / 换源 / 排错

| 情况 | 处理 |
|------|------|
| 模型下载卡住/失败 | 换源重试：`export MINERU_MODEL_SOURCE=huggingface` 再跑 `mineru-models-download`；或 `pip install -U huggingface_hub` 后重试 |
| 装了 mineru 但 `import torch` 报 No module | 缺 extras：补 `pip install "mineru[pipeline,vlm]"`（见第二步） |
| 第 3 步 CUDA=False | 按上面 index-url 重装 GPU 版 torch（这是最常见坑：pip 默认可能解析到 CPU torch） |
| 服务起不来 / OOM | 确认已设 `MINERU_API_MAX_CONCURRENT_REQUESTS=1`；内存不足时缩 `--enable-vlm-preload`（去掉预载，首个任务慢一点但不 OOM） |
| 服务启动但日志目录没生成 | 日志路径若写 `/var/log/`，普通用户无写权限会静默失败；改用 `~/mineru-api.log`（本手册步骤 5 已默认） |
| 想停服务 | `kill` 掉 nohup 的进程；想固化常驻可改 systemd service（见下） |
| 完整卸载 | `conda remove -n mineru --all` |
| 转换报「缺 pipeline 依赖」/ `No module named 'six'` | 典型假象：真实根因是 `six` 未装（MinerU 内置 pytorchocr 依赖它但 pyproject 未声明）。`pip install six` 后重启服务即可；先跑 `python -c "import six"` 验证再排查其他 |
| 报 `no relationship of type officeDocument` | **非标准 docx**（转换/爬取工具生成，包结构缺 officeDocument 关系），与 MinerU 无关——用 `python -c "import docx; docx.Document('x.docx')"` 复现即可确认，直接换源文件 |
| `.doc` 老格式（2003）不支持 | office 后端只认 `.docx/.pptx/.xlsx`，`.doc` 会报 `No supported documents found`；先经 LibreOffice/WPS 转 `.docx` 再喂 |
| 并发限制重启后恢复默认 | `MINERU_API_MAX_CONCURRENT_REQUESTS` 是 shell 级 env，`export` 后重启终端即丢；要长期生效就固化进 systemd 或写入 `~/.bashrc` |

## 四、注意事项（安全/运维）

1. **别开公网**：`mineru-api` **无内置认证**，`--host 0.0.0.0` 绑全部网卡 = 内网谁都能调。接入项目时前面加网关/TLS；验证阶段仅限受信内网
2. **并发起步 1**：11GB 显存跑默认并发 3 可能 OOM；稳定后按实测上调
3. **结果保留 24h**：任务结果 zip 会被定期清理，worker 侧应及时下载
4. **许可合规**：Apache-2.0 + 附加条款（对第三方在线服务须署名、超规模门槛需商业授权）——接入前过 ADR

## 五、复现 checklist（前 5 项 2026-08-11 已实测通过）

- [x] `nvidia-smi` 看到 2080 Ti
- [x] `conda create -n mineru python=3.11` 成功
- [x] `python -c "import torch; torch.cuda.is_available()"` 输出 True（实测：`CUDA: True | NVIDIA GeForce RTX 2080 Ti`）
- [x] `mineru-models-download` 完成（模型路径写回 `~/mineru.json`）
- [x] `curl :8000/health` 返回 200（实测：`status:healthy, version:3.4.4`）
- [ ] `mineru -p 测试文档 -o 输出目录 --api-url :8000` 产出 md + content_list_v2.json（**待测**）

## 六、部署实测记录（2026-08-11 逐步验证）

| 阶段 | 命令/动作 | 实测结果 |
|------|-----------|----------|
| ① 装 torch | `pip install "mineru[pipeline,vlm]"` | torch-2.13.0 + CUDA 13 组件 + transformers-4.57.6 装好；⚠️ 仅 `pip install mineru` 不含 torch（extras 必装） |
| ② CUDA 自检 | `python -c "import torch; ..."` | `CUDA: True \| NVIDIA GeForce RTX 2080 Ti` ✓ |
| ③ 下载模型 | `mineru-models-download -s modelscope -m all` | pipeline 7 模型 → `~/.cache/modelscope/models/OpenDataLab--PDF-Extract-Kit-1.0/snapshots/master`（2.5G）；vlm → `~/.cache/modelscope/models/OpenDataLab--MinerU2.5-Pro-2605-1.2B/snapshots/master`（2.2G）；写回 `~/mineru.json` |
| ④ 启动服务 | `nohup mineru-api --host 0.0.0.0 --port 8000 --enable-vlm-preload true` | 后台启动成功，日志 `~/mineru-api.log` |
| ⑤ 健康检查 | `curl :8000/health` | HTTP 200：`{"status":"healthy","version":"3.4.4","protocol_version":2,"max_concurrent_requests":1,"task_retention_seconds":86400,...}` |

**mineru.json 配置解读**（`config_version: 1.3.2`）：

- `models-dir.pipeline / .vlm`：指向上面两个本地模型目录；`model-source: modelscope`（模型已本地化，后续可改 `local` 纯离线）
- `latex-delimiter-config`：默认块 `$$...$$`、行内 `$...$` —— 与调研结论一致：**锁定默认、不开放自定义**，前端 rehype-katex 直接消费
- `llm-aided-config.title_aided`：`enable: false`（DashScope qwen 标题辅助默认关闭，无外部调用）
- `bucket_info`：对象存储占位模板（ak/sk 为示例字符串，非真实密钥），忽略
