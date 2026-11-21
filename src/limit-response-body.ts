import { NET_GUARD_ERROR_CODE } from './constants/net-guard-error-code.constant';
import { netGuardError } from './net-guard-error';

/**
 * Тело ответа с потолком: больше `maxBytes` — поток падает с
 * `ERR_NET_GUARD_RESPONSE_TOO_LARGE`, источник отменяется (соединение
 * закрывается, дочитывать бесконечный ответ некому). `done` — ровно один раз:
 * конец, ошибка, отмена читателем или превышение.
 */
export function limitResponseBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  mapError: (error: unknown) => unknown,
  done: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let total = 0;
  let finished = false;
  const finish = (): void => {
    if (!finished) {
      finished = true;
      done();
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        finish();
        controller.error(mapError(error));
        return;
      }
      if (chunk.done) {
        finish();
        controller.close();
        return;
      }
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        finish();
        controller.error(
          netGuardError(
            NET_GUARD_ERROR_CODE.responseTooLarge,
            `тело ответа длиннее потолка ${maxBytes} байт (maxResponseBytes)`,
          ),
        );
        await reader.cancel().catch(() => undefined);
        return;
      }
      controller.enqueue(chunk.value);
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}
