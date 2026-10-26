import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile, isPeopleMoveTitle, passesRelevanceThreshold, scoreProfessionalArticle, type NormalizedArticle } from '../src/core';
import { company } from './ranking-fixtures';

const article = (id: string, title: string, description: string): NormalizedArticle => ({ id, publisherId: 'sgi-europe', title, description, url: `https://www.sgieurope.com/news/${id}.article`, categories: [], tags: [], publishedAt: new Date(Date.now() - 20 * 86_400_000).toISOString() } as NormalizedArticle);
const nike = company('nike.com', 'Nike', 'sporting goods', ['footwear', 'apparel', 'sportswear', 'running', 'product launches', 'brand', 'direct to consumer']);
const retail = buildProfessionalProfile(nike, 'Head of Retail');

const brooks = article('brooks', 'Brooks Running names new VP of footwear product strategy', "Brooks Running has appointed a former Nike executive as vice president of global footwear product strategy, leading the brand's running shoe line-up and go-to-market plans.");
const champion = article('champion', 'Champion expands into fragrance with first scent launch', 'Champion is expanding its brand into fragrance with a unisex scent collection sold through selected retailers and online.');
const fabletics = article('fabletics', 'Fabletics to open 30 new stores as omnichannel model pays off', 'Activewear brand Fabletics plans to open 30 stores this year across the US and Europe, saying shoppers who visit its stores spend more online.');
const anta = article('anta', 'ANTA Sports grows revenue with multi-brand strategy', "ANTA Sports reported revenue growth of 13% as Fila, Descente and Kolon Sport expanded the group's retail network and direct-to-consumer business in China.");

describe('Head of Retail relevance', () => {
  it('ranks store expansion and multi-brand retail above a product-strategy hire and a fragrance launch', () => {
    const [b, c, f, a] = [brooks, champion, fabletics, anta].map((item) => scoreProfessionalArticle(item, retail));
    expect(f.relevanceType).toBe('direct');
    expect(a.relevanceType).toBe('direct');
    expect(a.directMatches).toEqual(expect.arrayContaining(['retail', 'direct to consumer']));
    expect(c.relevanceType).not.toBe('direct');
    expect(passesRelevanceThreshold(b)).toBe(false);
    expect(b.directMatches).not.toContain('markets');
  });

  it('counts a people move only when the title names a retail, stores or DTC role', () => {
    const retailHire = scoreProfessionalArticle(article('puma', 'Puma appoints new head of retail for Europe', 'Puma has named a new head of retail to oversee its owned stores and outlets across Europe.'), retail);
    const dtcHire = scoreProfessionalArticle(article('on', 'On names new VP of DTC', 'On Running has hired a vice president to run its stores and e-commerce.'), retail);
    const cfoHire = scoreProfessionalArticle(article('asics', 'Asics names new CFO', 'Asics has appointed a new chief financial officer; the company runs 900 stores worldwide.'), retail);
    expect(retailHire.relevanceType).toBe('direct');
    expect(dtcHire.relevanceType).toBe('direct');
    expect(passesRelevanceThreshold(cfoHire)).toBe(false);
  });

  it('recognises people-move headlines without catching launches or partnerships', () => {
    for (const title of ['Brooks Running names new VP of footwear product strategy', 'Puma appoints head of retail', 'Asics names Jane Doe as CEO', 'Under Armour CFO steps down', 'Adidas hires former Nike executive']) expect(isPeopleMoveTitle(title)).toBe(true);
    for (const title of ['Champion launches fragrance', 'Nike and Apple extend partnership', 'Fabletics opens 30 stores', 'Brand names to watch in 2026']) expect(isPeopleMoveTitle(title)).toBe(false);
  });

  it('leaves other dedicated roles alone: a product-strategy hire still counts for a Product Manager', () => {
    const product = buildProfessionalProfile(company('adidas.com', 'Adidas', 'sporting goods', ['footwear']), 'Product Manager');
    expect(scoreProfessionalArticle(brooks, product).relevanceType).toBe('direct');
  });
});
