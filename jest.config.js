/**
 * Полный набор запускается ТОЛЬКО через `pnpm test` (jest-groups: группы
 * ≤300 тестов, ≤2 воркера, последовательно). Прямой `jest` — для одного-двух
 * файлов и тоже с --maxWorkers=2.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  maxWorkers: 2,
  // Потолок каждого теста и хука явный: спеки с сетью (прокси, h2c, fetch) не
  // должны висеть дольше. forceExit — процесс jest завершается после прогона
  // даже с забытым сокетом: незакрытый туннель однажды держал прогон часами.
  // Утечку видно предупреждением jest «did not exit», но очередь она не держит.
  testTimeout: 10_000,
  forceExit: true,
  clearMocks: true,
  restoreMocks: true,
};
