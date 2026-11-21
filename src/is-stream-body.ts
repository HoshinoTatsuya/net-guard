/**
 * Тело-поток: к редиректу оно уже прочитано, и отправить его второй раз нельзя.
 * Признак — форма, а не класс: у undici свои `FormData`/`Blob`, и белый список
 * классов отказал бы им; поток же у всех — `getReader`, асинхронный итератор
 * или `pipe` (поток Node).
 */
export function isStreamBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const candidate = body as { getReader?: unknown; pipe?: unknown; [Symbol.asyncIterator]?: unknown };
  return (
    typeof candidate.getReader === 'function' ||
    typeof candidate.pipe === 'function' ||
    typeof candidate[Symbol.asyncIterator] === 'function'
  );
}
