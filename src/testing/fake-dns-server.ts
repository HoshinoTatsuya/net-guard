import { createSocket, type Socket } from 'node:dgram';
import { isIPv4, isIPv6 } from 'node:net';

/** Запись таблицы подставного DNS: адреса имени или «молчать» (неотвечающий сервер). */
export type FakeDnsRecord = readonly string[] | 'silent';

/** Подставной DNS-сервер на 127.0.0.1 (UDP): отвечает по таблице, без сети наружу. */
export interface FakeDnsServer {
  /** `127.0.0.1:порт` — для `dns.setServers`. */
  readonly address: string;
  /** Все вопросы, пришедшие серверу: имя и тип (`A`/`AAAA`). */
  readonly questions: Array<{ readonly name: string; readonly type: string }>;
  close(): Promise<void>;
}

const TYPE_A = 1;
const TYPE_AAAA = 28;
const HEADER_BYTES = 12;
const FLAGS_ANSWER = 0x8180;
const RCODE_NXDOMAIN = 3;
const TTL_SECONDS = 60;

/** Имя вопроса: метки до нулевой; возвращает имя и смещение за ним. */
function readName(packet: Buffer, start: number): { name: string; next: number } {
  const labels: string[] = [];
  let offset = start;
  while (offset < packet.length) {
    const length = packet[offset] ?? 0;
    offset++;
    if (length === 0) {
      break;
    }
    labels.push(packet.subarray(offset, offset + length).toString('ascii'));
    offset += length;
  }
  return { name: labels.join('.').toLowerCase(), next: offset };
}

function addressBytes(address: string): Buffer {
  if (isIPv4(address)) {
    return Buffer.from(address.split('.').map(Number));
  }
  const [head = '', tail = ''] = address.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  const groups = address.includes('::')
    ? [...left, ...new Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  const bytes = Buffer.alloc(16);
  for (const [i, group] of groups.entries()) {
    bytes.writeUInt16BE(Number.parseInt(group, 16), i * 2);
  }
  return bytes;
}

/** Ответ: заголовок с тем же id, вопрос как есть, записи по таблице (или NXDOMAIN). */
function answer(
  query: Buffer,
  questionEnd: number,
  type: number,
  record: readonly string[] | undefined,
): Buffer {
  const wanted = (record ?? []).filter((address) => (type === TYPE_A ? isIPv4(address) : isIPv6(address)));
  const header = Buffer.alloc(HEADER_BYTES);
  query.copy(header, 0, 0, 2);
  header.writeUInt16BE(record === undefined ? FLAGS_ANSWER | RCODE_NXDOMAIN : FLAGS_ANSWER, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(wanted.length, 6);
  const question = query.subarray(HEADER_BYTES, questionEnd);
  const records = wanted.map((address) => {
    const data = addressBytes(address);
    const rr = Buffer.alloc(12);
    // Имя — ссылкой на вопрос (смещение 12), тип, класс IN, TTL, длина данных.
    rr.writeUInt16BE(0xc000 | HEADER_BYTES, 0);
    rr.writeUInt16BE(type, 2);
    rr.writeUInt16BE(1, 4);
    rr.writeUInt32BE(TTL_SECONDS, 6);
    rr.writeUInt16BE(data.length, 10);
    return Buffer.concat([rr, data]);
  });
  return Buffer.concat([header, question, ...records]);
}

/**
 * Поднять подставной DNS. Имя вне таблицы — NXDOMAIN; `'silent'` — сервер
 * молчит (неотвечающий DNS); адреса — ответ A/AAAA по семейству (нет адресов
 * семейства — пустой ответ, `ENODATA`).
 */
export async function startFakeDnsServer(
  table: Readonly<Record<string, FakeDnsRecord>>,
): Promise<FakeDnsServer> {
  const socket: Socket = createSocket('udp4');
  const questions: Array<{ name: string; type: string }> = [];
  socket.on('message', (query, remote) => {
    const { name, next } = readName(query, HEADER_BYTES);
    const type = query.readUInt16BE(next);
    questions.push({ name, type: type === TYPE_A ? 'A' : type === TYPE_AAAA ? 'AAAA' : String(type) });
    const record = table[name];
    if (record === 'silent') {
      return;
    }
    socket.send(answer(query, next + 4, type, record), remote.port, remote.address);
  });
  await new Promise<void>((done) => socket.bind(0, '127.0.0.1', done));
  return {
    address: `127.0.0.1:${socket.address().port}`,
    questions,
    close: () => new Promise<void>((done) => socket.close(() => done())),
  };
}
