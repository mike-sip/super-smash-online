/** Les modules sont lus dans leurs sources, par leurs points d'entrée publics, comme dans les démos. */
import { fileURLToPath } from 'node:url';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export const aliases = [
  {
    find: /^@game\/sim-core\/testing$/,
    replacement: source('../../packages/sim-core/src/testing/fixtures.ts'),
  },
  { find: /^@game\/sim-core$/, replacement: source('../../packages/sim-core/src/index.ts') },
  { find: /^@game\/render$/, replacement: source('../../packages/render/src/index.ts') },
  { find: /^@game\/input$/, replacement: source('../../packages/input/src/index.ts') },
  { find: /^@game\/netcode$/, replacement: source('../../packages/netcode/src/index.ts') },
  {
    find: /^@game\/accounts-client$/,
    replacement: source('../../packages/accounts-client/src/index.ts'),
  },
  {
    find: /^@game\/accounts\/protocol$/,
    replacement: source('../../packages/accounts/src/protocol.ts'),
  },
  { find: /^@game\/ranking\/client$/, replacement: source('../../packages/ranking/src/client.ts') },
  {
    find: /^@game\/ranking\/protocol$/,
    replacement: source('../../packages/ranking/src/protocol.ts'),
  },
  { find: /^@game\/lobby\/client$/, replacement: source('../../packages/lobby/src/client.ts') },
  { find: /^@game\/lobby\/protocol$/, replacement: source('../../packages/lobby/src/protocol.ts') },
  { find: /^@game\/match-rules$/, replacement: source('../../packages/match-rules/src/index.ts') },
  { find: /^@game\/cpu$/, replacement: source('../../packages/cpu/src/index.ts') },
  {
    find: /^@game\/stages-items$/,
    replacement: source('../../packages/stages-items/src/index.ts'),
  },
  { find: /^@game\/fighters$/, replacement: source('../../packages/fighters/src/index.ts') },
];
