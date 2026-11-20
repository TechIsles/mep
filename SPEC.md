# MEP 1 规范（Motion Edit Protocol，Motion 剪辑协议）

- 协议标识：`mep/1`
- 状态：1.0 正式版
- 参考实现：阿杜导演（ADuDir）桌面版

本文中的「必须」「不得」「应当」「可以」分别对应 RFC 2119 的 MUST、MUST NOT、SHOULD、MAY。

English version: [SPEC.en.md](SPEC.en.md).

---

## 1. 角色与术语

| 术语 | 含义 |
|---|---|
| 宿主（host） | 实现 MEP 的剪辑软件。它维护工程、校验并执行请求、写回执。 |
| 助手（assistant） | 能读写本机文件的 AI 助手或程序。它读协作目录、写请求。 |
| 协作目录 | 宿主为一个工程开放的文件夹，MEP 的全部交互都在这里进行。 |
| 单据（order） | 一次授权协作。从用户在宿主里「复制命令」开始，到用户停下或空闲超时结束。 |
| 本单口令（key） | 单据的凭证，只出现在用户复制给助手的命令里。 |
| revision | 工程版本号，时间线每次变化都会改变。 |
| 请求 / 回执 | 助手写的 `requests/<id>.json`；宿主写的 `results/<id>.json`。 |
| 成片秒数 | 成片时间轴上的秒数。素材秒数是素材文件自己的秒数。 |

## 2. 交接命令

用户在宿主里点「复制命令」，得到一句交给助手的自然语言命令。命令必须包含：

1. 协作目录的绝对路径；
2. 本单口令；
3. 让助手先读 `README.md` 的指引。

参考写法：

```
请在这个工程目录里开工："<协作目录>"。本单口令：<key>。这是 MEP 协作目录：先读 README.md（机器可读的约定在 mep.json），按 README 开头判断我要做什么再开工。每个请求都写上本单口令；每次修改前先读最新 project.json，按 README 提交，不要覆盖用户的新修改。
```

助手不需要安装插件、配置连接或重启会话。

## 3. 协作目录结构

```
<协作目录>/
├── mep.json              机器可读清单（§10）
├── README.md             给助手的简短入口
├── docs/                 分册说明，助手按需读取
│   ├── timeline.md       ops 与 look
│   ├── roughcut.md       口播粗剪
│   ├── template.md       模板制作
│   ├── media.md          配音、找素材、inbox
│   └── pages.md          代码场景
├── TEMPLATE-GUIDE.md     当前模板的制作路线（工程选了模板时）
├── status.json           心跳与处理状态（§5）
├── project.json          时间线与 revision（只读）
├── captions.json         成片字幕与逐字时间（只读）
├── content.json          代码场景可改字段（只读）
├── template.json         当前模板的合同（只读）
├── pages/                代码场景当前 HTML（只读副本）
├── project-files/        工程内页面文件的只读副本；media.json 是素材库
├── requests/             助手写请求
├── results/              宿主写回执
├── inbox/                助手带来的素材
├── looks/                宿主画给助手看的画面
├── search/               素材搜索结果
└── submit.mjs            参考提交脚本（§12）
```

规则：

- 除 `requests/` 与 `inbox/` 外，目录里的文件都由宿主维护，助手不得修改。
- 宿主写文件必须先写临时文件再改名，保证助手读不到半个文件。
- 宿主应当把目录与文件权限设为仅当前用户可读写（`0700` / `0600`）。
- 宿主在工程空闲时刷新镜像文件（参考实现：每 2 秒检查一次）。

## 4. 单据与口令

- 用户「复制命令」时，宿主打开一个单据：已有开着的单据就沿用其口令，否则生成新口令。参考实现的口令是 16 位十六进制随机串。
- 口令不得写进协作目录。宿主应当把单据存在协作目录之外。
- 单据状态：`open`（开着）、`stopped`（用户点「停下这单」）、`expired`（空闲超过 `idleMs`）。
- 每处理一单请求，单据续期。默认 `idleMs` 为 24 小时。
- 单据不是 `open` 时，所有请求回执 `order_closed`。口令不对回执 `unauthorized`。
- 单据结束后，用户重新复制命令，得到新口令。

## 5. status.json（心跳）

