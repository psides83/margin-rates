import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://www.tradestation.com/pricing/futures-margin-requirements/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'docs', 'data');
const historyDir = path.join(dataDir, 'history');
const latestPath = path.join(dataDir, 'latest.json');

function decodeEntities(input) {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function stripHtml(input) {
  return decodeEntities(input.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toCamelCase(input) {
  const slug = slugify(input);
  return slug.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

function extractCategoryTables(html) {
  const tokenRegex = /<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>|<table[\s\S]*?<\/table>/gi;
  const pairs = [];
  let currentCategory = 'Uncategorized';

  for (const tokenMatch of html.matchAll(tokenRegex)) {
    const token = tokenMatch[0];

    if (/^<h[1-6]/i.test(token)) {
      const heading = stripHtml(token);
      if (heading) currentCategory = heading;
      continue;
    }

    pairs.push({ category: currentCategory, tableHtml: token });
  }

  if (pairs.length === 0) throw new Error('Could not find table sections on the source page.');
  return pairs;
}

function parseTable(tableHtml, category) {
  const headerMatches = [...tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
  if (headerMatches.length === 0) throw new Error('Could not find table headers.');

  const headers = headerMatches.map((m) => stripHtml(m[1]));
  const keys = headers.map((h) => toCamelCase(h));

  const rowMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const rows = [];
  let currentCategory = category;

  for (const rowMatch of rowMatches) {
    const rowHtml = rowMatch[1];
    const cellMatches = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cellMatches.length === 0) continue;

    const values = cellMatches.map((m) => stripHtml(m[1]));
    if (values.length === 1) {
      currentCategory = values[0] || currentCategory;
      continue;
    }

    const row = { category: currentCategory };
    for (let i = 0; i < keys.length; i += 1) {
      row[keys[i]] = values[i] ?? '';
    }
    rows.push(row);
  }

  return { headers, rows };
}

function hashContent(input) {
  return createHash('sha256').update(input).digest('hex');
}

async function readExistingLatest() {
  try {
    const raw = await readFile(latestPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function timestampForFilename(d) {
  return d.toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

async function main() {
  await mkdir(historyDir, { recursive: true });

  const response = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent': 'margin-rates-personal-use-bot/1.0 (+github actions)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch source page: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const categoryTables = extractCategoryTables(html);

  let headers = null;
  const rows = [];

  for (const section of categoryTables) {
    const parsed = parseTable(section.tableHtml, section.category);
    if (!headers && parsed.headers.length > 0) headers = parsed.headers;
    rows.push(...parsed.rows);
  }

  if (rows.length === 0) {
    throw new Error('Parsed zero data rows from margin table.');
  }

  const now = new Date();
  const sourceHash = hashContent(JSON.stringify(rows));

  const payload = {
    sourceUrl: SOURCE_URL,
    fetchedAtUtc: now.toISOString(),
    sourceHash: sourceHash,
    rowCount: rows.length,
    headers: headers ?? [],
    contracts: rows,
  };

  const existing = await readExistingLatest();
  if (existing?.sourceHash === sourceHash) {
    console.log('No change detected in margin table.');
    return;
  }

  await writeFile(latestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const snapshotPath = path.join(historyDir, `${timestampForFilename(now)}.json`);
  await writeFile(snapshotPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Updated latest.json with ${rows.length} rows.`);
  console.log(`Wrote snapshot: ${path.relative(rootDir, snapshotPath)}`);
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
