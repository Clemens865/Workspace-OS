// Words that carry no meaning in a question, English and German (the person writes both).
const STOP = new Set(
  (
    'a an and are as at be but by can could did do does for from had has have how i if in into is it its me my no not of on or our so than that the their them then there these they this to was we were what when where which who why will with would you your ' +
    'about after all also any been before being both each few more most other over same some such only own very just should now again yet ever still please let lets us currently ' +
    'der die das den dem des ein eine einen einem einer eines und oder aber ist sind war waren wird werden wurde hat haben hatte mit von zu zur zum im in am an auf aus bei für fur über uber unter nach vor wie was wer wo wann warum welche welcher welches ich du er sie es wir ihr mein meine dein sein ihre unser nicht kein keine auch noch nur schon so dass als wenn ob bitte aktuell gerade mal'
  ).split(' '),
)

/** The meaningful words of a question, for an any-word ranked search (at most 12). */
export function askTerms(raw: string): string[] {
  const words = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length >= 2 && !STOP.has(w))
  return [...new Set(words)].slice(0, 12)
}

/**
 * A word's stem for a prefix match, so "launched" finds "launch" and "settings"
 * finds "setting". Deliberately crude (a few English/German endings, never below
 * four letters): a wrong stem only widens a prefix a little.
 */
export function stem(word: string): string {
  for (const end of ['ing', 'ed', 'es', 'en', 's']) {
    if (word.endsWith(end) && word.length - end.length >= 4) return word.slice(0, -end.length)
  }
  return word
}
