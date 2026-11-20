<p align="center">
  <a href="https://adudir.com"><img src="assets/adudir-logo.png" width="128" alt="阿杜导演"></a>
</p>

<h1 align="center">MEP · Motion Edit Protocol</h1>

<p align="center">
  由 <a href="https://adudir.com"><b>阿杜导演</b></a> 提出并实现的开放剪辑协议<br>
  官网：<a href="https://adudir.com">adudir.com</a>
</p>

---

**MEP（Motion 剪辑协议）是让任何 AI 助手直接剪片子的开放协议。**
剪辑软件把工程开放成一个文件夹，助手读文件了解工程、写文件提交修改，软件校验后执行并写回执。

> MCP 给助手接一根线，MEP 给助手一张工作台。

- 不装插件、不改配置、不重启助手：任何能读写本机文件的助手都能用。
- 接入不占上下文；不靠截图；执行由软件按确定规则完成，不调用模型。
- 每单带版本号，不覆盖用户的新修改；每单有回执，可整单撤销。
- 助手可以请软件把成片某几秒画出来，自己检查后再交差。

## 一分钟看懂

```
用户在剪辑软件里点「复制命令」 ──► 把那句话贴给助手
                                        │
            ┌───────────────────────────┘
            ▼
   助手读 README.md、project.json
   助手写 requests/r-01.json  ──►  软件核对口令与版本、执行
                                   软件写 results/r-01.json  ──► 助手读回执，继续下一单
```

一个请求：

```json
{
  "mep": 1,
  "key": "本单口令",
  "who": "Codex",
  "base": "project.json 的 revision",
  "ops": [{ "op": "move", "clip": "片段id", "at": 1.5 }]
}
```

一份回执：

```json
{ "mep": 1, "id": "r-01", "ok": true, "at": 1763520001234, "revision": "新版本号",
  "changes": { "created": [], "removed": [] } }
```

## 仓库内容

| 路径 | 内容 |
|---|---|
| [SPEC.md](SPEC.md) | MEP 1 规范（目录、单据与口令、心跳、请求、回执、错误码、全部请求种类与 op、代码场景、安全、版本、一致性要求） |
| [schema/](schema/) | JSON Schema：请求、回执、`status.json`、`mep.json` |
| [examples/](examples/) | 示例 `mep.json`、心跳、请求与回执 |
| [reference/submit.mjs](reference/submit.mjs) | 参考提交脚本（Node.js，无依赖） |
| [docs/why-mep.md](docs/why-mep.md) | MEP 与 MCP、Computer Use 的对比和设计理由 |

## 实现

- **宿主（剪辑软件）**：按 [SPEC.md §15](SPEC.md#15-一致性要求) 的最低要求实现协作目录、单据、心跳、请求校验与回执。
- **助手**：读协作目录里的 `README.md`，按 `mep.json` 写请求即可，不需要任何 SDK。

参考实现：[阿杜导演](https://adudir.com)（桌面版 1.3.5 起）。下载与了解更多见官网 [adudir.com](https://adudir.com)。

## English summary

MEP (Motion Edit Protocol) is an open, file-based protocol that lets any AI assistant edit a video project. The editor exposes a project as a collaboration folder: the assistant reads `project.json`, writes a request to `requests/<id>.json` carrying a per-order key and the `revision` it read, and the editor validates, executes and answers in `results/<id>.json`. No plugin, no connection setup, no screenshots; optimistic concurrency via `base`, one-step undo per request, a heartbeat in `status.json`, fixed error codes with retry hints, and frame/contact-sheet "looks" so the assistant can check its own work. See [SPEC.md](SPEC.md) (Chinese) and the JSON Schemas in [schema/](schema/).

## 许可

[Apache License 2.0](LICENSE)。任何剪辑软件、任何助手都可以实现 MEP，无需另行授权。
