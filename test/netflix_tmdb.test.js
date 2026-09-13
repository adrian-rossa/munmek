import { describe, it, expect, vi, beforeEach } from 'vitest';
import background from '../src/background/background.js';

describe('Netflix & TMDB Context Resolution', () => {
  const {
    extractMetadataFromNetflixHtml,
    matchBestTmdbResult,
    searchTmdbShowOrMovie,
    resolveNetflixTmdbContext,
    summarizeMediaContext,
    parseNetflixMetadataFromTab,
    parseYouTubeMetadataFromTab,
    parseNetflixTitleString
  } = background;

  describe('extractMetadataFromNetflixHtml', () => {
    it('extracts title and description from JSON-LD schema', () => {
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
            {
              "@type": "TVSeries",
              "name": "Gokusen",
              "description": "A passionate rookie teacher starts working at a high school full of delinquents."
            }
            </script>
          </head>
        </html>
      `;

      const res = extractMetadataFromNetflixHtml(html);
      expect(res.title).toBe('Gokusen');
      expect(res.synopsis).toBe('A passionate rookie teacher starts working at a high school full of delinquents.');
    });

    it('falls back to og:title and og:description or meta description when JSON-LD is absent', () => {
      const html = `
        <html>
          <head>
            <meta property="og:title" content="Gokusen" />
            <meta name="description" content="After graduating from college, Kumiko Yamaguchi becomes a teacher." />
          </head>
        </html>
      `;

      const res = extractMetadataFromNetflixHtml(html);
      expect(res.title).toBe('Gokusen');
      expect(res.synopsis).toBe('After graduating from college, Kumiko Yamaguchi becomes a teacher.');
    });

    it('cleans Netflix branding from HTML title tag as fallback', () => {
      const html = `
        <html>
          <head>
            <title>Watch Gokusen | Netflix</title>
          </head>
        </html>
      `;

      const res = extractMetadataFromNetflixHtml(html);
      expect(res.title).toBe('Gokusen');
    });
  });

  describe('matchBestTmdbResult', () => {
    it('matches English titles accurately', () => {
      const results = [
        { id: 1, name: 'Other Show' },
        { id: 2, name: 'Gokusen', original_name: 'ごくせん' }
      ];

      const match = matchBestTmdbResult('Gokusen', results);
      expect(match).not.toBeNull();
      expect(match.id).toBe(2);
    });

    it('matches Korean titles accurately without dropping hangul', () => {
      const results = [
        { id: 10, name: '오징어 게임' },
        { id: 20, name: '고쿠센' }
      ];

      const match = matchBestTmdbResult('고쿠센', results);
      expect(match).not.toBeNull();
      expect(match.id).toBe(20);
    });

    it('matches Japanese Kana and Kanji titles without treating them as empty strings', () => {
      const results = [
        { id: 101, name: 'ごくせん', original_name: 'ごくせん' },
        { id: 102, name: 'NARUTO' }
      ];

      const match = matchBestTmdbResult('ごくせん', results);
      expect(match).not.toBeNull();
      expect(match.id).toBe(101);
    });

    it('rejects generic titles like netflix, netflixvideo, home', () => {
      const results = [{ id: 999, name: 'Netflix and Chill' }];
      expect(matchBestTmdbResult('netflix', results)).toBeNull();
      expect(matchBestTmdbResult('netflixvideo', results)).toBeNull();
    });
  });

  describe('searchTmdbShowOrMovie', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('cleans season and episode suffixes before querying TMDB', async () => {
      let queriedQuery = '';
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        const u = new URL(url);
        queriedQuery = u.searchParams.get('query');
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: [{ id: 456, name: 'Gokusen', media_type: 'tv' }]
          })
        });
      });

      const match = await searchTmdbShowOrMovie('Gokusen - Season 1 - Episode 1', null, 'fake_api_key');
      expect(match).not.toBeNull();
      expect(match.id).toBe(456);
      expect(queriedQuery).toBe('Gokusen');
    });

    it('aborts search early if title is generic or empty', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      const res = await searchTmdbShowOrMovie('Netflix Video', null, 'fake_api_key');
      expect(res).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('resolveNetflixTmdbContext', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('uses direct Netflix synopsis when available without needing TMDB call', async () => {
      const netflixData = {
        title: 'Gokusen',
        netflixId: '80012345',
        seasonNumber: 1,
        episodeNumber: 1,
        episodeTitle: 'Episode 1',
        synopsis: 'A young teacher joins Shirokin High School.',
        hasDirectSynopsis: true,
        subtitles: '선생님 오셨어요.'
      };

      const res = await resolveNetflixTmdbContext(netflixData, { tmdbApiKey: 'key' });
      expect(res.directSynopsisMatched).toBe(true);
      expect(res.title).toBe('Gokusen S1E1');
      expect(res.rawText).toContain('Synopsis: A young teacher joins Shirokin High School.');
      expect(res.rawText).toContain('Episode (S1E1): Episode 1');
      expect(res.rawText).toContain('Recent Dialogue: 선생님 오셨어요.');
    });

    it('recovers title and synopsis by fetching netflix.com/title when title is initially missing', async () => {
      const netflixHtml = `
        <html>
          <head>
            <script type="application/ld+json">
            {
              "@type": "TVSeries",
              "name": "Gokusen",
              "description": "Kumiko Yamaguchi becomes a teacher."
            }
            </script>
          </head>
        </html>
      `;

      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes('netflix.com/title/80012345')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(netflixHtml)
          });
        }
        return Promise.reject(new Error('Unknown URL: ' + url));
      });

      const netflixData = {
        title: 'Netflix Video',
        netflixId: '80012345',
        seasonNumber: 1,
        episodeNumber: 1
      };

      const res = await resolveNetflixTmdbContext(netflixData, { tmdbApiKey: '' });
      expect(res.directSynopsisMatched).toBe(true);
      expect(res.title).toBe('Gokusen S1E1');
      expect(res.rawText).toContain('Synopsis: Kumiko Yamaguchi becomes a teacher.');
    });
  });

  describe('parseNetflixTitleString', () => {
    it('parses show title, season, and episode from formatted title', () => {
      const res = parseNetflixTitleString('Watch Sparks of Tomorrow: Season 1, Episode 4 | Netflix');
      expect(res.showTitle).toBe('Sparks of Tomorrow');
      expect(res.seasonNumber).toBe(1);
      expect(res.episodeNumber).toBe(4);
    });

    it('parses episode-only title', () => {
      const res = parseNetflixTitleString('Gokusen: Episode 2 | Netflix');
      expect(res.showTitle).toBe('Gokusen');
      expect(res.seasonNumber).toBeNull();
      expect(res.episodeNumber).toBe(2);
    });

    it('returns empty fields for generic homepage/browse title', () => {
      const res = parseNetflixTitleString('Netflix - Watch TV Shows Online, Watch Movies Online');
      expect(res.showTitle).toBe('');
      expect(res.seasonNumber).toBeNull();
      expect(res.episodeNumber).toBeNull();
    });
  });

  describe('parseNetflixMetadataFromTab', () => {
    it('parses show title from standard Netflix tab title', () => {
      const res = parseNetflixMetadataFromTab('https://www.netflix.com/watch/81454521', 'Watch Sparks of Tomorrow | Netflix');
      expect(res.showTitle).toBe('Sparks of Tomorrow');
      expect(res.netflixId).toBe('81454521');
    });

    it('parses season and episode from tab title', () => {
      const res = parseNetflixMetadataFromTab(
        'https://www.netflix.com/watch/81454521?trackId=123',
        'Sparks of Tomorrow: Season 1, Episode 2 | Netflix'
      );
      expect(res.showTitle).toBe('Sparks of Tomorrow');
      expect(res.seasonNumber).toBe(1);
      expect(res.episodeNumber).toBe(2);
      expect(res.netflixId).toBe('81454521');
    });

    it('parses Korean tab title with episode and season format', () => {
      const res = parseNetflixMetadataFromTab(
        'https://www.netflix.com/watch/80012345',
        '시청하기 내일의 불꽃: 시즌 1 - 3화 | 넷플릭스'
      );
      expect(res.showTitle).toBe('내일의 불꽃');
      expect(res.seasonNumber).toBe(1);
      expect(res.episodeNumber).toBe(3);
    });

    it('ignores generic Netflix branding when no show title is in tab', () => {
      const res = parseNetflixMetadataFromTab(
        'https://www.netflix.com/browse',
        'Netflix - Watch TV Shows Online, Watch Movies Online'
      );
      expect(res.showTitle).toBe('');
      expect(res.netflixId).toBe('');
    });
  });

  describe('parseYouTubeMetadataFromTab', () => {
    it('extracts videoId and title correctly', () => {
      const res = parseYouTubeMetadataFromTab(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'Never Gonna Give You Up - YouTube'
      );
      expect(res.videoId).toBe('dQw4w9WgXcQ');
      expect(res.title).toBe('Never Gonna Give You Up');
    });
  });

  describe('summarizeMediaContext placeholder guard', () => {
    it('skips LLM call and returns actionable prompt if input text is empty', async () => {
      const res = await summarizeMediaContext({
        siteType: 'netflix',
        title: 'Sparks of Tomorrow',
        rawText: ''
      }, {});

      expect(res).toContain('No scene synopsis or dialogue available yet for Sparks of Tomorrow.');
      expect(res).toContain('Play the video with Korean subtitles');
    });

    it('skips LLM call and returns actionable prompt if input text is generic placeholder', async () => {
      const res = await summarizeMediaContext({
        siteType: 'netflix',
        title: 'Netflix Video',
        rawText: 'Netflix Video'
      }, {});

      expect(res).toContain('No scene synopsis or dialogue available yet for this show.');
    });

    it('skips LLM call for webpage when text is empty', async () => {
      const res = await summarizeMediaContext({
        siteType: 'generic',
        title: 'Webpage',
        rawText: ''
      }, {});

      expect(res).toContain('No webpage content extracted yet.');
    });
  });
});

