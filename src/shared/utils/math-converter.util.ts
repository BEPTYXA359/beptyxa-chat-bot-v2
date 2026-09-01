/**
 * Converts LLM LaTeX output into Telegram Rich Markdown math syntax.
 *
 * Telegram rich messages render formulas natively ("Formula source is treated
 * as raw LaTeX"): `$$...$$` for display math and `$...$` for inline math.
 * LLMs emit `\[...\]`, `\(...\)` and bare bracket/paren groups instead, so
 * only the delimiters need rewriting — the expression body stays as-is.
 *
 * Display math is always placed on its own line ("на всю строку"); inline
 * math stays in the text flow. Every produced formula is hidden behind a
 * placeholder so later heuristics cannot nest inside it.
 */

// Complete fenced code blocks are never touched (raw LaTeX inside ``` fences
// would not render as a formula anyway).
const FENCED_CODE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;

// Math already written in Telegram syntax is kept verbatim and hidden from
// the heuristics below so they cannot corrupt its contents.
const DISPLAY_DOLLAR_RE = /\$\$[\s\S]*?\$\$/g;
const INLINE_DOLLAR_RE = /\$([^$\n]+)\$/g;

const DISPLAY_BRACKET_RE = /\\\[([\s\S]*?)\\\]/g;
const INLINE_PAREN_RE = /\\\(([\s\S]*?)\\\)/g;

