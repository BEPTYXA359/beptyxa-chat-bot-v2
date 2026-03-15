import telegramifyMarkdown from 'telegramify-markdown';

export function splitMessage(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let currentChunk = '';

  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length > maxLength) {
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

export function formatForTelegram(text: string): string {
  return telegramifyMarkdown(text, 'remove');
}
