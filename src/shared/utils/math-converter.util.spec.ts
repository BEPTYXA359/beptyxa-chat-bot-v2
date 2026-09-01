import { describe, expect, it } from 'vitest';

import { convertLatexToRichMarkdown, findSafeCut, mapLatexStream } from './math-converter.util';
import { splitMessage } from './text.util';

async function collectStream(chunks: string[]): Promise<{ yields: string[]; joined: string }> {
  async function* source() {
    for (const chunk of chunks) {
      yield chunk;
    }
  }
  const yields: string[] = [];
  for await (const piece of mapLatexStream(source())) {
    yields.push(piece);
  }
  return { yields, joined: yields.join('') };
}

describe('convertLatexToRichMarkdown', () => {
  it('converts single-line display math \\[...\\]', () => {
    const input = '\\[ (5 \\times 15) - (3^2) + 2 \\]';
    expect(convertLatexToRichMarkdown(input)).toBe('$$(5 \\times 15) - (3^2) + 2$$');
  });

  it('converts display math with delimiters on their own lines', () => {
    const input = '\\[\n(12 \\times 6) - (5^2) + (12 \\div 3)\n\\]';
    expect(convertLatexToRichMarkdown(input)).toBe('$$(12 \\times 6) - (5^2) + (12 \\div 3)$$');
  });

  it('keeps multiline expressions multiline inside $$ block', () => {
    const input = '\\[\nx = 1 \\\\\ny = 2\n\\]';
    expect(convertLatexToRichMarkdown(input)).toBe('$$\nx = 1 \\\\\ny = 2\n$$');
  });

  it('puts a mid-sentence display formula on its own line', () => {
    expect(convertLatexToRichMarkdown('Ответ: [3 \\times 4] готово')).toBe(
      ['Ответ: ', '$$3 \\times 4$$', ' готово'].join('\n'),
    );
  });

  it('converts inline math \\(...\\)', () => {
    expect(convertLatexToRichMarkdown('площадь \\(a^2 + b^2\\) равна')).toBe(
      'площадь $a^2 + b^2$ равна',
    );
  });

  it('converts bare parentheticals with LaTeX into inline math', () => {
    expect(convertLatexToRichMarkdown('Шаг один (3 \\times 20 = 60), дальше больше')).toBe(
      'Шаг один $3 \\times 20 = 60$, дальше больше',
    );
  });

  it('keeps prose parentheticals without LaTeX commands', () => {
    const input = 'где (см. пункт 2) и (f(x)) расписано';
    expect(convertLatexToRichMarkdown(input)).toBe(input);
  });

  it('keeps parens inside a converted display formula intact', () => {
    expect(convertLatexToRichMarkdown('[ (3 \\times 20) + (4^2) - (15 \\div 3) + 1 ]')).toBe(
      '$$(3 \\times 20) + (4^2) - (15 \\div 3) + 1$$',
    );
  });

  it('keeps model-written inline math with parens untouched', () => {
    const input = 'равно $(a \\times b)$ точно';
    expect(convertLatexToRichMarkdown(input)).toBe(input);
  });

  it('keeps model-written $$ blocks with parens untouched', () => {
    const input = '$$f(3 \\times 4) = 12$$';
    expect(convertLatexToRichMarkdown(input)).toBe(input);
  });

  it('leaves existing $$...$$ and $...$ untouched', () => {
    const input = 'формула $$E = mc^2$$ и инлайн $x^2 + y^2$';
    expect(convertLatexToRichMarkdown(input)).toBe(input);
  });

  it('does not convert inside fenced code', () => {
    const input = '```\n\\[ (5 \\times 15) \\]\n```';
    expect(convertLatexToRichMarkdown(input)).toBe(input);
  });

  it('does not convert inside inline code', () => {
    const input = 'команда `\\(x^2\\)` в коде';
    expect(convertLatexToRichMarkdown(input)).toBe(input);
  });

  it('converts bare brackets containing LaTeX commands', () => {
    const input = '[ (12 \\times 6) - (5^2) + (12 \\div 3) ]';
    expect(convertLatexToRichMarkdown(input)).toBe('$$(12 \\times 6) - (5^2) + (12 \\div 3)$$');
  });

  it('converts each bare bracket independently, each on its own line', () => {
    const input = 'шаг 1: [3 \\times 4], шаг 2: [10 \\div 2]';
    expect(convertLatexToRichMarkdown(input)).toBe(
      ['шаг 1: ', '$$3 \\times 4$$', ', шаг 2: ', '$$10 \\div 2$$'].join('\n'),
    );
  });

  it('keeps prose brackets without LaTeX commands', () => {
    const input = 'смотри [примечание] и [раздел 2] ниже';
    expect(convertLatexToRichMarkdown(input)).toBe(input);
  });

  it('keeps markdown links', () => {
    const input = '[пример](https://example.com) и [гайд](https://t.me)';
    expect(convertLatexToRichMarkdown(input)).toBe(input);
  });

  it('keeps footnotes', () => {
    const input = 'текст[^1] и ещё[^id2]: определение';
    expect(convertLatexToRichMarkdown(input)).toBe(input);
  });

  it('leaves an unclosed display delimiter but converts inner parentheticals', () => {
    expect(convertLatexToRichMarkdown('ответ: \\[ (5 \\times 15) и всё')).toBe(
      'ответ: \\[ $5 \\times 15$ и всё',
    );
  });

  it('handles a realistic LLM reply end to end', () => {
    const input = [
      'Вычислим по шагам:',
      '',
      '\\[ (5 \\times 15) - (3^2) + 2 \\]',
      '',
      'Сначала умножение \\(5 \\times 15 = 75\\), затем вычитание.',
    ].join('\n');
    const expected = [
      'Вычислим по шагам:',
      '',
      '$$(5 \\times 15) - (3^2) + 2$$',
      '',
      'Сначала умножение $5 \\times 15 = 75$, затем вычитание.',
    ].join('\n');
    expect(convertLatexToRichMarkdown(input)).toBe(expected);
  });
});

