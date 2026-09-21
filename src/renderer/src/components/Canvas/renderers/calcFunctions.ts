/**
 * Calc function catalog + the matching logic behind formula autocomplete.
 *
 * WOS-004: typing "=" offered nothing at all — no function list, no signature,
 * no wizard entry. You had to already know the name and the argument order,
 * which is exactly the knowledge a spreadsheet is supposed to supply.
 *
 * Kept as pure data + pure functions so the behaviour is testable without a
 * spreadsheet: what gets suggested, in what order, and where the replacement
 * lands in the text are all decided here, not in the component.
 *
 * The catalog is deliberately a curated shortlist rather than all ~500 Calc
 * functions. A list nobody can scan is the same as no list; these are the ones
 * that actually get typed, and the engine still accepts anything you type by
 * hand.
 */

export interface CalcFunction {
  name: string
  /** Argument list as shown in the hint, e.g. "value1; value2; …". */
  args: string
  /** One line, plain language — no spreadsheet jargon. */
  desc: string
}

export const CALC_FUNCTIONS: readonly CalcFunction[] = [
  { name: 'SUM', args: 'number1; number2; …', desc: 'Adds numbers or a range together' },
  { name: 'AVERAGE', args: 'number1; number2; …', desc: 'The mean of the values' },
  { name: 'COUNT', args: 'value1; value2; …', desc: 'How many cells contain numbers' },
  { name: 'COUNTA', args: 'value1; value2; …', desc: 'How many cells are not empty' },
  { name: 'COUNTIF', args: 'range; criteria', desc: 'Counts cells that match a condition' },
  { name: 'COUNTIFS', args: 'range1; criteria1; …', desc: 'Counts cells matching several conditions' },
  { name: 'SUMIF', args: 'range; criteria; sum range', desc: 'Adds only the cells that match a condition' },
  { name: 'SUMIFS', args: 'sum range; range1; criteria1; …', desc: 'Adds cells matching several conditions' },
  { name: 'MIN', args: 'number1; number2; …', desc: 'The smallest value' },
  { name: 'MAX', args: 'number1; number2; …', desc: 'The largest value' },
  { name: 'ROUND', args: 'number; digits', desc: 'Rounds to a number of decimal places' },
  { name: 'ROUNDUP', args: 'number; digits', desc: 'Rounds away from zero' },
  { name: 'ROUNDDOWN', args: 'number; digits', desc: 'Rounds towards zero' },
  { name: 'ABS', args: 'number', desc: 'The value without its sign' },
  { name: 'IF', args: 'test; then; otherwise', desc: 'One value if a test is true, another if not' },
  { name: 'IFS', args: 'test1; value1; …', desc: 'The first value whose test is true' },
  { name: 'IFERROR', args: 'value; value if error', desc: 'A fallback when a formula errors' },
  { name: 'AND', args: 'test1; test2; …', desc: 'True only when every test is true' },
  { name: 'OR', args: 'test1; test2; …', desc: 'True when any test is true' },
  { name: 'NOT', args: 'test', desc: 'Reverses true and false' },
  { name: 'VLOOKUP', args: 'value; range; column; exact?', desc: 'Finds a row by its first column' },
  { name: 'HLOOKUP', args: 'value; range; row; exact?', desc: 'Finds a column by its first row' },
  { name: 'XLOOKUP', args: 'value; lookup range; result range', desc: 'Finds a value and returns the match' },
  { name: 'INDEX', args: 'range; row; column', desc: 'The value at a position in a range' },
  { name: 'MATCH', args: 'value; range; type', desc: 'The position of a value in a range' },
  { name: 'CONCAT', args: 'text1; text2; …', desc: 'Joins text together' },
  { name: 'TEXTJOIN', args: 'separator; ignore empty; text1; …', desc: 'Joins text with a separator' },
  { name: 'LEFT', args: 'text; count', desc: 'Characters from the start of the text' },
  { name: 'RIGHT', args: 'text; count', desc: 'Characters from the end of the text' },
  { name: 'MID', args: 'text; start; count', desc: 'Characters from the middle of the text' },
  { name: 'LEN', args: 'text', desc: 'How many characters the text has' },
  { name: 'TRIM', args: 'text', desc: 'Removes extra spaces' },
  { name: 'UPPER', args: 'text', desc: 'Converts text to capitals' },
  { name: 'LOWER', args: 'text', desc: 'Converts text to lower case' },
  { name: 'PROPER', args: 'text', desc: 'Capitalises each word' },
  { name: 'SUBSTITUTE', args: 'text; old; new', desc: 'Replaces one piece of text with another' },
  { name: 'TODAY', args: '', desc: "Today's date" },
  { name: 'NOW', args: '', desc: 'The current date and time' },
  { name: 'DATE', args: 'year; month; day', desc: 'Builds a date from parts' },
  { name: 'YEAR', args: 'date', desc: 'The year of a date' },
  { name: 'MONTH', args: 'date', desc: 'The month of a date' },
  { name: 'DAY', args: 'date', desc: 'The day of a date' },
  { name: 'EOMONTH', args: 'date; months', desc: 'The last day of a month' },
  { name: 'NETWORKDAYS', args: 'start; end; holidays', desc: 'Working days between two dates' },
  { name: 'PMT', args: 'rate; periods; amount', desc: 'The payment for a loan' },
  { name: 'NPV', args: 'rate; value1; …', desc: 'Net present value of cash flows' },
  { name: 'IRR', args: 'values; guess', desc: 'Internal rate of return' },
  { name: 'RANK', args: 'value; range; order', desc: 'The rank of a value in a list' },
  { name: 'MEDIAN', args: 'number1; number2; …', desc: 'The middle value' },
  { name: 'STDEV', args: 'number1; number2; …', desc: 'Standard deviation of a sample' },
]

