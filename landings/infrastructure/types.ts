export type LandingStatus = 'Draft' | 'Development' | 'Live' | 'Archived';

export interface LandingMetadata {
  /**
   * Заголовок лендинга (Используется для SEO <title> и названия в CRM)
   */
  title: string;
  
  /**
   * Краткое описание идеи, гипотезы или предложения (Используется для SEO <meta description>)
   */
  description: string;
  
  /**
   * Статус готовности лендинга
   */
  status?: LandingStatus;
  
  /**
   * Технологии, примененные в лендинге
   */
  tech?: string[];
}
