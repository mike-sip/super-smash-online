/**
 * Serveur relais autonome en ligne de commande.
 *
 *   pnpm --filter @game/netcode serve -- --port 8787 [--host 0.0.0.0]
 */
import { parseArgs } from 'node:util';
import { startRelayServer } from './host.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8787' },
    host: { type: 'string', default: '0.0.0.0' },
  },
});
const port = Number.parseInt(values.port, 10);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Port invalide : ${values.port}`);
  process.exit(1);
}

const host = await startRelayServer(port, { log: (message) => console.log(message) }, values.host);
console.log(`Relais netcode à l'écoute : ws://${values.host}:${host.port}/net`);

const stop = (): void => {
  console.log('Arrêt du relais.');
  void host.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
