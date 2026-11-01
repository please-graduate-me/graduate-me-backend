import { describe, expect, it } from 'vitest';
import { parseYouTubeUrl } from './youtube.js';
describe('유튜브 URL', () => {
  it.each([
    'https://www.youtube.com/watch?v=JnfBXjWm7hc&t=5',
    'https://youtu.be/JnfBXjWm7hc',
    'https://m.youtube.com/watch?v=JnfBXjWm7hc',
    'https://youtube.com/shorts/JnfBXjWm7hc',
  ])('정규화: %s', (url) => expect(parseYouTubeUrl(url)).toBe('JnfBXjWm7hc'));
  it.each([
    'https://youtube.com.evil.org/watch?v=JnfBXjWm7hc',
    'https://youtube.com@evil.org/watch?v=JnfBXjWm7hc',
    'file:///etc/passwd',
    'http://127.0.0.1/',
    'https://youtube.com/watch?v=JnfBXjWm7hc&list=abc',
    'https://youtu.be/invalid',
    'https://youtube.com:8080/watch?v=JnfBXjWm7hc',
  ])('거부: %s', (url) => expect(() => parseYouTubeUrl(url)).toThrow());
});
