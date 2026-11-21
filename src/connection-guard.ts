import { isIP } from 'node:net';

import { BlockedDestinationError } from './blocked-destination.error';
import { classifyHost } from './classify-host';
import { compileAllowedPorts } from './compile-allowed-ports';
import { compilePolicy } from './compile-policy';
import type { ConnectionGuardOptions } from './connection-guard-options';
import { BLOCK_STAGE } from './constants/block-stage.constant';
import { HOST_PORT_MODE } from './constants/host-port-mode.constant';
import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';
import { createGuardedLookup } from './guarded-lookup';
import { reportBlocked } from './report-blocked';
import type { ConnectionGuard } from './types/connection-guard.type';
import { valueText } from './value-text';

/** Собрать проверку; опечатка в настройках — исключение здесь, а не на запросе. */
export function createConnectionGuard(options: ConnectionGuardOptions = {}): ConnectionGuard {
  const policy = compilePolicy(options);
  const ports = compileAllowedPorts(options.allowedPorts);
  const lookup = createGuardedLookup(options);
  const { onBlocked } = options;
  const reported = (error: BlockedDestinationError): BlockedDestinationError => {
    reportBlocked(error, onBlocked);
    return error;
  };
  return {
    lookup,
    refuse(host, port, defaultPort) {
      const reason = classifyHost(host, policy, HOST_PORT_MODE.forbid).reason;
      if (reason !== null) {
        const literal = isIP(host.replace(IP_ADDRESS_SYNTAX.brackets, '$1')) === 0 ? undefined : host;
        return reported(new BlockedDestinationError(host, reason, literal));
      }
      if (ports === null) {
        return null;
      }
      const number = port === undefined || port === null || port === '' ? defaultPort : Number(port);
      if (ports.has(number)) {
        return null;
      }
      const allowed = [...ports].join(', ');
      return reported(
        new BlockedDestinationError(
          host,
          `порт ${valueText(port)} вне разрешённых (${allowed}) — настройка allowedPorts`,
          undefined,
          BLOCK_STAGE.port,
        ),
      );
    },
    refuseSocketPath(path) {
      return reported(
        new BlockedDestinationError(
          path,
          `соединение через unix-сокет «${path}» (socketPath) — не сетевая цель`,
          undefined,
          BLOCK_STAGE.socketPath,
        ),
      );
    },
  };
}
