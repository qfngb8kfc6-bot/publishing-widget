import type { NormalizedArticle } from '../../core';
import { normalizeMappedArticle } from '../content/normalize';
import { ibiSitemapUrl } from './config';

export interface IbiRawArticle {
  id?: string;
  guid?: string;
  externalId?: string;
  title?: string;
  headline?: string;
  description?: string;
  standfirst?: string;
  summary?: string;
  excerpt?: string;
  body?: string;
  articleBody?: string;
  url?: string;
  canonicalUrl?: string;
  image?: string | { url?: string };
  imageUrl?: string;
  author?: string | { name?: string };
  category?: string;
  categories?: string[];
  tags?: string[];
  publishedAt?: string;
  updatedAt?: string;
  language?: string;
}

/** IBI-specific field aliases stop at the canonical PublisherArticle boundary. */
export function normalizeIbiArticle(raw: IbiRawArticle | unknown): NormalizedArticle | null {
  return normalizeMappedArticle(raw, {
    publisherId: 'ibi',
    sourceType: 'sitemap',
    sourceUrl: ibiSitemapUrl,
    sourceName: 'IBI News public sitemap',
    mappings: {
      id: ['id', '@id'],
      externalId: ['externalId', 'external_id'],
      guid: ['guid', 'id', '@id'],
      title: ['title', 'headline'],
      description: ['description', 'standfirst'],
      summary: ['summary', 'description', 'standfirst'],
      body: ['body', 'articleBody'],
      excerpt: ['excerpt', 'description', 'standfirst'],
      url: ['url', 'canonicalUrl', 'canonical_url'],
      canonicalUrl: ['canonicalUrl', 'canonical_url', 'url'],
      imageUrl: ['imageUrl', 'image'],
      author: ['author', 'byline'],
      category: ['category'],
      categories: ['categories', 'category'],
      tags: ['tags', 'keywords'],
      publishedAt: ['publishedAt', 'datePublished'],
      updatedAt: ['updatedAt', 'dateModified'],
      language: ['language', 'inLanguage'],
    },
  });
}
