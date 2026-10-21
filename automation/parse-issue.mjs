#!/usr/bin/env node
// Превращает тело GitHub Issue (форма lead.yml) в lead.json.
// Использование: node automation/parse-issue.mjs < issue_body.md > lead.json
import fs from "node:fs";

const MAP = {
  "Бизнес": "business", "Ниша": "niche", "Город": "city",
  "Телефон / WhatsApp": "phone", "Email": "email",
  "Ссылки (сайт, Instagram, Google Maps)": "links",
  "Язык сайта": "language", "Пожелания клиента": "notes",
};

export function parseIssueBody(body) {
  const lead = {};
  for (const part of body.split(/^###\s+/m).slice(1)) {
    const [head, ...rest] = part.split("\n");
    const key = MAP[head.trim()];
    const val = rest.join("\n").trim();
    if (key && val && val !== "_No response_") lead[key] = val;
  }
  return lead;
}

if (process.argv[1]?.endsWith("parse-issue.mjs")) {
  const lead = parseIssueBody(fs.readFileSync(0, "utf8"));
  if (!lead.business) { console.error("В issue нет поля «Бизнес»"); process.exit(1); }
  process.stdout.write(JSON.stringify(lead, null, 2));
}
