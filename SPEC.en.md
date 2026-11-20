# MEP 1 Specification (Motion Edit Protocol)

- Protocol identifier: `mep/1`
- Status: 1.0 final
- Reference implementation: ADuDir (阿杜导演) desktop

The key words MUST, MUST NOT, SHOULD and MAY are to be interpreted as described in RFC 2119.

Chinese version: [SPEC.md](SPEC.md). Example field values in this document are in English; hosts may write user-facing text (messages, docs) in any language.

---

## 1. Roles and terms

| Term | Meaning |
|---|---|
| Host | The editing application that implements MEP. It owns the project, validates and executes requests, and writes results. |
| Assistant | An AI assistant or program that can read and write local files. It reads the collaboration folder and writes requests. |
| Collaboration folder | The folder the host opens for one project. All MEP interaction happens inside it. |
| Order | One authorized collaboration. It starts when the user clicks "Copy command" in the host and ends when the user stops it or it sits idle too long. |
| Order key (`key`) | The order's credential. It appears only in the command the user copies to the assistant. |
| revision | The project version. It changes whenever the timeline changes. |
| Request / result | `requests/<id>.json`, written by the assistant; `results/<id>.json`, written by the host. |
| Film seconds | Seconds on the final video's timeline. Source seconds are seconds within a media file. |

## 2. Hand-off command

The user clicks "Copy command" in the host and gets one natural-language sentence to give the assistant. It MUST contain:

1. the absolute path of the collaboration folder;
2. the order key;
3. an instruction to read `README.md` first.

Reference wording:

```
Start work in this project folder: "<collaboration folder>". Order key: <key>. This is an MEP collaboration folder: read README.md first (the machine-readable agreement is mep.json), use its opening section to decide what I want, then start. Put the order key in every request; read the latest project.json before each change, submit as README describes, and never overwrite my newer edits.
```

The assistant needs no plugin, no connection setup and no session restart.

## 3. Collaboration folder layout

```
<collaboration folder>/
├── mep.json              machine-readable manifest (§10)
├── README.md             short entry point for the assistant
├── docs/                 chapters the assistant reads when needed
│   ├── timeline.md       ops and look
│   ├── roughcut.md       talking-head rough cut
│   ├── template.md       making a video with a template
│   ├── media.md          voice-over, finding media, inbox
│   └── pages.md          code scenes
├── TEMPLATE-GUIDE.md     how to work with the project's template (when one is chosen)
├── status.json           heartbeat and processing state (§5)
├── project.json          timeline and revision (read-only)
├── captions.json         final-video captions with per-character timing (read-only)
├── content.json          editable fields of code scenes (read-only)
├── template.json         the current template's contract (read-only)
├── pages/                current HTML of code scenes (read-only copies)
├── project-files/        read-only copies of project page files; media.json is the media library
├── requests/             written by the assistant
├── results/              written by the host
├── inbox/                media the assistant brings
├── looks/                frames the host renders for the assistant
├── search/               media search results
└── submit.mjs            reference submit script (§12)
```

Rules:

- Apart from `requests/` and `inbox/`, every file in the folder is maintained by the host. The assistant MUST NOT modify them.
- The host MUST write every file to a temporary name first and then rename it, so the assistant never reads half a file.
- The host SHOULD make the folder and its files readable and writable by the current user only (`0700` / `0600`).
- The host refreshes the mirrored files while the project is idle (reference implementation: checks every 2 seconds).

## 4. Orders and keys

- When the user copies the command, the host opens an order: if an order is already open it reuses its key, otherwise it generates a new one. The reference implementation uses 16 random hex characters.
- The key MUST NOT be written into the collaboration folder. The host SHOULD store orders outside the folder.
- Order states: `open`; `stopped` (the user clicked "Stop this order"); `expired` (idle longer than `idleMs`).
- Each processed request renews the order. The default `idleMs` is 24 hours.
- While the order is not `open`, every request is answered with `order_closed`. A wrong key is answered with `unauthorized`.
- After an order ends, the user copies the command again and gets a new key.

## 5. status.json (heartbeat)

