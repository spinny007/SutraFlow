/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/* Test-only mutual-TLS TCP proxy. It validates the SutraFlow client certificate,
 * then forwards the unchanged broker protocol to local RabbitMQ or ActiveMQ. */
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';

const [listenText, targetText, keyFile, certFile, caFile] = process.argv.slice(2);
if (!listenText || !targetText || !keyFile || !certFile || !caFile) throw new Error('usage: listenPort targetPort server.key server.crt ca.crt');
const server = tls.createServer({
  key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), ca: [fs.readFileSync(caFile)],
  requestCert: true, rejectUnauthorized: true,
}, incoming => {
  const outgoing = net.connect({ host: '127.0.0.1', port: Number(targetText) });
  incoming.pipe(outgoing).pipe(incoming);
  outgoing.on('error', () => incoming.destroy());
});
server.listen(Number(listenText), '127.0.0.1', () => console.log(`READY ${listenText}`));
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
