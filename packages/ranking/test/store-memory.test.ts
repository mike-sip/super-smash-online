import { createMemoryRankingStore } from '../src/store-memory.ts';
import { storeContract } from './store-contract.ts';

storeContract('mémoire', () => Promise.resolve(createMemoryRankingStore()));
