import { describe, it, expect, vi } from 'vitest';
import {
  matchBestTmdbResult,
  fetchYouTubeTranscript,
  resolveYouTubeContext,
  summarizeMediaContext
} from '../src/background/background.js';

describe('TMDB Search Result Matcher', () => {
  it('matches exact Korean title in results', () => {
    const results = [
      { id: 101, name: '오징어 게임', original_name: 'Squid Game', first_air_date: '2021-09-17', media_type: 'tv' },
      { id: 102, name: '게임의 법칙', original_name: 'The Law of the Game', first_air_date: '1994-09-17', media_type: 'movie' }
    ];

    const match = matchBestTmdbResult('오징어 게임', results);
    expect(match).toBeDefined();
    expect(match.id).toBe(101);
    expect(match.name).toBe('오징어 게임');
  });

  it('matches by original title or English title ignoring punctuation', () => {
    const results = [
      { id: 201, title: 'Parasite (2019)', original_title: '기생충', release_date: '2019-05-30', media_type: 'movie' },
      { id: 202, title: 'The Host', original_title: '괴물', release_date: '2006-07-27', media_type: 'movie' }
    ];

    const match = matchBestTmdbResult('Parasite', results);
    expect(match).toBeDefined();
    expect(match.id).toBe(201);
  });

  it('falls back to top popularity result if no exact string match', () => {
    const results = [
      { id: 301, name: 'Top Rated K-Drama', popularity: 95.5 },
      { id: 302, name: 'Another Show', popularity: 12.0 }
    ];

    const match = matchBestTmdbResult('Some Unknown Query', results);
    expect(match).toBeDefined();
    expect(match.id).toBe(301);
  });

  it('returns null for empty or invalid results array', () => {
    expect(matchBestTmdbResult('Test', [])).toBeNull();
    expect(matchBestTmdbResult('Test', null)).toBeNull();
  });
});

describe('YouTube Caption Processing', () => {
  it('parses YouTube JSON3 events into continuous transcript text', async () => {
    const fakeJson3 = JSON.stringify({
      events: [
        { segs: [{ utf8: '안녕하세요 ' }, { utf8: '여러분, ' }] },
        { segs: [{ utf8: '오늘의 한국어 ' }, { utf8: '수업입니다.' }] }
      ]
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fakeJson3
    });

    const tracks = [
      { languageCode: 'ko', baseUrl: 'https://www.youtube.com/api/timedtext?v=123&lang=ko' }
    ];

    const transcript = await fetchYouTubeTranscript(tracks);
    expect(transcript).toBe('안녕하세요 여러분, 오늘의 한국어 수업입니다.');
  });

  it('parses XML timedtext format when json3 format is not returned', async () => {
    const fakeXml = `
      <transcript>
        <text start="0.5" dur="2.1">안녕하세요</text>
        <text start="2.6" dur="3.0">한국어 공부를 시작합니다.</text>
      </transcript>
    `;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fakeXml
    });

    const tracks = [
      { languageCode: 'ko', baseUrl: 'https://www.youtube.com/api/timedtext?v=456&lang=ko' }
    ];

    const transcript = await fetchYouTubeTranscript(tracks);
    expect(transcript).toBe('안녕하세요 한국어 공부를 시작합니다.');
  });

  it('selects Korean track over English and other tracks', async () => {
    let requestedUrl = '';
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      requestedUrl = url;
      return Promise.resolve({
        ok: true,
        text: async () => JSON.stringify({ events: [{ segs: [{ utf8: '한국어 자막' }] }] })
      });
    });

    const tracks = [
      { languageCode: 'en', baseUrl: 'https://yt.com/timedtext?lang=en' },
      { languageCode: 'ko', baseUrl: 'https://yt.com/timedtext?lang=ko' },
      { languageCode: 'ja', baseUrl: 'https://yt.com/timedtext?lang=ja' }
    ];

    const transcript = await fetchYouTubeTranscript(tracks);
    expect(requestedUrl).toContain('lang=ko');
    expect(transcript).toBe('한국어 자막');
  });

  it('combines YouTube metadata and description when captions are missing', async () => {
    const ytData = {
      videoId: 'abc12345',
      title: 'Real Life Korean Conversation',
      author: 'Talk To Me In Korean',
      description: 'Learn natural expressions for ordering at a Korean cafe.',
      captionTracks: []
    };

    const resolved = await resolveYouTubeContext(ytData);
    expect(resolved.title).toBe('Real Life Korean Conversation');
    expect(resolved.rawText).toContain('Title: Real Life Korean Conversation');
    expect(resolved.rawText).toContain('Details:\nLearn natural expressions for ordering at a Korean cafe.');
  });
});

describe('Media Context Summarizer & Prompt Injection', () => {
  it('calls AI backend with concise context instruction', async () => {
    const fakeSummary = 'A cafe owner and customer discussing coffee choices in Seoul. Key focus on polite ordering endings and drink sizes.';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: fakeSummary }] } }]
      })
    });

    const config = {
      aiProvider: 'gemini',
      apiKey: 'test-gemini-key',
      modelId: 'gemini-flash-lite-latest'
    };

    const summary = await summarizeMediaContext(
      {
        siteType: 'youtube',
        title: 'Cafe Conversation',
        rawText: 'Full transcript of cafe dialogue...'
      },
      config
    );

    expect(summary).toBe(fakeSummary);
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
