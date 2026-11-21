import { createGuardedLookup } from './guarded-lookup';
import { nonPublicResolvedReason } from './non-public-resolved-reason';
import type { ResolveAllAddresses } from './types/resolve-all-addresses.type';

/**
 * Колбэк защищённого lookup зовётся ровно один раз, таймер потолка после
 * ответа снят и процесс не держит: повторный ответ резолвера, поздний таймер
 * и висящий таймер — три разных дефекта, каждый со своим утверждением.
 */
describe('колбэк один раз, таймеры сняты', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('резолвер ответил дважды — колбэк один', async () => {
    const twice: ResolveAllAddresses = (_host, _options, callback) => {
      callback(null, [{ address: '93.184.216.34', family: 4 }]);
      callback(null, [{ address: '10.0.0.1', family: 4 }]);
    };
    const calls: unknown[] = [];
    createGuardedLookup({ resolve: twice })('twice.example', {}, (error, address) =>
      calls.push(error ?? address),
    );
    await new Promise((done) => setImmediate(done));
    expect(calls).toEqual(['93.184.216.34']);
  });

  it('после ответа таймер потолка снят: время за потолком второго колбэка (ETIMEOUT) не даёт', () => {
    jest.useFakeTimers();
    const calls: unknown[] = [];
    const instant: ResolveAllAddresses = (_host, _options, callback) => {
      callback(null, [{ address: '93.184.216.34', family: 4 }]);
    };
    createGuardedLookup({ resolve: instant, lookupTimeoutMs: 100 })('fast.example', {}, (error, address) =>
      calls.push(error?.code ?? address),
    );
    jest.advanceTimersByTime(1_000);
    expect({ calls, timers: jest.getTimerCount() }).toEqual({ calls: ['93.184.216.34'], timers: 0 });
  });

  it('таймер потолка не держит процесс (unref): висящий резолвер не мешает выходу', () => {
    const silent: ResolveAllAddresses = () => undefined;
    const before = process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length;
    createGuardedLookup({ resolve: silent, lookupTimeoutMs: 60_000 })('hang.example', {}, () => undefined);
    const after = process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length;
    expect(after).toBe(before);
  });

  it('nonPublicResolvedReason со своим lookup: после ответа таймер снят', async () => {
    jest.useFakeTimers();
    const pending = nonPublicResolvedReason('fast.example', async () => [{ address: '93.184.216.34' }], {
      lookupTimeoutMs: 100,
    });
    await jest.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('nonPublicResolvedReason встроенным резолвером: после ответа таймер снят', async () => {
    jest.useFakeTimers();
    const resolve4 = jest
      .spyOn(require('node:dns').Resolver.prototype, 'resolve4')
      .mockImplementation((_host: unknown, callback: unknown) =>
        (callback as (e: null, a: string[]) => void)(null, ['93.184.216.34']),
      );
    const resolve6 = jest
      .spyOn(require('node:dns').Resolver.prototype, 'resolve6')
      .mockImplementation((_host: unknown, callback: unknown) =>
        (callback as (e: Error) => void)(Object.assign(new Error('nodata'), { code: 'ENODATA' })),
      );
    await expect(nonPublicResolvedReason('fast.example')).resolves.toBeNull();
    expect({
      timers: jest.getTimerCount(),
      calls: resolve4.mock.calls.length + resolve6.mock.calls.length,
    }).toEqual({
      timers: 0,
      calls: 2,
    });
    jest.restoreAllMocks();
  });
});