```json
{
  "mep": 1,
  "alive": 1763520000000,
  "state": "open",
  "order": "o-1a2b3c4d",
  "expiresAt": 1763606400000,
  "revision": "9f3c…",
  "working": { "id": "r-01", "text": "等用户在软件里确认", "at": 1763520000000 },
  "refused": { "id": "r-00", "code": "unauthorized", "message": "…", "at": 1763519990000 }
}
```

| 字段 | 说明 |
|---|---|
| `alive` | 最近一次心跳，Unix 毫秒。宿主服务工程期间至少每 5 秒（`everyMs`）写一次。 |
| `state` | `open` / `stopped` / `expired` / `offline`。宿主退出或工程关闭时立即写 `offline`。 |
| `order` | 当前单据 id，没有为 `null`。 |
| `expiresAt` | 仅 `open` 时出现：按现在的空闲时间，单据何时过期。 |
| `revision` | 宿主最近读到的工程版本号。 |
| `working` | 正在处理的请求和宿主正在做什么（例如等用户确认）。助手看到它时不得重复提交。 |
| `refused` | 最近一次因口令或单据被拒的请求。 |

助手判断：`alive` 超过 20 秒（`staleMs`）没更新，说明宿主没在运行或工程没打开；`state` 不是 `open`，请用户重新复制命令。

## 6. 请求

### 6.1 提交

1. 读 `status.json`，确认在线且 `state` 为 `open`。
2. 读 `project.json`，记下 `revision`。
3. 先写 `requests/<id>.tmp`，再改名为 `requests/<id>.json`。
4. 等 `results/<id>.json`。

- `id` 就是文件名，必须匹配 `^[A-Za-z0-9_-]{1,100}$`，每单换新。
- 请求文件不得超过 2 MiB。
- 宿主按到达顺序逐单处理，同一时刻只处理一单。

### 6.2 信封

