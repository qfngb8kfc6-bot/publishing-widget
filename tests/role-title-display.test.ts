import { describe, expect, it } from 'vitest';
import { displayRoleTitle } from '../src/core/role-title';

describe('displayRoleTitle', () => {
  it('capitalises role acronyms whatever the casing typed', () => {
    expect(displayRoleTitle('ceo')).toBe('CEO');
    expect(displayRoleTitle('Ceo')).toBe('CEO');
    for (const acronym of ['cfo', 'coo', 'cto', 'cmo', 'cio', 'cso', 'vp', 'svp', 'evp', 'gm', 'md', 'hr', 'it', 'esg', 'ai']) {
      expect(displayRoleTitle(acronym)).toBe(acronym.toUpperCase());
    }
  });

  it('keeps acronyms inside longer titles and punctuation', () => {
    expect(displayRoleTitle('head of hr')).toBe('Head of HR');
    expect(displayRoleTitle('svp, global it')).toBe('SVP, Global IT');
    expect(displayRoleTitle('ceo/founder')).toBe('CEO/Founder');
    expect(displayRoleTitle('vp-sales')).toBe('VP-sales');
    expect(displayRoleTitle('head of esg and ai')).toBe('Head of ESG and AI');
  });

  it('keeps what the user typed when it is already uppercase, and title-cases the rest as before', () => {
    expect(displayRoleTitle('EMEA Director')).toBe('EMEA Director');
    expect(displayRoleTitle('head of retail')).toBe('Head of Retail');
    expect(displayRoleTitle('e-commerce manager')).toBe('E-commerce Manager');
    expect(displayRoleTitle('  chief   executive ')).toBe('Chief Executive');
  });
});
