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
const explicitCategoryBySymbol = new Map([
  ['BO', 'Agriculture'], ['C', 'Agriculture'], ['CB', 'Agriculture'], ['DA', 'Agriculture'],
  ['DY', 'Agriculture'], ['KW', 'Agriculture'], ['MZC', 'Agriculture'], ['MZL', 'Agriculture'],
  ['MZM', 'Agriculture'], ['MZS', 'Agriculture'], ['MZW', 'Agriculture'], ['O', 'Agriculture'],
  ['RR', 'Agriculture'], ['S', 'Agriculture'], ['SM', 'Agriculture'], ['W', 'Agriculture'],
  ['YC', 'Agriculture'], ['YK', 'Agriculture'], ['YW', 'Agriculture'],
  ['BTC', 'Crypto'], ['ETH', 'Crypto'], ['MBT', 'Crypto'], ['MET', 'Crypto'], ['MXP', 'Crypto'],
  ['QBTC', 'Crypto'], ['QETH', 'Crypto'], ['QSOL', 'Crypto'], ['QXRP', 'Crypto'], ['XRP', 'Crypto'],
  ['RF', 'Currencies'], ['RP', 'Currencies'], ['RY', 'Currencies'], ['AD', 'Currencies'],
  ['BP', 'Currencies'], ['BR', 'Currencies'], ['CD', 'Currencies'], ['DX', 'Currencies'],
  ['E7', 'Currencies'], ['EC', 'Currencies'], ['J7', 'Currencies'], ['JY', 'Currencies'],
  ['M6A', 'Currencies'], ['M6B', 'Currencies'], ['M6E', 'Currencies'], ['MP1', 'Currencies'],
  ['NE1', 'Currencies'], ['RA', 'Currencies'], ['RU', 'Currencies'], ['SF', 'Currencies'],
  ['ATW', 'Energy'], ['BRN', 'Energy'], ['CL', 'Energy'], ['HO', 'Energy'], ['MCL', 'Energy'],
  ['MHO', 'Energy'], ['MNG', 'Energy'], ['MRB', 'Energy'], ['NG', 'Energy'], ['QH', 'Energy'],
  ['QM', 'Energy'], ['QN', 'Energy'], ['QU', 'Energy'], ['RB', 'Energy'], ['UHO', 'Energy'],
  ['UHU', 'Energy'], ['ULS', 'Energy'], ['WBS', 'Energy'],
  ['1OZ', 'Metals'], ['ALI', 'Metals'], ['GC', 'Metals'], ['HG', 'Metals'], ['HRC', 'Metals'],
  ['MGC', 'Metals'], ['MHG', 'Metals'], ['PA', 'Metals'], ['PL', 'Metals'], ['PLM', 'Metals'],
  ['QC', 'Metals'], ['QI', 'Metals'], ['QO', 'Metals'], ['SI', 'Metals'], ['SIC', 'Metals'],
  ['SIL', 'Metals'], ['UX', 'Metals'],
]);

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

function normalizeCategoryKey(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[.#]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function inferCategoryFromProduct(productDescription = '', symbolRoot = '') {
  const text = `${productDescription} ${symbolRoot}`.toLowerCase();

  if (/(bitcoin|ether|xrp|solana|crypto)/.test(text)) return 'Crypto';
  if (/(corn|soybean|wheat|oats|rice|butter|milk|whey|agriculture)/.test(text)) return 'Agriculture';
  if (/(dollar|yen|franc|peso|rand|ruble|eur\/|gbp|aud|cad|currency|forex)/.test(text)) return 'Currencies';
  if (/(crude|heating oil|natural gas|gasoline|gasoil|brent|coal|wti|energy)/.test(text)) return 'Energy';
  if (/(gold|silver|copper|platinum|palladium|uranium|aluminum|metal|steel)/.test(text)) return 'Metals';
  if (/(cattle|hogs|livestock)/.test(text)) return 'Livestock';
  if (/(cocoa|coffee|cotton|sugar|lumber|fcoj|softs|robusta)/.test(text)) return 'Softs';
  if (/(treasury|yield|federal funds|sofr|euribor|saron|sonia|gilt|bund|bobl|schatz|buxl|oat|btp|interest rate)/.test(text)) {
    return 'Interest Rates';
  }
  if (/(s&p|nasdaq|dow|russell|nikkei|dax|stoxx|vix|ftse|msci|equity|index)/.test(text)) return 'Equities';

  return null;
}

function buildCategoryMapFromFilters(html) {
  const map = new Map();
  const filterRegex =
    /<(button|a|li)[^>]*\bdata-(?:category|filter|group|sector|type|target)=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;

  for (const match of html.matchAll(filterRegex)) {
    const rawKey = match[2];
    const label = stripHtml(match[3]);
    const key = normalizeCategoryKey(rawKey);

    if (!key || !label) continue;
    if (key === 'all' || key === '*') continue;

    map.set(key, label);
  }

  return map;
}

function withDefaultCategoryFallbacks(map) {
  const defaults = {
    agriculture: 'Agriculture',
    crypto: 'Crypto',
    cryptocurrency: 'Crypto',
    currencies: 'Currencies',
    currency: 'Currencies',
    energy: 'Energy',
    equities: 'Equities',
    equity: 'Equities',
    indices: 'Indices',
    index: 'Indices',
    interestRates: 'Interest Rates',
    'interest rates': 'Interest Rates',
    livestock: 'Livestock',
    metals: 'Metals',
    softs: 'Softs',
    rates: 'Interest Rates',
  };

  for (const [key, label] of Object.entries(defaults)) {
    const normalizedKey = normalizeCategoryKey(key);
    if (!map.has(normalizedKey)) map.set(normalizedKey, label);
  }

  return map;
}

function extractAllTables(html) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]);
  if (tables.length === 0) throw new Error('Could not find table sections on the source page.');
  return tables;
}