```json
{
  "mep": 1,
  "alive": 1763520000000,
  "state": "open",
  "order": "o-1a2b3c4d",
  "expiresAt": 1763606400000,
  "revision": "9f3c…",
  "working": { "id": "r-01", "text": "Waiting for the user to confirm in the app", "at": 1763520000000 },
  "refused": { "id": "r-00", "code": "unauthorized", "message": "…", "at": 1763519990000 }
}
```

| Field | Meaning |
|---|---|
| `alive` | Last heartbeat, Unix milliseconds. While serving the project the host writes it at least every 5 seconds (`everyMs`). |
| `state` | `open` / `stopped` / `expired` / `offline`. The host writes `offline` immediately when it quits or the project closes. |
| `order` | Current order id, or `null`. |
| `expiresAt` | Only when `open`: when the order expires at the current idle time. |
| `revision` | The project revision the host last read. |
| `working` | The request in hand and what the host is doing (for example, waiting for user confirmation). While it is present the assistant MUST NOT resubmit. |
| `refused` | The latest request rejected because of its key or order. |

How the assistant reads it: if `alive` has not changed for more than 20 seconds (`staleMs`), the host is not running or the project is not open. If `state` is not `open`, ask the user to copy the command again.

## 6. Requests

### 6.1 Submitting

1. Read `status.json`; check the host is alive and `state` is `open`.
2. Read `project.json`; note `revision`.
3. Write `requests/<id>.tmp`, then rename it to `requests/<id>.json`.
4. Wait for `results/<id>.json`.

- `id` is the file name. It MUST match `^[A-Za-z0-9_-]{1,100}$` and be new for every request.
- A request file MUST NOT exceed 2 MiB.
- The host processes requests one at a time, in arrival order.

### 6.2 Envelope

```json
{
  "mep": 1,
  "key": "order key",
  "who": "Codex",
  "base": "revision from project.json",
  "ops": [{ "op": "move", "clip": "clip-id", "at": 1.5 }]
}
```

| Field | Required | Meaning |
|---|---|---|
| `mep` | yes | Always `1`. |
| `key` | yes | The order key, copied exactly; at most 64 characters. |
| `who` | yes | The assistant's name: 1–24 characters of letters (any script), digits, space, `.` `_` `-`; starts with a letter or digit; no leading or trailing space. |
| `base` | by kind | The `revision` that was read (16–64 lowercase hex characters). See the table below. |
| `id` | no | May be omitted; if present it MUST equal the file name. |

Each request MUST carry exactly one of these seven kinds:

| Kind | Purpose | Needs `base` | Paid | Chapter |
|---|---|---|---|---|
| `ops` | Edit the timeline, write pages, captions, animation | yes | no | docs/timeline.md |
| `roughcut` | Rough-cut talking-head footage from its transcript | yes | no | docs/roughcut.md |
| `template` | Make a video with a template | yes | `compose` is paid | docs/template.md |
| `look` | See frames of the final video or of a source file | `times` and `sheet` yes; `src` no | no | docs/timeline.md |
| `voice` | Voice-over from a script | no | yes | docs/media.md |
| `search` | Search for media | no | no | docs/media.md |
| `fetch` | Download search results into inbox | no | no | docs/media.md |

### 6.3 Version check

For a request that needs `base`, if `base` differs from the project's current `revision`, the host MUST NOT execute it and answers `conflict`. The assistant MUST NOT force-overwrite newer edits by the user or another assistant.

## 7. Results

Success:

```json
{
  "mep": 1,
  "id": "r-01",
  "ok": true,
  "at": 1763520001234,
  "revision": "revision after processing",
  "result": {},
  "changes": { "created": ["new-clip-id"], "removed": ["removed-clip-id"] },
  "spent": { "credits": 12, "order": 30 }
}
```

Failure:

```json
{
  "mep": 1,
  "id": "r-01",
  "ok": false,
  "at": 1763520001234,
  "revision": "current revision",
  "error": { "code": "conflict", "retry": "reread", "message": "what went wrong and what to do next" }
}
```

