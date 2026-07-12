// @ts-check
import { readFileSync, readdirSync, statSync } from 'fs';
import { createRequire } from 'module';
import { join, extname } from 'path';

const _require = createRequire(import.meta.url);

const DOCS_DIR   = process.env.DOCS_DIR || '/docs/manuals';
const CHUNK_WORDS = 400;
const OVERLAP     = 50;
const TOP_K       = 2;

const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','as','is','was','are','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','can','i',
  'you','he','she','it','we','they','me','him','her','us','them','my','your',
  'his','its','our','their','this','that','these','those','what','which','who',
  'how','when','where','why','not','no','so','then','there','up','out','if',
  'about','into','just','very','also','than','more','all','each','some','such',
]);

/** @type {{ source: string, text: string, tokens: Set<string> }[]} */
let _chunks = [];
let _loaded = false;

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function chunkText(text, source) {
  const words = text.split(/\s+/).filter(Boolean);
  const result = [];
  for (let i = 0; i < words.length; i += CHUNK_WORDS - OVERLAP) {
    const slice = words.slice(i, i + CHUNK_WORDS).join(' ');
    if (slice.trim()) {
      result.push({ source, text: slice, tokens: new Set(tokenize(slice)) });
    }
    if (i + CHUNK_WORDS >= words.length) break;
  }
  return result;
}

async function parsePdf(filePath) {
  try {
    // Use createRequire to avoid pdf-parse's debug-mode side effect in ESM
    const pdfParse = _require('pdf-parse/lib/pdf-parse.js');
    const data = await pdfParse(readFileSync(filePath));
    return data.text;
  } catch (err) {
    console.error(`RAG: PDF parse failed for ${filePath}:`, err.message);
    return '';
  }
}

export async function loadDocs() {
  _chunks = [];
  let files;
  try {
    files = readdirSync(DOCS_DIR);
  } catch {
    console.log(`RAG: ${DOCS_DIR} not found — knowledge base empty`);
    _loaded = true;
    return;
  }

  for (const file of files) {
    const filePath = join(DOCS_DIR, file);
    try {
      if (statSync(filePath).isDirectory()) continue;
      const ext = extname(file).toLowerCase();
      let text = '';

      if (ext === '.pdf') {
        text = await parsePdf(filePath);
      } else if (ext === '.md' || ext === '.txt') {
        text = readFileSync(filePath, 'utf8');
      } else {
        continue;
      }

      if (!text.trim()) continue;
      const chunks = chunkText(text, file);
      _chunks.push(...chunks);
      console.log(`RAG: ${file} → ${chunks.length} chunks`);
    } catch (err) {
      console.error(`RAG: failed to load ${file}:`, err.message);
    }
  }

  console.log(`RAG: ready — ${_chunks.length} total chunks`);
  _loaded = true;
}

/**
 * Returns a context string with the top matching chunks for the given query,
 * or an empty string if no good matches.
 */
export function getContext(query) {
  if (!_loaded || _chunks.length === 0) return '';

  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return '';

  const scored = _chunks
    .map(chunk => {
      let score = 0;
      for (const t of queryTokens) {
        if (chunk.tokens.has(t)) score++;
      }
      return { chunk, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  if (scored.length === 0) return '';

  const sources = [...new Set(scored.map(x => x.chunk.source))].join(', ');
  const body    = scored
    .map(({ chunk }) => `[${chunk.source}]\n${chunk.text}`)
    .join('\n\n---\n\n');

  return `The following is from the user's document library (source: ${sources}). ` +
    `Refer to the appliance by the name in the source document, not from the general appliance list.\n\n${body}`;
}
