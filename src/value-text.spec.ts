import { createGuardedConnect, type UndiciConnector } from './guarded-connect';
import { createGuardedLookup } from './guarded-lookup';
import { nonPublicResolvedReason } from './non-public-resolved-reason';
import { nonPublicUrlReason } from './non-public-url-reason';
import { createSafeFetch } from './safe-fetch';
import type { FetchLike } from './types/fetch-like.type';
import { valueText } from './value-text';

const STRANGE = [
  ['без прототипа', (): unknown => Object.create(null)],
  [
    'с бросающим toString',
    (): unknown => ({
      toString: () => {
        throw new Error('toString');
      },
    }),
  ],
  [
    'с бросающим Symbol.toPrimitive',
    (): unknown => ({
      [Symbol.toPrimitive]: () => {
        throw new Error('toPrimitive');
      },
    }),
  ],
] as const;

describe('valueText: текст брошенного значения не бросает', () => {
  it('значение без прототипа — тег объекта', () => {
    expect(valueText(Object.create(null))).toBe('[object Object]');
  });

  it('бросающий toString — message, если это строка', () => {
    const value = {
      message: 'исходная причина',
      toString: () => {
        throw new Error('toString');
      },
    };
    expect(valueText(value)).toBe('исходная причина');
  });

  it('бросающий Symbol.toPrimitive — тег объекта', () => {
    const value = {
      [Symbol.toPrimitive]: () => {
        throw new Error('toPrimitive');
      },
    };
    expect(valueText(value)).toBe('[object Object]');
  });

  it('бросающий геттер message вместе с бросающим toString — запасной текст', () => {
    const value = Object.create(null, {
      message: {
        get: () => {
          throw new Error('message');
        },
      },
    });
    expect(valueText(value)).toBe('[значение без текста]');
  });

  it('обычная ошибка — «Имя: сообщение»', () => {
    expect(valueText(new TypeError('плохой аргумент'))).toBe('TypeError: плохой аргумент');
  });

  it('строка и undefined — как String()', () => {
    expect(valueText('текст')).toBe('текст');
    expect(valueText(undefined)).toBe('undefined');
  });
});

/** Базовый коннектор, который соединяет «успешно»: защита обязана отказать раньше него. */
const build = (): UndiciConnector => (_options, callback) => {
  callback(null, {});
  return {};
};

const connectWith = (
  connector: UndiciConnector,
  hostname: string,
  port: unknown,
): Promise<{ error: Error | null }> =>
  new Promise((resolve) => {
    connector({ hostname, protocol: 'https:', port: port as string }, (error) => resolve({ error }));
  });

/**
 * «Странное» значение — брошенное хуком или резолвером, переданное в настройки
 * или как цель — доходит до ветки, которая строит текст отказа. Ответ обязан
 * остаться тем же отказом с текстом, а не TypeError вместо него.
 */
describe('«странное» значение в ветке отказа — понятный отказ, а не TypeError', () => {
  it.each(STRANGE)(
    'хук onBlocked бросил значение %s — отказ в силе, предупреждение с текстом',
    async (_label, make) => {
      const warnings: string[] = [];
      jest.spyOn(process, 'emitWarning').mockImplementation((message) => {
        warnings.push(String(message));
      });
      const connector = createGuardedConnect(build, {
        onBlocked: () => {
          throw make();
        },
      }) as unknown as UndiciConnector;
      const { error } = await connectWith(connector, '127.0.0.1', 443);
      expect((error as NodeJS.ErrnoException | null)?.code).toBe('ERR_NET_GUARD_BLOCKED_DESTINATION');
      expect(warnings).toEqual([
        'net-guard: хук onBlocked бросил исключение (отказ в силе): [object Object]',
      ]);
    },
  );

  it.each(STRANGE)(
    'резолвер отказал значением %s — причина «не разрешилось» с текстом',
    async (_label, make) => {
      await expect(nonPublicResolvedReason('svc.example', () => Promise.reject(make()))).resolves.toBe(
        'имя «svc.example» не разрешилось: [object Object]',
      );
    },
  );

  it.each(STRANGE)('цель URL — значение %s — отказ «не разбирается»', (_label, make) => {
    expect(nonPublicUrlReason(make() as string)).toBe('URL «[object Object]» не разбирается');
  });

  it('порт соединения: число по valueOf вне разрешённых, toString бросает — отказ порта с текстом', async () => {
    // Number() читает valueOf (8080 — вне разрешённых), String() — бросающий toString.
    const port = {
      valueOf: () => 8080,
      toString: () => {
        throw new Error('toString');
      },
    };
    const connector = createGuardedConnect(build, { allowedPorts: [443] }) as unknown as UndiciConnector;
    const { error } = await connectWith(connector, '93.184.216.34', port);
    expect(error?.message).toContain('порт [object Object] вне разрешённых (443)');
  });

  describe('настройки', () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('не должен вызываться'));
    const dispatcher = {};

    it.each(STRANGE)('allowedSchemes — значение %s', (_label, make) => {
      expect(() => nonPublicUrlReason('https://a.example/', { allowedSchemes: [make() as string] })).toThrow(
        'allowedSchemes: «[object Object]» — не схема URL',
      );
    });

    it.each(STRANGE)('allowedPorts — значение %s', (_label, make) => {
      expect(() => nonPublicUrlReason('https://a.example/', { allowedPorts: [make() as number] })).toThrow(
        'allowedPorts: порт [object Object] — ожидается целое от 1 до 65535',
      );
    });

    it.each(STRANGE)('maxRedirects — значение %s', (_label, make) => {
      expect(() =>
        createSafeFetch({ fetch: fetchImpl, dispatcher, maxRedirects: make() as number } as never),
      ).toThrow('maxRedirects — целое от 0 до 100, получено [object Object]');
    });

    it.each(STRANGE)('lookupTimeoutMs — значение %s', (_label, make) => {
      expect(() => createGuardedLookup({ lookupTimeoutMs: make() as number })).toThrow(
        'lookupTimeoutMs — целое от 1 до 2147483647, получено [object Object]',
      );
    });

    it.each(STRANGE)('resolver — значение %s', (_label, make) => {
      expect(() => createGuardedLookup({ resolver: make() as never })).toThrow(
        'net-guard: неизвестный resolver «[object Object]»',
      );
    });

    it.each(STRANGE)('sensitiveHeaders — значение %s', (_label, make) => {
      expect(() =>
        createSafeFetch({ fetch: fetchImpl, dispatcher, sensitiveHeaders: [make() as string] } as never),
      ).toThrow('createSafeFetch: sensitiveHeaders — «[object Object]» не имя заголовка');
    });
  });
});