// Bare bracket groups [...] become display math and bare parentheticals (...)
// become inline math only when the content looks like LaTeX (contains a
// backslash command). This keeps prose brackets, links "[text](url)",
// footnotes "[^id]" and "(f(x))" intact.
const BARE_BRACKET_RE = /\[([^[\]\n]+)\](?!\()/g;
const BARE_PAREN_RE = /\(([^()\n]+)\)/g;
const LATEX_COMMAND_RE = /\\[a-zA-Z]+/;

// NUL never appears in LLM output, so NUL-wrapped indices are collision-free
// stand-ins for regions that must not be re-processed.
const placeholder = (index: number): string => `\u0000${index}\u0000`;

function formatDisplayMath(expr: string): string {
  if (expr.includes('\n')) {
    return `$$\n${expr}\n$$`;
  }
  return `$$${expr}$$`;
}

/**
 * Puts a display formula on its own line: adds a newline whenever non-space
 * text precedes or follows it on the same line. `atLineStart` tells whether
 * the text before the match is known to include the whole current line
 * (whole-message conversion) or the piece may continue a longer line
 * (streaming case, where the carried-over prefix is unknown).
 */
function ownLineWrap(
  formatted: string,
  source: string,
  offset: number,
  length: number,
  atLineStart: boolean,
): string {
  const before = source.slice(0, offset);
  const lastBreak = before.lastIndexOf('\n');
  // "x" stands for text carried over from a previous streamed piece: it is
  // known to exist, though its contents are unavailable.
  const lineBefore = lastBreak === -1 ? (atLineStart ? before : 'x') : before.slice(lastBreak + 1);
  const after = source.slice(offset + length);
  const nextBreak = after.indexOf('\n');
  const lineAfter = nextBreak === -1 ? after : after.slice(0, nextBreak);
  const prefix = lineBefore.trim() ? '\n' : '';
  const suffix = lineAfter.trim() ? '\n' : '';
  return `${prefix}${formatted}${suffix}`;
}

export function convertLatexToRichMarkdown(text: string, atLineStart = true): string {
  const hidden = new Map<string, string>();
  const hide = (value: string): string => {
    const key = placeholder(hidden.size);
    hidden.set(key, value);
    return key;
  };

  let out = text.replace(FENCED_CODE_RE, hide).replace(INLINE_CODE_RE, hide);
  out = out.replace(DISPLAY_DOLLAR_RE, hide);
  out = out.replace(INLINE_DOLLAR_RE, (match, content: string) => {
    // "$5, $10" style currency spans are padded with spaces — leave them.
    if (content.startsWith(' ') || content.endsWith(' ')) return match;
    return hide(match);
  });

  out = out.replace(DISPLAY_BRACKET_RE, (match, expr: string, offset: number) => {
    const trimmed = expr.trim();
    if (!trimmed) return match;
    return hide(ownLineWrap(formatDisplayMath(trimmed), out, offset, match.length, atLineStart));
  });

  out = out.replace(INLINE_PAREN_RE, (match, expr: string) => {
    const trimmed = expr.trim();
    return trimmed ? hide(`$${trimmed}$`) : match;
  });

  out = out.replace(BARE_BRACKET_RE, (match, content: string, offset: number) => {
    const trimmed = content.trim();
    if (!trimmed || trimmed.startsWith('^')) return match;
    if (!LATEX_COMMAND_RE.test(trimmed)) return match;
    return hide(ownLineWrap(formatDisplayMath(trimmed), out, offset, match.length, atLineStart));
  });

  out = out.replace(BARE_PAREN_RE, (match, content: string) => {
    const trimmed = content.trim();
    if (!LATEX_COMMAND_RE.test(trimmed)) return match;
    return hide(`$${trimmed}$`);
  });

  for (const [key, value] of hidden) {
    out = out.replaceAll(key, () => value);
  }
  return out;
}

/**
 * Reusable converter that remembers whether the previously converted text
 * ended mid-line, so streamed pieces are wrapped on own lines exactly like
 * the whole message would be.
 */
export function createLatexConverter(): (piece: string) => string {
  let atLineStart = true;
  return (piece: string): string => {
    const result = convertLatexToRichMarkdown(piece, atLineStart);
    if (result) atLineStart = result.endsWith('\n');
    return result;
  };
}

/**
 * Finds the longest prefix of the buffer that ends outside every math/code
 * region and not in the middle of a potential delimiter (`\`, `$`, backtick,
 * bare `(`/`[` that may still close into a formula). Text from the cut
 * position onwards must stay buffered until more chunks arrive, otherwise a
 * delimiter split across chunks would never be converted.
 */
export function findSafeCut(buffer: string): number {
  let i = 0;
  let lastSafe = 0;
  const n = buffer.length;

  while (i < n) {
    const ch = buffer[i];

    if (ch === '\\') {
      const next = buffer[i + 1];
      if (next === '[' || next === '(') {
        const closer = next === '[' ? '\\]' : '\\)';
        const end = buffer.indexOf(closer, i + 2);
        if (end === -1) return lastSafe;
        i = end + 2;
      } else if (next === undefined) {
        return lastSafe;
      } else {
        i += 2;
      }
      lastSafe = i;
      continue;
    }

    if (ch === '$') {
      if (buffer[i + 1] === '$') {
        const end = buffer.indexOf('$$', i + 2);
        if (end === -1) return lastSafe;
        i = end + 2;
      } else if (buffer[i + 1] === undefined) {
        return lastSafe;
      } else {
        const end = buffer.indexOf('$', i + 1);
        if (end === -1) return lastSafe;
        i = end + 1;
      }
      lastSafe = i;
      continue;
    }

    if (ch === '`') {
      if (buffer.startsWith('```', i)) {
        const end = buffer.indexOf('```', i + 3);
        if (end === -1) return lastSafe;
        i = end + 3;
      } else {
        const end = buffer.indexOf('`', i + 1);
        if (end === -1) return lastSafe;
        i = end + 1;
      }
      lastSafe = i;
      continue;
    }

    if (ch === '(' || ch === '[') {
      const closer = ch === '(' ? ')' : ']';
      let end = -1;
      let invalidated = false;
      let j = i + 1;
      while (j < n) {
        const c = buffer[j];
        if (c === closer) {
          end = j;
          break;
        }
        // A newline or a nested same-kind opener means this opener can never
        // form a single-line math group — treat it as ordinary text.
        if (c === '\n' || c === ch || (ch === '[' && c === '(')) {
          invalidated = true;
          break;
        }
        j += 1;
      }

      if (end === -1 && !invalidated) return lastSafe;

      const isLink = end !== -1 && ch === '[' && buffer[end + 1] === '(';
      if (end === -1 || isLink || !LATEX_COMMAND_RE.test(buffer.slice(i + 1, end))) {
        i += 1;
      } else {
        i = end + 1;
      }
      lastSafe = i;
      continue;
    }

    i += 1;
    lastSafe = i;
  }

  return lastSafe;
}

/**
 * Stateful converter for streamed LLM chunks. Emits only converted text that
 * is guaranteed not to be cut inside a math region; the tail is flushed
 * (and converted) once the source is exhausted, so the final accumulated
 * message — which is what Telegram persists — is always fully converted.
 */
export async function* mapLatexStream(source: AsyncIterable<string>): AsyncGenerator<string> {
  const convert = createLatexConverter();
  let buffer = '';

  for await (const chunk of source) {
    buffer += chunk;
    const cut = findSafeCut(buffer);
    if (cut === 0) continue;
    const safe = buffer.slice(0, cut);
    buffer = buffer.slice(cut);
    yield convert(safe);
  }

  if (buffer) {
    yield convert(buffer);
  }
}
