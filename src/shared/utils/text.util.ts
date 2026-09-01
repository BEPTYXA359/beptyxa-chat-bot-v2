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

export function splitMessage(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let currentChunk = '';
  const state: BlockState = { fence: false, dollarBlock: false, bracketBlock: false };

  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    const openBefore = state.fence || state.dollarBlock || state.bracketBlock;
    const openAfter = advancesBlockState(paragraph, state);
    const overLimit = currentChunk.length + paragraph.length > maxLength;

    if (currentChunk && overLimit && !openBefore && !openAfter) {
      chunks.push(currentChunk);
      currentChunk = paragraph + '\n';
    } else {
      currentChunk += paragraph + '\n';
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk);
  }

  return chunks;
}
