import { createContext, useContext } from 'react';
import { defaultLanguage, normalizeLanguage, translate } from '../../../shared/i18n';
import type { AppLanguage, TranslationKey, TranslationParams } from '../../../shared/i18n';

export type TFunction = (key: TranslationKey, params?: TranslationParams) => string;

export const I18nContext = createContext<{ language: AppLanguage; t: TFunction }>({
  language: defaultLanguage,
  t: (key, params) => translate(defaultLanguage, key, params)
});

export function useI18n(): { language: AppLanguage; t: TFunction } {
  return useContext(I18nContext);
}

export function createI18n(language: AppLanguage): { language: AppLanguage; t: TFunction } {
  const normalizedLanguage = normalizeLanguage(language);
  return {
    language: normalizedLanguage,
    t: (key, params) => translate(normalizedLanguage, key, params)
  };
}
