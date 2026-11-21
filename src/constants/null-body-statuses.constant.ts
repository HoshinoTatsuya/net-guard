/**
 * Статусы без тела по спецификации fetch, которые конструктор `Response`
 * принимает: тело с ними — `TypeError`. Реализация fetch не обязана отдавать
 * у них `body === null` (подделка, полифил отдают пустой поток).
 */
export const NULL_BODY_STATUSES: readonly number[] = Object.freeze([204, 205, 304]);