- Each id is answered exactly once and its result is never overwritten. Resubmitting an id that already has a result is answered with `id_used`.
- The host keeps at least the latest 200 results.
- `changes` appears only when timeline clips were added or removed.
- `spent` appears only when something was spent: `credits` is this request's cost (`null` if the host did not get a number), `order` is the running total for the order.
- `error.message` and `result` MUST NOT contain local paths, local service addresses, keys or tokens.
- A request that only writes files (`file`, `import`, `page`) does not change the timeline, so `revision` stays the same. This is expected.

## 8. Error codes

| code | retry | Meaning |
|---|---|---|
| `bad_request` | fix | The request's format or content is wrong |
| `unsupported_version` | fix | `"mep":1` is missing, or the host does not know the version |
| `unauthorized` | user | Wrong order key |
| `order_closed` | user | The order is stopped, expired or not open yet |
| `id_used` | fix | This id already has a result |
| `conflict` | reread | `base` is not the current revision; for template requests, the template contract, materials or timeline may also have changed |
| `clip_unavailable` | reread | The clip does not exist or is locked |
| `not_ready` | fix | The project does not meet a precondition (for example, no voice-over or captions yet) |
| `needs_user` | user | The user must confirm, decide or act in the host |
| `insufficient_credits` | user | Not enough balance |
| `busy` | later | The host is restarting, or its render engine is not ready |
| `interrupted` | reread | The host quit midway; the request may have been executed |
| `failed` | no | Internal host error |

| retry | What the assistant does |
|---|---|
| `fix` | Change the request according to `error.message` and submit with a new id |
| `reread` | Reread `project.json` (and `template.json` for template requests), use the new `revision` as `base`, submit with a new id |
| `later` | Submit the same request again later with a new id |
| `user` | Relay `error.message` to the user |
| `no` | Do not retry; relay the message to the user |

If, on restart, the host finds a request that was being processed, it MUST write an `interrupted` result for it and MUST NOT rerun it automatically.

## 9. Request kinds

### 9.1 `ops`: editing the timeline

1–100 items per request. All ops in one request are validated together, written together and undone in one step. Clips on the same track MUST NOT overlap. Locked clips MUST NOT be modified.

| op | Fields | Meaning |
|---|---|---|
| `move` | `clip`, `at`, `track?` | Move to film second `at`. `track`: a number (0 is the top), `"top"` (new top track), `"bottom"` (new bottom track; reuse the bottom track if it is already empty) |
| `set` | `clip`, `field`, `value` | `field` is one of `at` / `volume` / `speed` / `time` / `box` / `style` / `fade` / `duck` (below) |
| `remove` | `clip`, `ripple?` | `ripple: true` is a ripple delete: later clips on unlocked tracks move earlier |
| `cut` | `clip`, `at` | Split at film second `at`; the right part's id is `<original-id>-cutN`, listed in `changes.created` |
| `content` | `clip`, `path`, `value` | Change a field the template declares (see `content.json`); validated by the template's rules |
| `page` | `clip`, `text` | Replace a code scene's whole HTML (≤ 1 MiB) |
| `animation` | `clip`, `part`, `style`, `seconds?` | Clip animation; MUST be submitted in a batch of its own (§9.1.2) |
| `stage` | `w`, `h`, `fps?` | Canvas size, 64–4096 |
| `fps` | `fps` | 23.976 / 24 / 25 / 29.97 / 30 / 48 / 50 / 59.94 / 60 / 120 / `"auto"` |
| `file` | `path`, `text`, `without_template?` | Write a project page file (§9.1.3) |
| `import` | `path` | Import a file or folder under `inbox/` into the project without placing it |
| `add` | `clip`, `track?` | Add a clip (§9.1.4) |
| `subtitleStyle` | `patch` | Caption style (§9.1.5) |
| `subtitleSplit` | `clip`, `maxCells` or `line`+`before` | Split long captions |
| `translation` | `clip`, `language`, `lines` | Write caption translations |

#### 9.1.1 `set` fields

| field | value |
|---|---|
| `at` | Film seconds |
| `volume` | Linear gain: 1 is original, 0.5 ≈ -6 dB, 0 is mute, maximum 4 |
| `speed` | Playback rate multiplier |
| `time` | `[in, out]` in source seconds |
| `box` | `{x, y, w, h, r?}` in pixels and rotation degrees; `null` fills the frame again |
| `style` | A CSS declaration string, for example `"object-fit:cover;border-radius:48px"` |
| `fade` | `[fade-in seconds, fade-out seconds]` |
| `duck` | Lower this clip while someone speaks: `true`, `{"speech":-20,"pause":-14,"under":[…]}`, or `null` to turn off |

