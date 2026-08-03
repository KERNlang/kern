/** Find the first KERN comment syntax that the structural parser discards. */
export function firstDiscardedCommentLine(source: string): number | null {
  const lines = source.split('\n');
  let inMultilineBlock = false;

  for (const [lineIndex, line] of lines.entries()) {
    const trimmed = line.trimStart();
    if (inMultilineBlock) {
      if (trimmed.startsWith('>>>')) inMultilineBlock = false;
      continue;
    }

    let exprDepth = 0;
    let quote: '"' | "'" | null = null;
    let styleDepth = 0;
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      const next = line[index + 1];
      const previous = index > 0 ? line[index - 1] : '';

      if (quote) {
        if (character === '\\') {
          index++;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }
      if (exprDepth > 0) {
        if (character === '{' && next === '{') {
          exprDepth++;
          index++;
        } else if (character === '}' && next === '}') {
          exprDepth--;
          index++;
        }
        continue;
      }
      if (styleDepth > 0) {
        if (character === '"' || character === "'") {
          quote = character;
        } else if (character === '{') {
          styleDepth++;
        } else if (character === '}') {
          styleDepth--;
        }
        continue;
      }

      const precededByWhitespace = index === 0 || previous === ' ' || previous === '\t';
      if ((character === '#' || (character === '/' && next === '/')) && precededByWhitespace) {
        return lineIndex + 1;
      }
      if (character === '<' && line.slice(index, index + 3) === '<<<') {
        inMultilineBlock = true;
        break;
      }
      if (character === '{' && next === '{') {
        exprDepth++;
        index++;
      } else if (character === '{') {
        styleDepth++;
      } else if (character === '"' || character === "'") {
        quote = character;
      }
    }
  }
  return null;
}
