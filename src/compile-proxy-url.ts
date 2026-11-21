/** Адрес прокси из настроек: только `http://хост:порт` (с учётными данными или без); иначе — исключение. */
export function compileProxyUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = new URL(raw instanceof URL ? raw.href : raw);
  } catch {
    throw new Error('proxy: адрес прокси не разбирается как URL');
  }
  if (url.protocol !== 'http:') {
    throw new Error(`proxy: поддерживается HTTP-прокси с CONNECT (http://), получено ${url.protocol}`);
  }
  return url;
}
