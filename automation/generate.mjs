#!/usr/bin/env node
// FarmSite generator v0.1 — лид (JSON) → index.html через Claude API.
// Использование:  node automation/generate.mjs lead.json
// Env: ANTHROPIC_API_KEY (обяз.), FARMSITE_MODEL (по умолч. claude-sonnet-5-5),
//      FARMSITE_RESEARCH=1 — включить веб‑поиск агентом (дороже, но сайт точнее).
// Пишет: sites/<YYYY-MM-DD>-<slug>/index.html и meta.json; печатает путь в stdout.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = process.env.FARMSITE_MODEL || "claude-sonnet-5-5";
const RESEARCH = process.env.FARMSITE_RESEARCH === "1";
const MAX_TOKENS = Number(process.env.FARMSITE_MAX_TOKENS || 32000);
// Цены $/1M токенов для оценки стоимости (обновите под актуальный прайс модели)
const PRICE_IN = Number(process.env.FARMSITE_PRICE_IN || 3);
const PRICE_OUT = Number(process.env.FARMSITE_PRICE_OUT || 15);

const slugify = (s) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";

export function buildBrief(lead) {
  const f = (k, label) => (lead[k] ? `- ${label}: ${lead[k]}\n` : "");
  return (
    "БРИФ ЛИДА\n" +
    f("business", "Бизнес") + f("niche", "Ниша") + f("city", "Город") +
    f("phone", "Телефон / WhatsApp") + f("email", "Email") + f("links", "Ссылки (сайт, соцсети, Maps)") +
    f("language", "Язык сайта") + f("notes", "Пожелания")
  );
}

async function callClaude(system, user, withSearch) {
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (withSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`Claude API ${res.status}: ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  // Разбираем SSE‑поток
  let text = "", usage = { input_tokens: 0, output_tokens: 0 }, buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const ev = JSON.parse(line.slice(5));
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") text += ev.delta.text;
      if (ev.type === "message_start") usage.input_tokens = ev.message.usage?.input_tokens || 0;
      if (ev.type === "message_delta" && ev.usage) {
        usage.output_tokens = ev.usage.output_tokens || usage.output_tokens;
        if (ev.usage.input_tokens) usage.input_tokens = ev.usage.input_tokens;
      }
      if (ev.type === "error") throw new Error(`Claude stream error: ${JSON.stringify(ev.error)}`);
    }
  }
  return { text, usage };
}

export function extractHtml(text) {
  const start = text.search(/<!DOCTYPE html>/i);
  const end = text.toLowerCase().lastIndexOf("</html>");
  if (start < 0 || end < 0) return null;
  return { notes: text.slice(0, start).trim(), html: text.slice(start, end + 7) };
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error("usage: node automation/generate.mjs lead.json"); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY не задан"); process.exit(1); }

  const lead = JSON.parse(fs.readFileSync(file, "utf8"));
  const slug = slugify(lead.business || "client");
  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.join(ROOT, "sites", `${date}-${slug}`);

  const system = fs.readFileSync(path.join(ROOT, "prompts/site-generator.md"), "utf8").replaceAll("{{SLUG}}", slug);
  const t0 = Date.now();
  let r, research = RESEARCH;
  try {
    r = await callClaude(system, buildBrief(lead), research);
  } catch (e) {
    if (research && e.status === 400) { // инструмент поиска недоступен — пробуем без него
      console.error("web_search недоступен, генерирую без исследования");
      research = false; r = await callClaude(system, buildBrief(lead), false);
    } else throw e;
  }
  const parsed = extractHtml(r.text);
  if (!parsed) { console.error("В ответе нет HTML. Начало ответа:\n" + r.text.slice(0, 800)); process.exit(2); }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), parsed.html);
  const cost = (r.usage.input_tokens * PRICE_IN + r.usage.output_tokens * PRICE_OUT) / 1e6;
  const meta = {
    slug, date, lead, model: MODEL, research,
    seconds: Math.round((Date.now() - t0) / 1000),
    usage: r.usage, cost_usd_estimate: Number(cost.toFixed(3)),
    agent_notes: parsed.notes,
  };
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(path.relative(ROOT, outDir));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
