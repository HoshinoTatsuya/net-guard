import { valueText } from './value-text';

/** Целое в границах из настроек; опечатка — исключение при создании, а не «без потолка». */
export function requireInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} — целое от ${min} до ${max}, получено ${valueText(value)}`);
  }
  return value;
}
