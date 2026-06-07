/// <reference types="vite/client" />

import type { RedisGuiApi } from '../shared/types';

declare global {
  interface Window {
    redisGui?: RedisGuiApi;
  }
}
