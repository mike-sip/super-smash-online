import { describe, expect, it } from 'vitest';
import { createScreenStack } from '../src/screens.ts';

const entry = (id: string, back: 'pop' | 'confirm' | 'block' = 'pop') => ({ id, back });

describe('pile d’écrans', () => {
  it('push, top, depth, ids', () => {
    const s = createScreenStack(entry('title'));
    s.push(entry('menu'));
    s.push(entry('options'));
    expect(s.top().id).toBe('options');
    expect(s.depth()).toBe(3);
    expect(s.ids()).toEqual(['title', 'menu', 'options']);
  });

  it('retour : dépile, sauf à la racine', () => {
    const s = createScreenStack(entry('menu'));
    s.push(entry('options'));
    expect(s.back()).toBe('popped');
    expect(s.top().id).toBe('menu');
    expect(s.back()).toBe('root');
    expect(s.depth()).toBe(1);
  });

  it('retour avec confirmation : rien ne change avant confirmBack', () => {
    const s = createScreenStack(entry('menu'));
    s.push(entry('match', 'confirm'));
    expect(s.back()).toBe('confirm');
    expect(s.top().id).toBe('match');
    s.confirmBack();
    expect(s.top().id).toBe('menu');
  });

  it('retour bloqué (compte à rebours)', () => {
    const s = createScreenStack(entry('menu'));
    s.push(entry('countdown', 'block'));
    expect(s.back()).toBe('blocked');
    expect(s.top().id).toBe('countdown');
  });

  it('replace remplace le sommet, reset vide la pile', () => {
    const s = createScreenStack(entry('menu'));
    s.push(entry('setup'));
    s.replace(entry('match'));
    expect(s.ids()).toEqual(['menu', 'match']);
    s.reset(entry('title'));
    expect(s.ids()).toEqual(['title']);
  });

  it('popTo dépile jusqu’à un écran présent, sinon ne change rien', () => {
    const s = createScreenStack(entry('menu'));
    s.push(entry('local'));
    s.push(entry('stage'));
    s.push(entry('rules'));
    expect(s.popTo('local')).toBe(true);
    expect(s.ids()).toEqual(['menu', 'local']);
    expect(s.popTo('absent')).toBe(false);
    expect(s.ids()).toEqual(['menu', 'local']);
  });

  it('confirmBack à la racine ne vide jamais la pile', () => {
    const s = createScreenStack(entry('menu', 'confirm'));
    s.confirmBack();
    expect(s.depth()).toBe(1);
  });
});
