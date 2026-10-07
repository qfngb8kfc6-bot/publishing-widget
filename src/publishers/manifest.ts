import type { BrandingConfig, PublisherConfig, QuestionConfig } from '../core';
import { DEFAULT_THEME } from '../core/theme';

export interface PublisherManifestBranding extends Partial<BrandingConfig> {
  primaryAccent?: string;
  surfaceTreatment?: BrandingConfig['backgroundTreatment'];
  borderRadius?: BrandingConfig['radiusPreference'];
  articleLinkBehavior?: 'same-tab' | 'new-tab';
  loading?: PublisherExperienceBranding;
  report?: PublisherExperienceBranding;
}

export interface PublisherExperienceBranding {
  desktopBackgroundImage?: string;
  mobileBackgroundImage?: string;
  backgroundFallback?: string;
  overlay?: string;
  overlayOpacity?: number;
  textColor?: string;
  logo?: string;
}

export interface PublisherManifest {
  publisherId: string;
  name: string;
  enabled: boolean;
  environment: 'development' | 'staging' | 'production';
  publisherConfigVersion: string;
  branding: PublisherManifestBranding;
  /** Legacy questionnaire schema. New publisher experiences use company + role. */
  questions?: QuestionConfig[];
  content: {
    adapterId: string;
    resultLimit: number;
    candidateRetrievalLimit: number;
    searchBehavior?: 'intent' | 'keywords';
    categoryMappings?: Record<string, string[]>;
  };
  results: PublisherConfig['results'];
  ranking?: {
    mode: 'deterministic' | 'hybrid';
    deterministicWeight?: number;
    semanticWeight?: number;
  };
  features?: {
    aiEnabled?: boolean;
    explanationsEnabled?: boolean;
    analyticsEnabled?: boolean;
  };
  api?: {
    baseUrl?: string;
    searchEndpoint?: string;
    articleEndpoint?: string;
    authentication?: 'none' | 'server-proxy';
    timeoutMs?: number;
    candidateLimit?: number;
  };
  allowedOrigins?: string[];
  reportSections?: string[];
  primaryCTA?: string;
  termsUrl?: string;
  privacyUrl?: string;
  poweredBy?: boolean;
}

export function manifestToPublisherConfig(manifest: PublisherManifest): PublisherConfig {
  const branding = manifest.branding;
  return {
    publisherId: manifest.publisherId,
    publisherName: manifest.name,
    branding: {
      primaryColor: branding.primaryAccent ?? branding.primaryColor ?? DEFAULT_THEME.indigo,
      secondaryColor: branding.secondaryColor ?? DEFAULT_THEME.surfaceMuted,
      fontFamily: branding.fontFamily,
      widgetTitle: branding.widgetTitle ?? `Build your ${manifest.name} briefing`,
      introductoryCopy: branding.introductoryCopy ?? 'Tell us where you work and what you do. We will build a briefing from this publisher’s coverage.',
      radiusPreference: branding.borderRadius ?? branding.radiusPreference,
      backgroundTreatment: branding.surfaceTreatment ?? branding.backgroundTreatment,
      logo: branding.logo,
    },
    questions: manifest.questions,
    content: {
      adapterType: manifest.content.adapterId,
      resultLimit: manifest.content.resultLimit,
      candidateRetrievalLimit: manifest.content.candidateRetrievalLimit,
    },
    results: {
      ...manifest.results,
      openArticleInNewTab: manifest.branding.articleLinkBehavior === 'same-tab' ? false : manifest.results.openArticleInNewTab,
    },
  };
}

export function manifestFromPublisherConfig(config: PublisherConfig): PublisherManifest {
  return {
    publisherId: config.publisherId,
    name: config.publisherName,
    enabled: true,
    environment: 'development',
    publisherConfigVersion: 'legacy',
    branding: config.branding,
    questions: config.questions,
    content: {
      adapterId: config.content.adapterType,
      resultLimit: config.content.resultLimit,
      candidateRetrievalLimit: config.content.candidateRetrievalLimit,
    },
    results: config.results,
  };
}
