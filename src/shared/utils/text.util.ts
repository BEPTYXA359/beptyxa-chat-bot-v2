interface BlockState {
  fence: boolean;
  dollarBlock: boolean;
  bracketBlock: boolean;
}

/**
 * Applies one line to the block-tracking state and returns whether an open
 * region (fenced code, `$$` block, `\[...\]` block) is active after it.
 */
function advancesBlockState(line: string, state: BlockState): boolean {
  if (state.fence) {
    if (line.includes('```')) state.fence = false;
    return state.fence;
  }

  if (line.includes('```')) {
    state.fence = true;
    return true;
  }

  const bracketOpens = (line.match(/\\\[/g) ?? []).length;
  const bracketCloses = (line.match(/\\\]/g) ?? []).length;
  if (bracketOpens > bracketCloses) state.bracketBlock = true;
  if (bracketCloses > 0) state.bracketBlock = false;

  const dollarPairs = (line.match(/\$\$/g) ?? []).length;
  if (dollarPairs % 2 === 1) state.dollarBlock = !state.dollarBlock;

  return state.fence || state.dollarBlock || state.bracketBlock;
}

/**
 * Русская плюрализация: pluralRu(2, 'игра', 'игры', 'игр') → 'игры'.
 * Учтены исключения 11–14 (pluralRu(12, ...) → 'игр').
 */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function hardSplit(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + maxLength, text.length);
    if (end - offset > 1 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) {
      end--;
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function splitLines(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const line of text.split(/(?<=\n)/)) {
    if (!line) continue;
    if (line.length > maxLength) {
      if (current) chunks.push(current);
      chunks.push(...hardSplit(line, maxLength));
      current = '';
    } else {
      if (current && current.length + line.length > maxLength) {
        chunks.push(current);
        current = '';
      }
      current += line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitCodeBlock(text: string, maxLength: number): string[] {
  const openingEnd = text.indexOf('\n');
  const closingStart = text.lastIndexOf('```');
  if (openingEnd < 0 || closingStart <= openingEnd) return hardSplit(text, maxLength);

  const opening = text.slice(0, openingEnd + 1);
  if (maxLength < opening.length + 5) return hardSplit(text, maxLength);

  const body = text.slice(opening.length, closingStart);
  const trailing = text.endsWith('\n') ? '\n' : '';
  const chunks = splitLines(body, maxLength - opening.length - 5).map(
    (piece) => `${opening}${piece}${piece.endsWith('\n') ? '' : '\n'}\`\`\``,
  );
  if (trailing) chunks[chunks.length - 1] += trailing;
  return chunks;
}

function splitMathBlock(text: string, maxLength: number): string[] {
  const opening = text.startsWith('$$') ? '$$' : '\\[';
  const closing = opening === '$$' ? '$$' : '\\]';
  const closingStart = text.lastIndexOf(closing);
  if (closingStart < opening.length) return hardSplit(text, maxLength);

  const body = text.slice(opening.length, closingStart);
  const trailing = text.slice(closingStart + closing.length);
  return [...hardSplit(body, maxLength), ...hardSplit(trailing, maxLength)];
}

function splitOversizedUnit(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  if (text.startsWith('```')) return splitCodeBlock(text, maxLength);
  if (text.startsWith('$$') || text.startsWith('\\[')) return splitMathBlock(text, maxLength);
  return hardSplit(text, maxLength);
}

function blockUnits(text: string): string[] {
  const units: string[] = [];
  const state: BlockState = { fence: false, dollarBlock: false, bracketBlock: false };
  let current = '';

  for (const line of text.split(/(?<=\n)/)) {
    if (!line) continue;
    current += line;
    if (!advancesBlockState(line, state)) {
      units.push(current);
      current = '';
    }
  }
  if (current) units.push(current);
  return units;
}

export function splitMessage(text: string, maxLength: number = 4000): string[] {
  if (maxLength < 1) throw new RangeError('maxLength должен быть положительным');
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let currentChunk = '';

  for (const unit of blockUnits(text)) {
    for (const piece of splitOversizedUnit(unit, maxLength)) {
      if (currentChunk && currentChunk.length + piece.length > maxLength) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      currentChunk += piece;
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}
