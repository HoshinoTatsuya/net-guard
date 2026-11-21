import { deepFreeze } from '../deep-freeze';

/**
 * Службы метаданных облаков: имена, IPv4 и IPv6, по которым инстанс получает
 * учётные данные и настройки. Главная цель SSRF в облаке. Каждая запись
 * закрыта встроенной политикой — это проверяет тест (`cloud-metadata.spec.ts`):
 * адрес вне закрытых диапазонов (Azure WireServer 168.63.129.16 — публичный
 * диапазон) или имя в публичной зоне (`metadata.tencentyun.com`) внесены во
 * встроенные списки явно.
 *
 * Справочник, а не политика: вне встроенной политики ничего не открывает.
 * Удобен для своих проверок и для разбора отказов (`onBlocked`).
 */
export const CLOUD_METADATA_ENDPOINTS = [
  {
    provider: 'aws',
    names: ['instance-data', 'instance-data.ec2.internal'],
    // IMDS; учётные данные задач ECS; EKS Pod Identity.
    ipv4: ['169.254.169.254', '169.254.170.2', '169.254.170.23'],
    ipv6: ['fd00:ec2::254', 'fd00:ec2::23'],
  },
  {
    provider: 'gcp',
    names: ['metadata.google.internal', 'metadata'],
    ipv4: ['169.254.169.254'],
    ipv6: ['fd20:ce::254'],
  },
  {
    provider: 'azure',
    names: [],
    // IMDS; WireServer (агент гостя, расширения) — адрес из публичного диапазона.
    ipv4: ['169.254.169.254', '168.63.129.16'],
    ipv6: [],
  },
  {
    provider: 'yandex-cloud',
    // Формат, совместимый с GCE, — по тому же имени.
    names: ['metadata.google.internal'],
    ipv4: ['169.254.169.254'],
    ipv6: [],
  },
  {
    provider: 'alibaba-cloud',
    names: [],
    ipv4: ['100.100.100.200'],
    ipv6: [],
  },
  {
    provider: 'oracle-cloud',
    names: [],
    ipv4: ['169.254.169.254', '192.0.0.192'],
    ipv6: [],
  },
  {
    provider: 'digitalocean',
    names: [],
    ipv4: ['169.254.169.254'],
    ipv6: [],
  },
  {
    provider: 'tencent-cloud',
    // Публичное имя, которое внутри облака резолвится в link-local.
    names: ['metadata.tencentyun.com'],
    ipv4: ['169.254.0.23'],
    ipv6: [],
  },
  {
    provider: 'openstack',
    names: [],
    ipv4: ['169.254.169.254'],
    ipv6: ['fe80::a9fe:a9fe'],
  },
] as const;

deepFreeze(CLOUD_METADATA_ENDPOINTS);
