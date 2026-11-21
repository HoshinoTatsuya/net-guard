import { valueText } from './value-text';

/**
 * Значение настройки для текста отказа — JSON-ом, как раньше (`[]`, `"x"`,
 * `{"a":1}`). `JSON.stringify` бросает на BigInt, цикле и бросающем `toJSON`,
 * и тогда отказ «настройка неверна» подменялся бы TypeError из самой строки
 * сообщения. В этом случае — текст значения, который сам не бросает.
 */
export function shownValue(value: unknown): string {
  try {
    return String(JSON.stringify(value));
  } catch {
    return valueText(value);
  }
}
