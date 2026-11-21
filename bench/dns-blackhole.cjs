'use strict';
/**
 * Неотвечающий DNS-сервер: принимает запросы на 127.0.0.1:53 (UDP и TCP) и
 * молчит. Нужен замеру `dns-threadpool.cjs` в контейнере без сети: каждый
 * поиск имени висит до таймаута резолвера, наружу не уходит ни одного пакета.
 */
const dgram = require('node:dgram');
const net = require('node:net');

const udp = dgram.createSocket('udp4');
let received = 0;
udp.on('message', () => {
  received++;
});
udp.bind(53, '127.0.0.1', () => {
  // TCP — на случай перехода резолвера на TCP: соединение принимается и молчит.
  net.createServer(() => {}).listen(53, '127.0.0.1', () => {
    process.stdout.write('blackhole ready\n');
  });
});
process.on('SIGTERM', () => {
  process.stdout.write(`blackhole received ${received}\n`);
  process.exit(0);
});
