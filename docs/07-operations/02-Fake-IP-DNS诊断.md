# Fake-IP DNS 诊断与处理

- 状态：`accepted`
- 日期：2026-08-17
- 关联任务：WS01

## 背景

透明代理（Clash、mihomo、sing-box 等）的 Fake-IP 模式会在 DNS 层拦截所有域名查询，返回 `198.18.0.0/15` 范围内的合成 IP，而非真实解析结果。这导致 EduCanvas 的 SSRF 防线无法验证目标地址的真实可达性。

## 为什么不能放行 198.18.0.0/15

- 该范围属于 RFC 2544 保留地址，不应出现在公网通信中
- Fake-IP 合成地址不代表真实目标，放行等同于关闭 SSRF 防线
- 混合结果（Fake-IP + 私网/公网）无法逐条信任，必须 fail closed

## 识别方式

EduCanvas 会检测 DNS 解析结果是否**全部**落在 `198.18.0.0/15`：

- **全部 Fake-IP** → 返回稳定错误码 `fake_ip_dns_detected`，建议切换 DNS 模式
- **混合结果**（Fake-IP + 私网/公网）→ 返回 `link_blocked_host`（fail closed）
- **全部公网** → 正常放行

## 用户侧修复

### Clash / mihomo

编辑 `config.yaml`，将 `dns.fake-ip` 相关配置改为 Redir-Host 模式：

```yaml
dns:
  enhanced-mode: redir-host # 或 host 模式
  # fake-ip-range: 198.18.0.1/16  # 删除此行
```

修改后重启 Clash 服务。

### sing-box

在 `dns` 部分使用 `real-ip` 而非 `fakeip`：

```json
{
  "dns": {
    "rules": [],
    "final": "dns-proxy",
    "servers": [
      {
        "tag": "dns-proxy",
        "address": "https://dns.google/dns-query",
        "detour": "proxy"
      }
    ]
  }
}
```

### 系统级 DNS

如果使用系统代理而非透明代理，确保系统 DNS 未被劫持到 Fake-IP：

```bash
# macOS: 检查当前 DNS 解析
scutil --dns | grep 'nameserver\|domain'

# Linux: 检查 resolv.conf
cat /etc/resolv.conf

# 通用: 测试域名解析是否返回真实 IP
nslookup example.com
dig example.com A
```

## 禁止事项

- **禁止**将 `198.18.0.0/15` 加入公网白名单或 SSRF 绕过列表
- **禁止**通过修改 `isPublicIpAddress()` 或 `isFakeIpAddress()` 放行该范围
- **禁止**在混合结果场景下放宽安全判断

## 后续方向（不在 WS01 范围）

- 受控 resolver/connector：为特定域名使用可信 DNS 服务器验证
- 可信 egress proxy：通过受控出口代理访问目标
- 部署侧真实 DNS：在生产环境使用不受 Fake-IP 影响的 DNS 配置