`box` and `style` stay constant for the whole clip. Motion that changes over time belongs in a code scene.

#### 9.1.2 `animation`

```json
{ "op": "animation", "clip": "visual-clip-id", "part": "loop", "style": "bounce", "seconds": 0.8 }
```

- `part`: `in` (entrance), `out` (exit), `loop` (loop or camera move).
- Entrances such as `fade` `pop` `drop`; exits such as `fade` `fall`; loops such as `bounce` `pulse` `float` `sway` `shake` `spin` `blink`; camera moves `push-in` `pull-out` `pan-left` `pan-right` `pan-up` `pan-down` use `loop`.
- `seconds`: 0.05–10 for entrance and exit, 0.2–10 for loops, omitted for camera moves. `style: "none"` removes the part.
- A request containing `animation` MUST contain only `animation` items. Hosts MAY extend the style vocabulary and declare it in `mep.json`.

#### 9.1.3 `file` and `import`

- `file.path` MUST match `^(pages|scenes|styles|scripts|data)/…\.(html|css|js|mjs|json|svg)$`, with at most 3 sub-folders; no segment may be `..` or start with `.`. `text` ≤ 1 MiB. A file with the same name is replaced whole; the host SHOULD refuse if the user edited that file since.
- `without_template: true` is used only after the user was told the chosen template cannot be used and agreed to make the video by hand.
- `import.path` MUST be under `inbox/`. A folder may hold at most 3000 files, 2 GiB, 4 levels deep. Files go to the project's `assets/imported/<relative path>`, and `result.imported` lists the mapping. Imported files are not deleted by order undo.

#### 9.1.4 `add`

```json
{ "op": "add", "clip": { "id": "player", "src": "pages/player.html", "at": 0, "time": [0, 152.4] }, "track": "top" }
```

- `clip` may only contain `id` `src` `at` `time` `volume` `speed` `box` `style`.
- `src`: a project file (a page written with `file`, `assets/…`), audio / video / image under `inbox/` (the host copies it into `assets/imported/` before placing it), or media listed in `project-files/media.json`.
- A code scene MUST have `time: [0, duration]`.
- Without `id`, the host generates one; see `changes.created`.
- `track` numbers count tracks as they are after the earlier ops in the same request.

#### 9.1.5 Captions

