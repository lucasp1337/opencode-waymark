import { wordsOf } from "../../model/words";

// The fraction of the new text's distinct words (`wordsOf` of it, computed once per check) that a stored text repeats. Words are compared as
// they are, with no stopword list, so common words count like any other and only a text that
// repeats much of the new one clears a meaningful share.
export function wordShare(wanted: ReadonlySet<string>, storedText: string): number {
  if (wanted.size === 0) {
    return 0;
  }
  const stored = wordsOf(storedText);
  const shared = [...wanted].filter((word) => stored.has(word)).length;
  return shared / wanted.size;
}
