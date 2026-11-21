import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Код в README — выдержки из `examples/*.ts`, которые проверяет `pnpm run typecheck`
 * (tsconfig.examples.json) против исходников пакета. Спека держит связь: блок `ts`
 * README, которого нет дословно ни в одном примере, — красный тест, а не устаревшая
 * документация.
 */
const ROOT = join(__dirname, '..');
const EXAMPLES = readdirSync(join(ROOT, 'examples'))
  .filter((name) => name.endsWith('.ts'))
  .map((name) => readFileSync(join(ROOT, 'examples', name), 'utf8'));

describe.each(['README.md', 'README.ru.md'])('%s: код — выдержки из examples/', (readme) => {
  const blocks = [...readFileSync(join(ROOT, readme), 'utf8').matchAll(/```ts\n([\s\S]*?)```/g)].map(
    (match) => match[1] ?? '',
  );

  it('выборка не выродилась', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(3);
    expect(blocks.length).toBeGreaterThanOrEqual(5);
  });

  it('каждый блок ts есть дословно в одном из примеров', () => {
    expect(blocks.filter((block) => !EXAMPLES.some((source) => source.includes(block)))).toEqual([]);
  });
});