- `subtitleStyle.patch` accepts: `on`, `look`, `sizePct` (2–10% of the frame's short side), `weight`, `fill`, `pos {x,y}` (0–1), `stroke {widthEm,color}`, `box {color,opacity}`, `shadow`, `karaoke {mode: color|box|pop|fill, color}`, `language`, `bilingual`, `secondary {…}`, `fonts {language code: font}`. The serialized `patch` is at most 20000 bytes.
- `translation.lines[].line` is each sentence's `line` in `captions.json`; one entry per sentence, `text` ≤ 300 characters. Language codes are `en`, `zh`, `zh-TW` and so on; `zh-Hans` / `zh-Hant` are not used.
- `subtitleSplit`: `{"maxCells":14}` splits automatically at punctuation and pauses; `{"line":76100,"before":["text to split before"]}` splits by hand. Never splits inside a word; per-character timing is unchanged.

### 9.2 `roughcut`: talking-head rough cut

The assistant decides from the transcript and points only at text, never at times. The host cuts on word boundaries and tightens pauses by measured silence.

1. `{"roughcut":{"action":"read"}}`: the result gives `clipId`, `rev`, the editing rules `guide` and the transcript `transcript` with `L` line numbers. Read long transcripts in pages with `offset` from `next`; add `clipId` when there are several voice-over clips. If the voice-over has no captions yet, the host MAY ask the user to confirm and then transcribe it itself.
2. `{"roughcut":{"action":"preview","rev":"…","decision":{…}}}`: does not change the timeline; returns `kept`, the text left on each line after the cuts.
3. `action: "apply"`: the same `decision` and `rev`; undoable in one step. The host MAY require user confirmation for large cuts (reference implementation: more than 5 seconds).

`decision`:

```json
{
  "cuts": [
    { "line": "L12", "kind": "retake", "reason": "…" },
    { "line": "L20", "toLine": "L22", "kind": "aside", "reason": "…" },
    { "line": "L30", "quote": "text copied exactly from the line", "occurrence": 1, "kind": "false_start", "reason": "…" }
  ],
  "pace": "tight",
  "note": "…"
}
```

`kind`: `retake` (keep the last good take) | `false_start` | `misspeak` | `stutter` | `filler` | `aside` (bystander or off-topic). A different `rev` means the voice-over or captions changed; `read` again.

### 9.3 `template`: making a video with a template

- `{"template":{"operation":"compose","goal":"…","until":"plan"?}}`: the host composes the whole video from the voice-over and visuals on the timeline and renders it (paid). `goal` ≤ 4000 characters; `until: "plan"` returns the plan only.
- `{"template":{"operation":"propose", …}}`: the assistant writes the plan itself and hands it to the host for validation and preview. Fields: `requestId`, `objective`, `summary`, `expectedRevision`, `contractRevision`, `timelineRevision` (from `template.json`), `parameters` (per `contract.schema`), `bindings[]`, `scenes[]` (at least one), `missing[]` (≤ 40 items).
- Parameters refer to materials only as `material://<id>`, with `id` from `materials` in `template.json`. Every material used needs one entry in `bindings`: `{parameterPath, materialId, clipId?, role, reason}`.
- Once a project has a chosen template, the assistant SHOULD make the video with that template. If a template request does not complete, relay the reason to the user and let the user decide; the assistant MUST NOT switch to hand-written pages on its own.
- The exact format of the `template.json` contract is defined by the host's template system.

### 9.4 `look`: seeing frames

| Form | Meaning |
|---|---|
| `{"look":{"times":[1.5,30,90],"width":540,"captions":false}}` | Frames at these film seconds, at most 12, width 160–960; JPEGs written to `looks/` |
| `{"look":{"sheet":{"from":58,"to":68,"count":30}}}` | 2–60 evenly spaced frames from a span, tiled into one image with the audio waveform; a span is at most 600 seconds |
| `{"look":{"src":"assets/…","at":1,"width":540}}` | Preview a source file not on the timeline (source seconds); does not read the timeline, no `base` |

With `captions: true` the captions are burned in as they will be exported (PNG), and `notes` in the result lists problems the host sees (overlapping clips, captions covering content). The host MUST render looks identically to export.

### 9.5 `voice`, `search`, `fetch`: when there is no media

- `voice`: `{"voice":{"text":"the whole script"}}` creates a voice-over, ≤ 20000 characters. The audio and a same-name `.vtt` with per-character timing go into `inbox/`, and the result shows how to `add` it. `{"voice":{"list":true,"language":"zh"}}` lists voices; `"voice":"voice-id"`, `"name"` and `"q"` are optional.
- `search`: `{"search":{"kind":"image|video|music","q":"keywords","count":12,"page":1,"orientation":"landscape|portrait|square","provider":"…"}}`, `count` ≤ 30; full results go into `search/<id>.json`.
- `fetch`: `{"fetch":{"items":[{"ref":"ref from the results","name":"shot-1"}]}}`, ≤ 20 items per request; downloaded into `inbox/`, with attribution and license in `inbox/sources.json`. `name` matches `^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$`.

Voices, media libraries and prices are provided by the host and declared in `paid` in `mep.json`.

### 9.6 Paid requests

- Paid kinds are declared in `paid.kinds` in `mep.json`.
- The host MAY ask the user to confirm before spending. If the user does not confirm, the request is not executed, nothing is spent, and the result says why (`needs_user`).
- Every amount spent MUST appear in the result's `spent`.

## 10. mep.json (machine-readable manifest)

`mep.json` is the machine-readable form of README and docs. It MUST contain `protocol: "mep/1"`, `entry`, `docs`, `state`, `request`, `result`, `kinds`, `ops`, `limits`, `paid`, `errors`, `retry`, `heartbeat` and `order`. See [examples/mep.json](examples/mep.json) for a full example and [schema/manifest.schema.json](schema/manifest.schema.json) for its structure.

### Default limits

| Item | Value |
|---|---|
| Request size | 2 MiB |
| Ops per request | 100 |
| `file` text | 1 MiB |
| look times | 12, width 160–960 |
| Contact sheet | span ≤ 600 seconds, 2–60 frames |
| Voice-over script | 20000 characters |
| Search results | 30 |
| Items per fetch | 20 |
| Import | 3000 files, 2 GiB |
| Single inbox file | 4 GiB |
| Results kept | 200 |
| Heartbeat | every 5 seconds; offline after 20 seconds |
| Order idle time | 24 hours |

Hosts MAY raise or lower these; `mep.json` is authoritative.

## 11. Code scenes (pages)

A code scene is an HTML file placed on the timeline. The host calls the page frame by frame, and preview, looks and export MUST match.

```html
<script type="module">
window.film = {
  duration: 152.4,                 // optional: the page's own length in seconds
  ready: document.fonts.ready,     // optional: start drawing once assets are loaded
  frame(t) {                       // t: the page's own seconds, starting at 0
    document.getElementById('disc').style.transform = `rotate(${t * 36}deg)`;
  },
  sfx: [{ at: 1.2, src: '../assets/imported/whoosh.mp3', gain: -3 }],  // optional: sound effects
  params: {},                      // optional: user-adjustable parameters, also CSS variables --name on the root
};
</script>
```

Rules:

- The picture depends only on `t`: every `frame(t)` call draws the whole picture for `t`. No accumulated state, no own loops, no autoplay.
- `frame` may return a Promise; the frame is captured when it resolves. WebGL uses `preserveDrawingBuffer: true`.
- The page size is the canvas; anything not drawn is transparent.
- Film seconds = clip `at` + `t` − in point.
- The host SHOULD freeze CSS animations, `requestAnimationFrame`, `performance.now()`, `Date` and `Math.random` at `t`.
- The host MAY provide `filmHost.line(clipId)`, returning `{at, end, text, chars:[{c, at}]}`. It does not exist when the page is opened on its own, so pages must check for it.
- Each `sfx` entry has `at` (page seconds) and either `id` (the host's sound library id) or `src` (a project path), plus optional `gain` (dB), `pan` (-1 to 1) and `label`.

## 12. Reference submit script

The host SHOULD place a `submit.mjs` in the collaboration folder. `node submit.mjs draft.json` checks the heartbeat and order, checks `base`, generates an id, writes the request atomically, relays `status.json.working`, and waits for the result. See [reference/submit.mjs](reference/submit.mjs).

## 13. Security

- The assistant can read and write only the collaboration folder. The protocol provides no way to read or write other local folders, change the template library or export the final video; export is confirmed by the user in the host.
- The key appears only in the command copied to the assistant; the host MUST NOT write it into the collaboration folder.
- Data the host writes MUST NOT contain absolute local paths, local service addresses, keys or tokens.
- The host SHOULD provide "Stop this order" and "Undo whole order". When undoing meets a newer user edit, the newer edit is kept.
- Confirmation and amounts of paid operations MUST be visible to the user.

## 14. Versioning

- Requests, results and `status.json` all carry `"mep": 1`. `mep.json` uses `"protocol": "mep/1"`.
- A host that receives an unknown version answers `unsupported_version`.
- Within a major version, only optional fields, new ops or new request kinds are added, and they are declared in `mep.json`. Incompatible changes increase the major version.

## 15. Conformance

A host that claims MEP 1 support MUST at least:

1. provide the collaboration folder per §3, including `mep.json`, `README.md`, `status.json`, `project.json`, `requests/` and `results/`;
2. implement orders and keys (§4) and the heartbeat (§5);
3. validate the envelope and `base` per §6, write results per §7, and use the error codes in §8;
4. implement at least `move`, `set`, `remove`, `cut` and `add` in `ops`, and `times` in `look`.

Other kinds and ops are optional; ones that are not implemented MUST NOT appear in `mep.json`.
