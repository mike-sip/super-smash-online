import { createMemoryStore } from '../src/store-memory.ts';
import { storeContract } from './store-contract.ts';

storeContract('mémoire', () => Promise.resolve(createMemoryStore()));