```json
{
  "mep": 1,
  "key": "本单口令",
  "who": "Codex",
  "base": "project.json 的 revision",
  "ops": [{ "op": "move", "clip": "片段id", "at": 1.5 }]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `mep` | 是 | 固定为 `1`。 |
| `key` | 是 | 本单口令，原样抄写，最长 64 字符。 |
| `who` | 是 | 助手署名，1–24 个字：字母、数字、汉字、空格、`.` `_` `-`，首字为字母或数字，首尾不留空格。 |
| `base` | 视种类 | 读到的 `revision`（16–64 位小写十六进制）。见下表。 |
| `id` | 否 | 可省略；写了必须与文件名一致。 |

每个请求必须且只能带下面七种内容之一：

| 种类 | 用途 | 要 `base` | 付费 | 说明文档 |
|---|---|---|---|---|
| `ops` | 改时间线、写页面、字幕、动效 | 是 | 否 | docs/timeline.md |
| `roughcut` | 按逐字稿粗剪口播 | 是 | 否 | docs/roughcut.md |
| `template` | 用模板制作 | 是 | `compose` 付费 | docs/template.md |
| `look` | 看成片画面 / 素材画面 | `times`、`sheet` 要；`src` 不要 | 否 | docs/timeline.md |
| `voice` | 文案配音 | 否 | 是 | docs/media.md |
| `search` | 搜素材 | 否 | 否 | docs/media.md |
| `fetch` | 下载搜到的素材进 inbox | 否 | 否 | docs/media.md |

### 6.3 版本校验

需要 `base` 的请求，`base` 与工程当前 `revision` 不一致时，宿主不得执行，回执 `conflict`。助手不得强行覆盖用户或其他助手的新修改。

## 7. 回执

成功：

```json
{
  "mep": 1,
  "id": "r-01",
  "ok": true,
  "at": 1763520001234,
  "revision": "处理后的版本号",
  "result": {},
  "changes": { "created": ["新片段id"], "removed": ["被删片段id"] },
  "spent": { "credits": 12, "order": 30 }
}
```

失败：

```json
{
  "mep": 1,
  "id": "r-01",
  "ok": false,
  "at": 1763520001234,
  "revision": "当前版本号",
  "error": { "code": "conflict", "retry": "reread", "message": "原因和下一步" }
}
```

- 每个 id 只回执一次，回执不得被覆盖。已有回执的 id 再次提交，回执 `id_used`。
- 宿主至少保留最近 200 份回执。
- `changes` 只在时间线片段有增删时出现。
- `spent` 只在花费时出现：`credits` 是这一单花的（`null` 表示宿主没拿到数字），`order` 是这一单据的累计。
- `error.message` 与 `result` 不得包含本机路径、本地地址、密钥或令牌。
- 只写文件（`file`、`import`、`page`）的请求不改时间线，`revision` 不变，这是正常的。

## 8. 错误码

| code | retry | 含义 |
|---|---|---|
| `bad_request` | fix | 请求格式或内容不对 |
| `unsupported_version` | fix | 没写 `"mep":1`，或版本宿主不认识 |
| `unauthorized` | user | 口令不对 |
| `order_closed` | user | 单据已停止、已过期或还没开 |
| `id_used` | fix | 这个 id 已有回执 |
| `conflict` | reread | `base` 不是当前版本；模板请求时也可能是模板合同、材料或时间线变了 |
| `clip_unavailable` | reread | 片段不存在或已锁定 |
| `not_ready` | fix | 工程不满足前提（例如没有口播或字幕） |
| `needs_user` | user | 要用户在宿主里确认、决定或操作 |
| `insufficient_credits` | user | 余额不足 |
| `busy` | later | 宿主正在重启，或渲染引擎未就绪 |
| `interrupted` | reread | 宿主处理到一半退出，这一单可能已执行 |
| `failed` | no | 宿主内部错误 |

| retry | 助手怎么做 |
|---|---|
| `fix` | 按 `error.message` 改请求，用新 id 再交 |
| `reread` | 重读 `project.json`（模板请求还要重读 `template.json`），用新 `revision` 作 `base`、新 id 再交 |
| `later` | 稍后用新 id 原样再交 |
| `user` | 把 `error.message` 转告用户 |
| `no` | 不要重试，转告用户 |

宿主重启时，若发现有请求处理到一半，必须为它写 `interrupted` 回执，且不得自动重跑。

## 9. 请求种类

### 9.1 `ops`：改时间线

一次 1–100 项。同一单的 ops 一起校验、一起写入、一步撤销。同一条轨道上的片段不得重叠；已锁定片段不得修改。

| op | 字段 | 说明 |
|---|---|---|
| `move` | `clip`, `at`, `track?` | 移到成片秒数 `at`。`track`：数字（0 为最上层）、`"top"`（新建最上层轨）、`"bottom"`（新建最底层轨；已有空的最底层轨时直接用它） |
| `set` | `clip`, `field`, `value` | `field` 取 `at` / `volume` / `speed` / `time` / `box` / `style` / `fade` / `duck`（见下） |
| `remove` | `clip`, `ripple?` | `ripple: true` 波纹删除：其后未锁定轨上的片段前移 |
| `cut` | `clip`, `at` | 在成片秒数 `at` 处切开；右段 id 为 `原id-cutN`，见回执 `changes.created` |
| `content` | `clip`, `path`, `value` | 改模板声明的内容字段（见 `content.json`），按模板规则校验 |
| `page` | `clip`, `text` | 整页替换代码场景 HTML（≤1 MiB） |
| `animation` | `clip`, `part`, `style`, `seconds?` | 片段动画，必须单独一批提交（§9.1.2） |
| `stage` | `w`, `h`, `fps?` | 画布尺寸 64–4096 |
| `fps` | `fps` | 23.976 / 24 / 25 / 29.97 / 30 / 48 / 50 / 59.94 / 60 / 120 / `"auto"` |
| `file` | `path`, `text`, `without_template?` | 写工程页面文件（§9.1.3） |
| `import` | `path` | 把 `inbox/` 下的文件或文件夹导入工程，不上轨 |
| `add` | `clip`, `track?` | 新增片段（§9.1.4） |
| `subtitleStyle` | `patch` | 字幕样式（§9.1.5） |
| `subtitleSplit` | `clip`, `maxCells` 或 `line`+`before` | 把长字幕切短 |
| `translation` | `clip`, `language`, `lines` | 写字幕译文 |

#### 9.1.1 `set` 的字段

| field | value |
|---|---|
| `at` | 成片秒数 |
| `volume` | 线性倍数：1 原音量，0.5 约 -6 dB，0 静音，最大 4 |
| `speed` | 播放速度倍数 |
| `time` | `[入点, 出点]`，素材秒数 |
| `box` | `{x, y, w, h, r?}` 像素与旋转度数；`null` 恢复铺满 |
| `style` | CSS 声明字符串，如 `"object-fit:cover;border-radius:48px"` |
| `fade` | `[淡入秒, 淡出秒]` |
| `duck` | 说话时自动压低：`true`、`{"speech":-20,"pause":-14,"under":[…]}` 或 `null` 关闭 |

`box` 与 `style` 在整段片段中不变；随时间变化的动效写在代码场景里。

#### 9.1.2 `animation`

```json
{ "op": "animation", "clip": "画面片段id", "part": "loop", "style": "bounce", "seconds": 0.8 }
```

- `part`：`in`（入场）、`out`（出场）、`loop`（循环 / 运镜）。
- 入场如 `fade` `pop` `drop`；出场如 `fade` `fall`；循环如 `bounce` `pulse` `float` `sway` `shake` `spin` `blink`；运镜 `push-in` `pull-out` `pan-left` `pan-right` `pan-up` `pan-down` 用 `loop`。
- `seconds`：入场 / 出场 0.05–10，循环 0.2–10，运镜不填。`style: "none"` 移除。
- 带 `animation` 的请求只能包含 `animation` 项。宿主可以扩展 style 词表，并在 `mep.json` 中声明。

#### 9.1.3 `file` 与 `import`

- `file.path` 必须匹配 `^(pages|scenes|styles|scripts|data)/…\.(html|css|js|mjs|json|svg)$`，最多 3 层子目录，任何一段不得为 `..` 或以 `.` 开头；`text` ≤ 1 MiB。同名文件整份覆盖；覆盖前用户又改过时宿主应当拒绝。
- `without_template: true` 只在用户被告知模板不能用、并同意手工制作后使用。
- `import.path` 必须在 `inbox/` 下；文件夹最多 3000 个文件、2 GiB、4 层。导入到工程 `assets/imported/<相对路径>`，回执 `result.imported` 列出对应关系。导入的文件不随整单撤销删除。

#### 9.1.4 `add`

```json
{ "op": "add", "clip": { "id": "player", "src": "pages/player.html", "at": 0, "time": [0, 152.4] }, "track": "top" }
```

- `clip` 只能有 `id` `src` `at` `time` `volume` `speed` `box` `style`。
- `src`：工程内文件（`file` 写的页面、`assets/…`），或 `inbox/` 下的音视频 / 图片（宿主复制进 `assets/imported/` 再上轨），或 `project-files/media.json` 里列出的素材。
- 代码场景必须写 `time: [0, 时长]`。
- 不写 `id` 时由宿主生成，见回执 `changes.created`。
- `track` 编号按同一单前面的 ops 执行后的轨道计算。

#### 9.1.5 字幕

- `subtitleStyle.patch` 可用：`on`、`look`、`sizePct`（画面短边的 2–10%）、`weight`、`fill`、`pos {x,y}`（0–1）、`stroke {widthEm,color}`、`box {color,opacity}`、`shadow`、`karaoke {mode: color|box|pop|fill, color}`、`language`、`bilingual`、`secondary {…}`、`fonts {语言码: 字体}`。`patch` 序列化后 ≤ 20000 字节。
- `translation.lines[].line` 是 `captions.json` 里每句的 `line`；每句一条，`text` ≤ 300 字。语言码用 `en`、`zh`、`zh-TW` 等，不使用 `zh-Hans` / `zh-Hant`。
- `subtitleSplit`：`{"maxCells":14}` 自动按标点和停顿切；或 `{"line":76100,"before":["要切开的字"]}` 手动切。不在词中间切，逐字时间不变。

### 9.2 `roughcut`：口播粗剪

助手按逐字稿做决定，只指文字，不写时间；宿主按词边界落刀，按实测静音收紧停顿。

1. `{"roughcut":{"action":"read"}}`：回执给出 `clipId`、`rev`、剪辑规则 `guide`、带 `L` 行号的逐字稿 `transcript`。长稿按 `next` 加 `offset` 续读；多段口播时加 `clipId`。口播还没有字幕时，宿主可以先请用户确认，再自行识别。
2. `{"roughcut":{"action":"preview","rev":"…","decision":{…}}}`：不改时间线，返回删后每行剩下的文字 `kept`。
3. `action: "apply"`：同一份 `decision` 与 `rev`，一步可撤销。宿主可以对大幅删除（参考实现：超过 5 秒）要求用户确认。

`decision`：

```json
{
  "cuts": [
    { "line": "L12", "kind": "retake", "reason": "…" },
    { "line": "L20", "toLine": "L22", "kind": "aside", "reason": "…" },
    { "line": "L30", "quote": "原样抄这行里的字", "occurrence": 1, "kind": "false_start", "reason": "…" }
  ],
  "pace": "tight",
  "note": "…"
}
```

`kind`：`retake` 重录 | `false_start` 半句改口 | `misspeak` 说错重说 | `stutter` 卡壳 | `filler` 语气词 | `aside` 旁人 / 闲聊。`rev` 不一致说明口播或字幕变了，要重新 `read`。

### 9.3 `template`：用模板制作

- `{"template":{"operation":"compose","goal":"…","until":"plan"?}}`：宿主按时间线上的口播和画面编排全片并出片（付费）。`goal` ≤ 4000 字；`until: "plan"` 只出方案。
- `{"template":{"operation":"propose", …}}`：助手自己写方案，交给宿主校验与预览。字段：`requestId`、`objective`、`summary`、`expectedRevision`、`contractRevision`、`timelineRevision`（取自 `template.json`）、`parameters`（按 `contract.schema`）、`bindings[]`、`scenes[]`（至少一项）、`missing[]`（≤ 40 条）。
- 参数里引用材料一律写 `material://<id>`，`id` 取自 `template.json` 的 `materials`；每个用到的材料都要在 `bindings` 里写一项：`{parameterPath, materialId, clipId?, role, reason}`。
- 工程选定模板后，助手应当用该模板出片；模板这一单没完成时，把原因转告用户，由用户决定，不得自行改用手写页面。
- `template.json` 合同的具体格式由宿主的模板系统定义。