function parseRowCategory(attrs, categoryMap) {
  const dataAttrRegex =
    /\bdata-(?:category|filter|group|sector|type|target|tags?)=["']([^"']+)["']/gi;
  for (const match of attrs.matchAll(dataAttrRegex)) {
    const key = normalizeCategoryKey(match[1]);
    if (!key) continue;
    if (categoryMap.has(key)) return categoryMap.get(key);
  }

  const classMatch = attrs.match(/\bclass=["']([^"']+)["']/i);
  if (classMatch) {
    const classTokens = classMatch[1].split(/\s+/).filter(Boolean);
    for (const token of classTokens) {
      const key = normalizeCategoryKey(token);
      if (categoryMap.has(key)) return categoryMap.get(key);
    }
  }

  return null;
}

function parseTable(tableHtml, categoryMap) {
  const headerMatches = [...tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
  if (headerMatches.length === 0) throw new Error('Could not find table headers.');

  const headers = headerMatches.map((m) => stripHtml(m[1]));
  const keys = headers.map((h) => toCamelCase(h));
  const requiredHeaders = ['productDescription', 'symbolRoot', 'intradayInitial'];
  const hasRequiredHeaders = requiredHeaders.every((header) => keys.includes(header));
  if (!hasRequiredHeaders) return { headers: [], rows: [] };

  const rowMatches = [...tableHtml.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/gi)];
  const rows = [];
  let currentCategory = 'Uncategorized';

  for (const rowMatch of rowMatches) {
    const attrs = rowMatch[1] || '';
    const rowHtml = rowMatch[2];
    const attrCategory = parseRowCategory(attrs, categoryMap);
    if (attrCategory) currentCategory = attrCategory;

    const cellMatches = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cellMatches.length === 0) continue;

    const values = cellMatches.map((m) => stripHtml(m[1]));
    if (values.length === 1) {
      const maybeCategory = normalizeCategoryKey(values[0]);
      if (categoryMap.has(maybeCategory)) currentCategory = categoryMap.get(maybeCategory);
      continue;
    }

    const row = {};
    for (let i = 0; i < keys.length; i += 1) {
      row[keys[i]] = values[i] ?? '';
    }
    const symbolRoot = row.symbolRoot || '';
    const inferredFromSymbol = explicitCategoryBySymbol.get(symbolRoot) || null;
    const inferredFromText = inferCategoryFromProduct(row.productDescription, symbolRoot);
    const resolvedCategory =
      attrCategory ||
      (currentCategory !== 'Uncategorized' ? currentCategory : null) ||
      inferredFromSymbol ||
      inferredFromText ||
      'Uncategorized';
    row.category = resolvedCategory;
    currentCategory = resolvedCategory;
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
  const categoryMap = withDefaultCategoryFallbacks(buildCategoryMapFromFilters(html));
  const tables = extractAllTables(html);

  let headers = null;
  const rows = [];

  for (const tableHtml of tables) {
    const parsed = parseTable(tableHtml, categoryMap);
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
