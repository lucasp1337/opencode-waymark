// One definition of a word, shared by keyword validation and message matching, so a keyword that
// can be saved can also match.
const WORD = "[\\p{L}\\p{M}\\p{N}_-]+";

// Composed form, so "é" typed one way matches "é" that arrived decomposed.
export function normalWord(word: string): string {
  return word.normalize("NFC").toLowerCase();
}

export function isWord(text: string): boolean {
  return new RegExp(`^${WORD}$`, "u").test(text.normalize("NFC"));
}

export function wordsOf(text: string): ReadonlySet<string> {
  const words = text.normalize("NFC").match(new RegExp(WORD, "gu")) ?? [];
  return new Set(words.map(normalWord));
}