describe('findSafeCut', () => {
  it('holds back a trailing backslash that may become a delimiter', () => {
    expect(findSafeCut('ответ \\')).toBe(6);
  });

  it('holds back a trailing dollar sign', () => {
    expect(findSafeCut('цена $')).toBe(5);
  });

  it('cuts before an unterminated \\[ region', () => {
    expect(findSafeCut('до \\[ (5 \\times')).toBe(3);
  });

  it('cuts after a complete \\[...\\] region', () => {
    expect(findSafeCut('\\[x\\] хвост')).toBe(11);
  });

  it('cuts plain text fully', () => {
    expect(findSafeCut('обычный текст 123')).toBe(17);
  });

  it('holds back an unterminated paren group that may become math', () => {
    expect(findSafeCut('ответ (3 \\times')).toBe(6);
  });

  it('cuts past a complete math parenthetical', () => {
    expect(findSafeCut('(3 \\times 4) ок')).toBe(15);
  });

  it('treats a closed non-latex parenthetical as plain text', () => {
    expect(findSafeCut('ответ (примечание) конец')).toBe(24);
  });

  it('releases the hold when a newline closes off a paren group', () => {
    expect(findSafeCut('ответ (3\nдалее')).toBe(14);
  });

  it('holds back an unterminated bare bracket', () => {
    expect(findSafeCut('шаг [3 \\times')).toBe(4);
  });

  it('cuts past a markdown link opener', () => {
    expect(findSafeCut('ссылка [текст](ура) конец')).toBe(25);
  });
});

describe('mapLatexStream', () => {
  it('converts a delimiter split across chunks', async () => {
    const { joined, yields } = await collectStream([
      '\\[ (5 \\',
      'times 15) - (3^2) + 2 \\]',
      ' готово',
    ]);
    expect(joined).toBe('$$(5 \\times 15) - (3^2) + 2$$ готово');
    for (const piece of yields) {
      expect(piece).not.toContain('\\[');
    }
  });

  it('never yields a chunk that ends mid-delimiter', async () => {
    const { yields } = await collectStream(['\\', '[x', '\\]']);
    expect(yields.join('')).toBe('$$x$$');
  });

  it('wraps a streamed display formula on its own line exactly like whole text', async () => {
    const chunks = ['Ответ: [3 \\', 'times 4] готово'];
    const { joined } = await collectStream(chunks);
    expect(joined).toBe(convertLatexToRichMarkdown(chunks.join('')));
    expect(joined).toBe(['Ответ: ', '$$3 \\times 4$$', ' готово'].join('\n'));
  });

  it('converts a parenthetical split across chunks into inline math', async () => {
    const chunks = ['шаг (3 \\', 'times 20 = 60), готово'];
    const { joined } = await collectStream(chunks);
    expect(joined).toBe('шаг $3 \\times 20 = 60$, готово');
  });

  it('flushes an unterminated region at stream end with paren conversion', async () => {
    const { joined } = await collectStream(['\\[ (5 \\times 15) без конца']);
    expect(joined).toBe('\\[ $5 \\times 15$ без конца');
  });

  it('streams plain text through unchanged', async () => {
    const { joined } = await collectStream(['Привет, ', 'мир!', ' Как дела?']);
    expect(joined).toBe('Привет, мир! Как дела?');
  });

  it('keeps LLM inline $...$ math intact across chunks', async () => {
    const { joined } = await collectStream(['$x^2 +', ' y^2$ ок']);
    expect(joined).toBe('$x^2 + y^2$ ок');
  });

  it('matches whole-text conversion for a mixed reply', async () => {
    const chunks = [
      'Решение:\n\n',
      '\\[\n(12 \\times 6)',
      ' - (5^2)\n\\]\n\nОтвет: 47, подробности \\(a \\div b\\).',
    ];
    const { joined } = await collectStream(chunks);
    expect(joined).toBe(convertLatexToRichMarkdown(chunks.join('')));
    expect(joined).toContain('$$(12 \\times 6) - (5^2)$$');
  });
});

describe('splitMessage with math blocks', () => {
  it('does not split a $$ block that crosses the length boundary', () => {
    const text = `${'а'.repeat(3990)}\n$$\nx = y\nz = w\n$$\n${'б'.repeat(50)}`;
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const intact = chunks.some((chunk) => chunk.includes('$$\nx = y\nz = w\n$$'));
    expect(intact).toBe(true);
  });

  it('does not split a \\[...\\] block that crosses the length boundary', () => {
    const text = `${'а'.repeat(3990)}\n\\[\nx = y\n\\]\n${'б'.repeat(50)}`;
    const chunks = splitMessage(text);
    const intact = chunks.some((chunk) => chunk.includes('\\[\nx = y\n\\]'));
    expect(intact).toBe(true);
  });

  it('does not split a fenced code block that crosses the length boundary', () => {
    const text = `${'а'.repeat(3990)}\n\`\`\`\nconst a = 1;\nconst b = 2;\n\`\`\`\n${'б'.repeat(50)}`;
    const chunks = splitMessage(text);
    const intact = chunks.some((chunk) => chunk.includes('```\nconst a = 1;\nconst b = 2;\n```'));
    expect(intact).toBe(true);
  });

  it('still splits plain text into multiple chunks', () => {
    const text = `${'строка'}\n`.repeat(1000);
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.map((chunk) => chunk.length).every((len) => len <= 4100)).toBe(true);
  });
});