/** The word being typed, and where it starts in the text. */
export interface FormulaToken {
  /** The partial function name under the caret (upper-cased), or ''. */
  word: string
  /** Index in `text` where that word begins. */
  start: number
}

/**
 * Find the function name being typed at the caret.
 *
 * A name can start after `=` or after any operator, separator or opening
 * bracket — `=SUM(A1)+AV` should still suggest AVERAGE. Anything that is not a
 * formula (no leading `=`) suggests nothing at all, because a plain text or
 * numeric cell has no functions to offer.
 */
export function tokenAt(text: string, caret: number): FormulaToken {
  if (!text.startsWith('=')) return { word: '', start: caret }
  const upto = text.slice(0, caret)
  let i = upto.length
  while (i > 0 && /[A-Za-z.]/.test(upto[i - 1])) i--
  // The character before the word must be a formula boundary, never a digit or
  // a cell reference tail — "A1" is a reference, not a half-typed function.
  const before = i > 0 ? upto[i - 1] : '='
  if (!/[=+\-*/^(,;:<>& ]/.test(before)) return { word: '', start: caret }
  return { word: upto.slice(i).toUpperCase(), start: i }
}

/**
 * Rank matches for a partial name.
 *
 * Prefix matches come first and in catalog order, so the common functions a
 * short prefix implies (SUM before SUMIFS) stay at the top. Substring matches
 * follow, which is what makes a half-remembered name findable — typing "look"
 * still finds VLOOKUP.
 */
export function suggestFunctions(word: string, limit = 8): CalcFunction[] {
  if (!word) return []
  const w = word.toUpperCase()
  const prefix: CalcFunction[] = []
  const contains: CalcFunction[] = []
  for (const f of CALC_FUNCTIONS) {
    if (f.name.startsWith(w)) prefix.push(f)
    else if (w.length >= 2 && f.name.includes(w)) contains.push(f)
  }
  return [...prefix, ...contains].slice(0, limit)
}

/**
 * Insert a chosen function, replacing the partial name.
 *
 * Returns the new text and where the caret should sit — inside the parentheses
 * for a function that takes arguments, after them for one that doesn't, so the
 * user can keep typing either way.
 */
export function applySuggestion(
  text: string,
  token: FormulaToken,
  fn: CalcFunction,
  caret: number,
): { text: string; caret: number } {
  const head = text.slice(0, token.start)
  const tail = text.slice(caret)
  const insert = `${fn.name}()`
  const next = `${head}${insert}${tail}`
  // Inside the brackets when there are arguments to fill in; past them if not.
  const offset = fn.args ? insert.length - 1 : insert.length
  return { text: next, caret: head.length + offset }
}
