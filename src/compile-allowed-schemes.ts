import { IP_ADDRESS_SYNTAX } from './constants/ip-address-syntax.constant';
import { NET_GUARD_DEFAULTS } from './constants/net-guard-defaults.constant';
import { shownValue } from './shown-value';
import { valueText } from './value-text';

/** `allowedSchemes` → множество вида `https:`; пустой список или мусор — исключение. */
export function compileAllowedSchemes(value: readonly string[] | undefined): ReadonlySet<string> {
  const schemes = value ?? NET_GUARD_DEFAULTS.allowedSchemes;
  if (!Array.isArray(schemes) || schemes.length === 0) {
    throw new Error(`allowedSchemes — непустой список схем, получено ${shownValue(value)}`);
  }
  return new Set(
    schemes.map((raw) => {
      const scheme = valueText(raw).trim().toLowerCase().replace(/:?$/, ':');
      if (!IP_ADDRESS_SYNTAX.urlScheme.test(scheme)) {
        throw new Error(`allowedSchemes: «${valueText(raw)}» — не схема URL`);
      }
      return scheme;
    }),
  );
}
