// MEP 1 reference client: node submit.mjs draft.json
// 放在协作目录根部。核对心跳与单据、核对 base、生成 id、原子写入请求、等回执。
// 草稿里写 mep、key、who 和一种请求内容（ops / roughcut / template / look(times|sheet) 还要 base）。
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const STALE_MS = 20_000;          // heartbeat.staleMs
const POLL_MS = 500;
const ROUND_MS = 30 * 60 * 1000;  // 一轮最多等 30 分钟

const file = process.argv[2];
const stop = (text, code = 1) => { console.error(text); process.exit(code); };
if (!file) stop('用法：node submit.mjs draft.json');

const root = new URL('./', import.meta.url);
const read = name => fs.readFile(new URL(name, root), 'utf8').then(JSON.parse, () => null);
const draft = JSON.parse(await fs.readFile(file, 'utf8'));

if (draft.mep !== 1 || typeof draft.key !== 'string' || typeof draft.who !== 'string')
  stop('草稿要有 "mep":1、"key"（本单口令）和 "who"（你的名字）。');

const status = await read('status.json');
if (!status || !(Date.now() - status.alive < STALE_MS)) stop('宿主没在运行，或这个工程没打开：请用户在软件里打开这个工程。', 2);
if (status.state !== 'open') stop('这一单已停止或过期：请用户在软件里重新点「复制命令」，用新命令里的口令。', 2);

if (draft.ops || draft.roughcut || draft.template || (draft.look && !draft.look.src)) {
  const project = await read('project.json');
  if (draft.base !== project?.revision) stop('工程已有新修改（base 不是 project.json 现在的 revision）：重新读取后再编排，不要强行覆盖。');
}

const { id: named, ...body } = draft;
const id = named || 'r-' + randomUUID().slice(0, 12);
if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) stop('id 只能用字母、数字、- 和 _。');
if (await read('results/' + id + '.json')) stop('这个 id 已经有回执了，换一个新的 id。');

await fs.mkdir(new URL('requests/', root), { recursive: true });
await fs.writeFile(new URL('requests/' + id + '.tmp', root), JSON.stringify(body), { mode: 0o600 });
await fs.rename(new URL('requests/' + id + '.tmp', root), new URL('requests/' + id + '.json', root));

let said = '';
for (let waited = 0; ; waited += POLL_MS) {
  const result = await read('results/' + id + '.json');
  if (result) { console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; break; }
  const now = await read('status.json');
  if (now?.refused?.id === id) stop(now.refused.message);
  if (now?.working?.id === id && now.working.text !== said) { said = now.working.text; console.error('宿主：' + said); }
  if (now && !(Date.now() - now.alive < 3 * STALE_MS))
    stop('宿主停止报到了（退出了，或工程已关闭），这一单还没有回执：请用户重新打开工程；回执出来前不要重复提交同一单。', 2);
  if (waited >= ROUND_MS)
    stop('本轮 30 分钟仍未返回' + (said ? '，宿主最后的状态：' + said : '') + '。请求仍在宿主里，处理后会写入 results/' + id + '.json；请告诉用户，不要重复提交同一单。', 2);
  await new Promise(resolve => setTimeout(resolve, POLL_MS));
}
