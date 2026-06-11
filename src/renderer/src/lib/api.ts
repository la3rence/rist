import { defaultLanguage, translate } from '../../../shared/i18n';

export function getRedisGuiApi() {
  if (!window.redisGui) {
    throw new Error(translate(defaultLanguage, 'preloadUnavailable'));
  }
  return window.redisGui;
}