### 9.4 `look`：看画面

| 写法 | 说明 |
|---|---|
| `{"look":{"times":[1.5,30,90],"width":540,"captions":false}}` | 成片秒数的画面，最多 12 个，宽 160–960；JPEG 写进 `looks/` |
| `{"look":{"sheet":{"from":58,"to":68,"count":30}}}` | 一段均匀取 2–60 格拼成一张图，带声音波形；一段最长 600 秒 |
| `{"look":{"src":"assets/…","at":1,"width":540}}` | 预览没上轨的素材（素材秒数）；不读时间线，不要 `base` |

`captions: true` 时字幕按导出样式烧进画面（PNG），回执 `notes` 写宿主看到的问题（如片段重叠、字幕遮挡）。宿主必须保证看画面与导出一致。

### 9.5 `voice`、`search`、`fetch`：没有素材时

- `voice`：`{"voice":{"text":"整份文案"}}` 配音，≤ 20000 字；音频和同名 `.vtt` 逐字字幕写进 `inbox/`，回执给出 `add` 写法。`{"voice":{"list":true,"language":"zh"}}` 列出音色；可加 `"voice":"音色id"`、`"name"`、`"q"`。
- `search`：`{"search":{"kind":"image|video|music","q":"关键词","count":12,"page":1,"orientation":"landscape|portrait|square","provider":"…"}}`，`count` ≤ 30；完整结果写进 `search/<id>.json`。
- `fetch`：`{"fetch":{"items":[{"ref":"结果里的 ref","name":"shot-1"}]}}`，一次 ≤ 20 项；下载进 `inbox/`，署名与许可写进 `inbox/sources.json`。`name` 匹配 `^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$`。

