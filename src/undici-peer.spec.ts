import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * undici пакет не импортирует (модуль передаёт вызывающий), но работает с его
 * `Agent`, `buildConnector` и `fetch` — то есть зависит от их формы. Объявление
 * необязательного peer — граница обещания: менеджер пакетов предупредит о
 * мажоре, которого пакет не проверял.
 *
 * Обещание обязано совпадать с проверенным: каждый мажор диапазона проверен
 * матрицей потребителей (`scripts/consumer-matrix.sh`, `UNDICI_VERSIONS`), нижняя
 * граница каждого мажора — проверенная версия, и ни одна проверенная версия не
 * выпадает из диапазона. Список версий читается из самой матрицы — дубль здесь
 * разошёлся бы с ней.
 */
const ROOT = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  dependencies?: Record<string, string>;
};
const matrix = readFileSync(join(ROOT, 'scripts', 'consumer-matrix.sh'), 'utf8');

type Version = readonly [number, number, number];

const parseVersion = (text: string): Version => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (match === null) {
    throw new Error(`версия «${text}» — не вида M.m.p`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

/** `^M.m.p || ^M.m.p …` → нижние границы. Любая другая форма — отказ, а не «подходит». */
const parseCaretRange = (range: string): Version[] =>
  range.split('||').map((term) => {
    const match = /^\s*\^(\d+\.\d+\.\d+)\s*$/.exec(term);
    if (match?.[1] === undefined) {
      throw new Error(`часть диапазона «${term}» — не вида ^M.m.p: гейт её не разбирает`);
    }
    return parseVersion(match[1]);
  });

const compare = (a: Version, b: Version): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const satisfies = (version: Version, floors: readonly Version[]): boolean =>
  floors.some((floor) => floor[0] === version[0] && compare(version, floor) >= 0);

const testedVersions = (): Version[] => {
  const match = /^UNDICI_VERSIONS=\(([^)]*)\)$/m.exec(matrix);
  if (match?.[1] === undefined) {
    throw new Error('в scripts/consumer-matrix.sh нет строки UNDICI_VERSIONS=(…)');
  }
  return match[1].trim().split(/\s+/).map(parseVersion);
};

describe('peer undici совпадает с проверенным матрицей', () => {
  const range = manifest.peerDependencies?.['undici'] ?? '';

  it('undici — необязательный peer, не зависимость', () => {
    expect(range).not.toBe('');
    expect(manifest.peerDependenciesMeta?.['undici']?.optional).toBe(true);
    expect(manifest.dependencies?.['undici']).toBeUndefined();
  });

  it('матрица проверяет не меньше двух мажоров (выборка не выродилась)', () => {
    expect(new Set(testedVersions().map((version) => version[0])).size).toBeGreaterThanOrEqual(2);
  });

  it('каждая проверенная версия входит в диапазон', () => {
    const floors = parseCaretRange(range);
    const outside = testedVersions().filter((version) => !satisfies(version, floors));
    expect(outside.map((version) => version.join('.'))).toEqual([]);
  });

  it('у каждого мажора диапазона нижняя граница — проверенная версия', () => {
    const tested = testedVersions().map((version) => version.join('.'));
    const untestedFloors = parseCaretRange(range)
      .map((floor) => floor.join('.'))
      .filter((floor) => !tested.includes(floor));
    expect(untestedFloors).toEqual([]);
  });

  it('разборщик диапазона не принимает непроверенное: соседние мажоры и версии ниже границы', () => {
    const floors = parseCaretRange('^7.10.0 || ^8.0.0');
    expect(satisfies([7, 9, 9], floors)).toBe(false);
    expect(satisfies([6, 99, 0], floors)).toBe(false);
    expect(satisfies([9, 0, 0], floors)).toBe(false);
    expect(satisfies([7, 10, 0], floors)).toBe(true);
    expect(satisfies([8, 12, 4], floors)).toBe(true);
    expect(() => parseCaretRange('>=7')).toThrow('не вида ^M.m.p');
    expect(() => parseCaretRange('*')).toThrow('не вида ^M.m.p');
  });
});
