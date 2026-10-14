import { config } from './config.js';
import { boot } from './index.js';
import { gatewayStatus } from './gateway/gateway.js';

boot().then(({ stop }) => {
  console.log(config.mode === 'engine'
    ? `SutraFlow engine ${config.engineId} (headless): health and automation API on http://${config.adminHost}:${config.adminPort}`
    : `SutraFlow studio:  http://${config.adminHost}:${config.adminPort}`);
  console.log(`Gateway:           ${gatewayStatus.http || '(not listening)'} ${gatewayStatus.https}`);
  if (gatewayStatus.error) console.log(`Gateway problem:   ${gatewayStatus.error}`);
  const shutdown = () => { stop().finally(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
