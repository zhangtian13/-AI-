import { writeFile } from "node:fs/promises";

const API_URL = "https://api.openai.com/v1/responses";
const ZONE = "Asia/Shanghai";
const FALLBACK_IMAGES = {
  "AI 安全": "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1200&q=85",
  "芯片 / 算力": "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=85",
  "产业 / 融资": "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=85",
  "产品 / Agent": "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=85",
  "政策 / 治理": "https://images.unsplash.com/photo-1521295121783-8a321d551ad2?auto=format&fit=crop&w=1200&q=85",
  "研究": "https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=1200&q=85",
};

function chinaDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  const value = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offsetDays));
  return value.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function cleanUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch { return ""; }
}

async function ogImage(sourceUrl) {
  try {
    const response = await fetch(sourceUrl, { headers: { "user-agent": "Mozilla/5.0 AI-Daily-News-Reader" }, signal: AbortSignal.timeout(9000) });
    const html = await response.text();
    const match = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
    return cleanUrl(match?.[1] ?? "");
  } catch { return ""; }
}

async function createDigest() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing. Add it as a GitHub Actions secret before running this workflow.");
  const reportDate = chinaDate(-1);
  const schema = {
    type: "object", additionalProperties: false,
    required: ["headline", "summary", "items"],
    properties: {
      headline: { type: "string" },
      summary: { type: "string" },
      items: {
        type: "array", minItems: 8, maxItems: 10,
        items: {
          type: "object", additionalProperties: false,
          required: ["category", "title", "summary", "sourceName", "sourceUrl"],
          properties: {
            category: { type: "string" }, title: { type: "string" }, summary: { type: "string" },
            sourceName: { type: "string" }, sourceUrl: { type: "string" },
          },
        },
      },
    },
  };
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-6-astra", store: false,
      tools: [{ type: "web_search_preview", search_context_size: "medium" }],
      instructions: "你是一位严谨的全球 AI 行业编辑。只能基于检索到的可靠来源写作，优先使用公司、研究机构、政府的原始公告；新闻媒体仅作补充。不要杜撰事实、数据、日期或链接。",
      input: `请制作北京时间 ${reportDate} 的“全球 AI 热点日报”。用简洁、自然的中文选出 8 至 10 件对 AI 行业最重要的事件，覆盖模型、安全、芯片、产品、企业、研究与监管等真实出现的主题。每条摘要约 90–120 个汉字；标题简洁；sourceUrl 必须是最直接的原文公告或报道链接。category 只能使用：AI 安全、芯片 / 算力、产业 / 融资、产品 / Agent、政策 / 治理、研究。headline 是当天的一句主题，summary 是不超过 42 个汉字的导语。`,
      text: { format: { type: "json_schema", name: "daily_ai_news", strict: true, schema } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return { reportDate, ...JSON.parse(data.output_text) };
}

function render(digest) {
  const cards = digest.items.map((item) => {
    const image = item.imageUrl || FALLBACK_IMAGES[item.category] || FALLBACK_IMAGES["产品 / Agent"];
    return `<article class="card"><img class="thumb" src="${escapeHtml(image)}" alt="${escapeHtml(item.category)} 新闻配图" loading="lazy"><div class="copy"><span class="tag">${escapeHtml(item.category)}</span><h3><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(item.title)} ↗</a></h3><p>${escapeHtml(item.summary)}</p><div class="source">来源：<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(item.sourceName)}</a></div></div></article>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="全球 AI 热点日报"><title>全球 AI 热点日报｜${digest.reportDate}</title><style>:root{--ink:#172033;--muted:#68728a;--line:#e7eaf0;--paper:#fff;--bg:#f5f7fb;--blue:#2855d9}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}a{color:inherit;text-decoration:none}.wrap{width:min(1120px,calc(100% - 32px));margin:auto}header{padding:62px 0 48px;color:#fff;background:radial-gradient(circle at 82% 18%,#587cf1 0,transparent 29%),linear-gradient(125deg,#131d42 0%,#253c8b 58%,#3565db 100%)}.eyebrow{margin:0 0 13px;font-size:13px;font-weight:700;letter-spacing:.12em;opacity:.8}h1{max-width:760px;margin:0;font-size:clamp(34px,6vw,58px);line-height:1.14;letter-spacing:-.045em}.lead{max-width:720px;margin:18px 0 0;font-size:18px;opacity:.9}.meta{display:flex;flex-wrap:wrap;gap:9px;margin-top:26px}.pill{padding:4px 11px;border:1px solid #ffffff4d;border-radius:999px;font-size:13px;background:#ffffff14}main{padding:38px 0 58px}.intro{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:23px}h2{margin:0;font-size:24px;letter-spacing:-.025em}.intro p{margin:0;color:var(--muted);font-size:14px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.card{display:flex;min-height:438px;flex-direction:column;overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--paper);box-shadow:0 8px 25px #16254b0a}.thumb{width:100%;height:148px;object-fit:cover;background:#dfe6f9}.copy{display:flex;height:100%;flex:1;flex-direction:column;padding:18px 18px 16px}.tag{display:inline-flex;align-self:flex-start;margin-bottom:9px;padding:3px 8px;border-radius:5px;color:var(--blue);background:#edf1ff;font-size:12px;font-weight:700}h3{margin:0;font-size:19px;line-height:1.4;letter-spacing:-.02em}h3 a:hover{color:var(--blue);text-decoration:underline;text-underline-offset:3px}.copy p{margin:11px 0 15px;color:#4e5870;font-size:14px;line-height:1.65}.source{margin-top:auto;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}.source a{color:var(--blue);font-weight:650}footer{padding:27px 0 45px;color:var(--muted);font-size:12px}@media(max-width:880px){.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:570px){header{padding:44px 0 38px}.wrap{width:min(100% - 24px,1120px)}.grid{grid-template-columns:1fr}.card{min-height:0}.intro{align-items:start;flex-direction:column}}</style></head><body><header><div class="wrap"><p class="eyebrow">GLOBAL AI DAILY</p><h1>全球 AI 热点日报</h1><p class="lead">${escapeHtml(digest.summary)}</p><div class="meta"><span class="pill">${digest.reportDate}</span><span class="pill">全球视角</span><span class="pill">${digest.items.length} 条精选</span></div></div></header><main class="wrap"><div class="intro"><h2>${escapeHtml(digest.headline)}</h2><p>点击标题，直达原始公告或报道</p></div><section class="grid">${cards}</section></main><footer class="wrap">编辑说明：按北京时间统计前一日新闻；图片优先取自原报道的公开封面图，无法获取时使用主题备用图。</footer></body></html>`;
}

const digest = await createDigest();
digest.items = await Promise.all(digest.items.map(async (item) => ({ ...item, imageUrl: await ogImage(item.sourceUrl) })));
await writeFile("index.html", render(digest), "utf8");
console.log(`Generated ${digest.items.length} cards for ${digest.reportDate}.`);
