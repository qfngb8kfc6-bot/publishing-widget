import type { Intent, NormalizedArticle, PublisherAdapter, SearchOptions } from '../core';
import { demoArticles, type DemoRawArticle } from './articles';

export class DemoPublisherAdapter implements PublisherAdapter<DemoRawArticle> {
  readonly publisherId = 'demo';

  async search(intent: Intent, options: SearchOptions): Promise<DemoRawArticle[]> {
    options.onProgress?.('searching');
    const terms = new Set(intent.keywords);
    const candidates = demoArticles
      .map((article, index) => {
        const searchable = `${article.title} ${article.dek} ${article.section} ${article.keywords.join(' ')} ${article.audiences.join(' ')}`.toLowerCase();
        const matches = [...terms].filter((term) => searchable.includes(term)).length;
        return { article, matches, index };
      })
      .filter((item) => item.matches > 0)
      .sort((a, b) => b.matches - a.matches || a.index - b.index)
      .slice(0, options.limit)
      .map(({ article }) => article);
    return Promise.resolve(candidates);
  }

  async getArticle(id: string): Promise<DemoRawArticle | null> {
    return demoArticles.find((article) => article.id === id) ?? null;
  }

  normalizeArticle(raw: DemoRawArticle): NormalizedArticle {
    return {
      id: raw.id,
      title: raw.title,
      description: raw.dek,
      url: raw.url,
      imageUrl: raw.image,
      publishedAt: raw.date,
      author: raw.byline,
      categories: [raw.section],
      tags: raw.keywords,
      contentSnippet: raw.body,
      body: raw.body,
      summary: raw.dek,
      contentType: 'article',
      publisherId: this.publisherId,
      audiences: raw.audiences,
      provenance: { publisherId: this.publisherId, sourceArticleId: raw.id, sourceUrl: raw.url, retrievalSource: 'demo-catalogue' },
    };
  }
}