音色、素材库与价格由宿主提供，在 `mep.json` 的 `paid` 中声明。

### 9.6 付费

- 付费种类在 `mep.json` 的 `paid.kinds` 中声明。
- 宿主可以在花费前请用户确认；用户没确认时这一单不执行、不花费，回执写明原因（`needs_user`）。
- 每次花费必须写进回执的 `spent`。

## 10. mep.json（机器可读清单）

`mep.json` 是 README 与 docs 的机器可读版。必须包含 `protocol: "mep/1"`、`entry`、`docs`、`state`、`request`、`result`、`kinds`、`ops`、`limits`、`paid`、`errors`、`retry`、`heartbeat`、`order`。完整示例见 [examples/mep.json](examples/mep.json)，结构见 [schema/manifest.schema.json](schema/manifest.schema.json)。

### 默认限制

| 项 | 值 |
|---|---|
| 请求大小 | 2 MiB |
| 每单 ops | 100 |
| 写文件 `text` | 1 MiB |
| look 时间点 | 12 个，宽 160–960 |
| 连续帧 | 一段 ≤ 600 秒，2–60 格 |
| 配音文案 | 20000 字 |
| 搜索条数 | 30 |
| 每次下载 | 20 项 |
| 导入 | 3000 个文件、2 GiB |
| inbox 单个文件 | 4 GiB |
| 保留回执 | 200 份 |
| 心跳 | 每 5 秒，20 秒视为离线 |
| 单据空闲 | 24 小时 |

