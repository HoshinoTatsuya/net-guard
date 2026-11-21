import { getServers, Resolver } from 'node:dns';

/**
 * Резолверы c-ares по одному на поиск. `cancel()` у c-ares отменяет ВСЕ
 * запросы резолвера, поэтому общий резолвер на процесс таймаутом одного
 * поиска отменил бы чужие. Создание стоит ~0.2 мс (канал c-ares), поэтому
 * завершённые резолверы переиспользуются; отменённые — нет (их ECANCELLED ещё
 * в пути). Серверы — `dns.getServers()` на момент поиска: новый `Resolver` не
 * видит `dns.setServers()` потребителя, а читает resolv.conf.
 */
export class CaresResolverPool {
  /** Сколько свободных резолверов держать. */
  static readonly #idleLimit = 16;
  static readonly #idle: Resolver[] = [];
  static #servers = '';

  static acquire(): Resolver {
    const servers = getServers();
    const key = servers.join(',');
    if (key !== CaresResolverPool.#servers) {
      CaresResolverPool.#idle.length = 0;
      CaresResolverPool.#servers = key;
    }
    const reused = CaresResolverPool.#idle.pop();
    if (reused !== undefined) {
      return reused;
    }
    const resolver = new Resolver();
    resolver.setServers(servers);
    return resolver;
  }

  /** Вернуть резолвер, чей поиск ЗАВЕРШИЛСЯ (не отменён); серверы сменились — не возвращается. */
  static release(resolver: Resolver): void {
    if (
      CaresResolverPool.#idle.length < CaresResolverPool.#idleLimit &&
      getServers().join(',') === CaresResolverPool.#servers
    ) {
      CaresResolverPool.#idle.push(resolver);
    }
  }
}
