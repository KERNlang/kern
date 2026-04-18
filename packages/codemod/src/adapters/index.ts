import { registerAdapter } from '../adapter-registry.js';
import { zustandStoreAdapter } from './zustand-store.js';

registerAdapter(zustandStoreAdapter);

export { zustandStoreAdapter };