宿主可以放宽或收紧，以 `mep.json` 为准。

## 11. 代码场景（页面）

代码场景是放在时间线上的 HTML 文件。宿主逐帧调用页面，预览、看画面和导出必须一致。

```html
<script type="module">
window.film = {
  duration: 152.4,                 // 可选：页面自己的长度（秒）
  ready: document.fonts.ready,     // 可选：资源加载完再开画
  frame(t) {                       // t：页面自己的秒数，从 0 开始
    document.getElementById('disc').style.transform = `rotate(${t * 36}deg)`;
  },
  sfx: [{ at: 1.2, src: '../assets/imported/whoosh.mp3', gain: -3 }],  // 可选：音效
  params: {},                      // 可选：用户可调参数，同时是根上的 CSS 变量 --名字
};
</script>
```

约定：

- 画面只取决于 `t`：每次 `frame(t)` 都把整幅画面按 `t` 画全，不累加状态，不自己跑循环或自动播放。
- `frame` 可以返回 Promise，画完才取帧。WebGL 用 `preserveDrawingBuffer: true`。
- 页面大小就是画布；没画的地方透明。
- 成片秒数 = 片段 `at` + `t` − 入点。
- 宿主应当把 CSS 动画、`requestAnimationFrame`、`performance.now()`、`Date`、`Math.random` 冻结在 `t`。
- 宿主可以提供 `filmHost.line(clipId)`，返回 `{at, end, text, chars:[{c, at}]}`；页面单独打开时它不存在，页面要判断。
- `sfx` 每项写 `at`（页面秒数）与 `id`（宿主音效库编号）或 `src`（工程内路径）之一，可选 `gain`（dB）、`pan`（-1–1）、`label`。

## 12. 参考提交脚本

宿主应当在协作目录放一份 `submit.mjs`：`node submit.mjs 草稿.json` 会检查心跳与单据、核对 `base`、生成 id、原子写入请求、转述 `status.json.working` 并等回执。见 [reference/submit.mjs](reference/submit.mjs)。

## 13. 安全

- 助手只能读写协作目录。协议不提供读写本机其他目录、改模板库或导出成片的能力；导出由用户在宿主里确认。
- 口令只在复制给助手的命令里，宿主不得把它写进协作目录。
- 宿主写出的数据不得包含本机绝对路径、本地服务地址、密钥或令牌。
- 宿主应当提供「停下这单」与「整单撤销」；整单撤销遇到较新的用户修改时，保留较新的修改。
- 付费操作的确认与金额必须对用户可见。

## 14. 版本

- 请求、回执、`status.json` 都带 `"mep": 1`。`mep.json` 用 `"protocol": "mep/1"`。
- 宿主收到不认识的版本，回执 `unsupported_version`。
- 同一主版本内只增加可选字段、新的 op 或新的请求种类，并在 `mep.json` 中声明；不兼容的改动升主版本号。

## 15. 一致性要求

宿主声称支持 MEP 1，至少必须：

1. 按 §3 提供协作目录，含 `mep.json`、`README.md`、`status.json`、`project.json`、`requests/`、`results/`；
2. 实现 §4 单据与口令、§5 心跳；
3. 按 §6 校验信封与 `base`，按 §7 写回执，按 §8 使用错误码；
4. 至少实现 `ops` 中的 `move`、`set`、`remove`、`cut`、`add`，以及 `look` 的 `times`。

其他种类与 op 可选，未实现的不得出现在 `mep.json` 里。
