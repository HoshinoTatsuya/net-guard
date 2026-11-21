import { compileAllowedSchemes } from './compile-allowed-schemes';
import { createGuardedHttpAgent } from './guarded-agent';
import type { AllowedPorts } from './types/allowed-ports.type';

/**
 * Значение настройки, на котором JSON.stringify бросает (BigInt, цикл, бросающий
 * toJSON): отказ «настройка неверна» обязан остаться отказом с текстом, а не
 * подмениться «Do not know how to serialize a BigInt» из строки сообщения.
 */
describe('текст отказа настройки списка не бросает на значении, которое не сериализуется', () => {
  const cyclic = (): unknown => {
    const value: Record<string, unknown> = {};
    value.self = value;
    return value;
  };
  // JSON.stringify бросает на цикле, String() — на значении без прототипа: оба пути разом.
  const cyclicBare = (): unknown => {
    const value = Object.create(null) as Record<string, unknown>;
    value.self = value;
    return value;
  };

  it.each([
    ['BigInt', (): unknown => BigInt(443), '443'],
    ['цикл', cyclic, '[object Object]'],
    ['цикл без прототипа', cyclicBare, '[object Object]'],
  ])('allowedPorts: %s — понятный отказ', (_label, make, text) => {
    expect(() => createGuardedHttpAgent({ allowedPorts: make() as AllowedPorts })).toThrow(
      new Error(`allowedPorts — непустой список портов или 'any', получено ${text}`),
    );
  });

  it.each([
    ['BigInt', (): unknown => BigInt(1), '1'],
    ['цикл', cyclic, '[object Object]'],
  ])('allowedSchemes: %s — понятный отказ', (_label, make, text) => {
    // Публичный createSafeFetch раньше схем требует защищённый dispatcher — разбор настроек проверяется напрямую.
    expect(() => compileAllowedSchemes(make() as readonly string[])).toThrow(
      new Error(`allowedSchemes — непустой список схем, получено ${text}`),
    );
  });

  it('КОНТРОЛЬ: обычное неверное значение — тот же текст, что и раньше (JSON)', () => {
    expect(() => createGuardedHttpAgent({ allowedPorts: [] as unknown as AllowedPorts })).toThrow(
      new Error("allowedPorts — непустой список портов или 'any', получено []"),
    );
  });
});
