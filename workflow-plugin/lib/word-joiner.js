'use strict';
// Shared by the isolated renderer and Node: preview, SRT and native jobs must agree.
(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.amllTextFormatting = api;
})(globalThis, () => {
  function options(settings = {}) {
    const joinerMode = settings.joinerMode || 'auto';
    const wordSeparator = settings.wordSeparator ?? '';
    if (!['auto', 'custom'].includes(joinerMode)) throw new Error('无效的歌词连接符模式');
    if (typeof wordSeparator !== 'string' || [...wordSeparator].length > 32 || /[|\r\n\u0000-\u001f\u007f]/u.test(wordSeparator)) {
      throw new Error('连接符最多 32 个字符，不能包含 |、换行或控制字符');
    }
    return { joinerMode, wordSeparator };
  }
  function sourceGaps(line) {
    const text = line.text || '', gaps = [];
    let cursor = 0;
    for (const word of line.words) {
      const position = text.indexOf(word.text, cursor);
      if (position < 0) return Array(line.words.length + 1).fill('');
      gaps.push(text.slice(cursor, position)); cursor = position + word.text.length;
    }
    gaps.push(text.slice(cursor));
    return gaps;
  }
  function needsEnglishSpace(left, right) {
    if (/\s$/u.test(left) || /^\s/u.test(right)) return false;
    // Character-timed English is not a sequence of separate one-letter words.
    const letters = value => (value.match(/[\p{Script=Latin}\p{N}]/gu) || []).length;
    if (letters(left) <= 1 && letters(right) <= 1) return false;
    return /[\p{Script=Latin}\p{N}]\p{M}*[,.;:!?…)'”’\]]*$/u.test(left)
      && /^[\("“\[]*[\p{Script=Latin}\p{N}]/u.test(right);
  }
  function formatLine(line, settings = {}) {
    const { joinerMode, wordSeparator } = options(settings);
    if (!line.words?.length) {
      // Untimed lines have no word boundaries to infer. Replace existing horizontal
      // word separators only; never invent character timing or remove line breaks.
      const text = joinerMode === 'custom' ? line.text.replace(/(\S)[^\S\r\n]+(?=\S)/gu, (_, left) => left + wordSeparator) : line.text;
      return { ...line, text, words: (line.words || []).map(word => ({ ...word })) };
    }
    const gaps = sourceGaps(line);
    const words = line.words.map((word, index) => {
      let text = word.text;
      if (joinerMode === 'custom') {
        if (index > 0) text = text.trimStart();
        if (index < line.words.length - 1) text = text.trimEnd();
      }
      return { ...word, text };
    });
    words[0].text = gaps[0] + words[0].text;
    for (let i = 0; i < words.length - 1; i++) {
      let gap = gaps[i + 1];
      if (joinerMode === 'custom') gap = gap.replace(/\s/gu, '') + wordSeparator;
      else if (needsEnglishSpace(words[i].text + gap, words[i + 1].text)) gap += ' ';
      // Attach the separator to its preceding timestamped word, not a new fake word.
      words[i].text += gap;
    }
    words[words.length - 1].text += gaps[gaps.length - 1];
    return { ...line, words, text: words.map(word => word.text).join('') };
  }
  function formatDocument(document, settings = {}) {
    options(settings);
    return { ...document, lines: document.lines.map(line => formatLine(line, settings)) };
  }
  return { options, formatLine, formatDocument };
});
