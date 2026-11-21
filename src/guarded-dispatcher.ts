import { createGuardedConnect } from './guarded-connect';
import type { GuardedDispatcherOptions } from './types/guarded-dispatcher-options.type';
import type { UndiciModule } from './types/undici-module.type';

/**
 * Готовый защищённый dispatcher undici: `Agent` с коннектором, который
 * проверяет хост КАЖДОГО соединения (литералы адресов тоже — их `net`
 * соединяет без lookup) и порт, а имя разрешает защищённым lookup. Годится
 * для `undici.fetch`, `undici.request` и глобального `fetch`.
 *
 * ```ts
 * import * as undici from 'undici';
 * const dispatcher = createGuardedDispatcher(undici, { agent: { keepAliveTimeout: 10_000 } });
 * await undici.fetch(url, { dispatcher });
 * ```
 *
 * `undici` передаёт вызывающий: зависимости пакета от него нет, версия — та,
 * что у потребителя.
 */
export function createGuardedDispatcher<D>(
  undici: UndiciModule<D>,
  options: GuardedDispatcherOptions = {},
): D {
  const { agent, ...guard } = options;
  if (agent?.connect !== undefined) {
    throw new Error(
      'createGuardedDispatcher: agent.connect — коннектор защищённый, свой задаётся через options.connect',
    );
  }
  return new undici.Agent({ ...agent, connect: createGuardedConnect(undici.buildConnector, guard) });
}
