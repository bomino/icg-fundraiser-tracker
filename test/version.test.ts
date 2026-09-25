import { describe, expect, it } from 'vitest';
import { SITE_API_VERSION, behindHalf } from '../web/src/version';

describe('behindHalf', () => {
  it('finds nothing behind when the server runs the version the site was built for', () => {
    expect(behindHalf(SITE_API_VERSION)).toBeNull();
    expect(behindHalf(3, 3)).toBeNull();
  });

  it('blames the server when its version is lower', () => {
    expect(behindHalf(2, 3)).toBe('server');
  });

  // A Code.gs deployed before API_VERSION existed says nothing about its version.
  it('blames the server when it sends no version at all', () => {
    expect(behindHalf(undefined, 1)).toBe('server');
  });

  it('blames the site when the server is newer, as for a tab left open across a deploy', () => {
    expect(behindHalf(4, 3)).toBe('site');
  });
});
