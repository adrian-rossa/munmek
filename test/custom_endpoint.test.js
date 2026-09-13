import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const background = require('../src/background/background.js');

const {
  normalizeOpenAiEndpointUrl,
  getOpenAiModelsUrl,
  extractAndParseJson,
  callAiChatCompletion,
  testAiModelsEndpoint
} = background;

describe('Custom OpenAI-Compatible Endpoint Support', () => {
  describe('Endpoint URL Normalization', () => {
    it('normalizes bare host and port to /v1/chat/completions', () => {
      expect(normalizeOpenAiEndpointUrl('http://localhost:1234')).toBe('http://localhost:1234/v1/chat/completions');
      expect(normalizeOpenAiEndpointUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080/v1/chat/completions');
    });

    it('handles URLs without http prefix', () => {
      expect(normalizeOpenAiEndpointUrl('localhost:11434')).toBe('http://localhost:11434/v1/chat/completions');
    });

    it('preserves /v1 base and appends /chat/completions', () => {
      expect(normalizeOpenAiEndpointUrl('http://localhost:1234/v1')).toBe('http://localhost:1234/v1/chat/completions');
      expect(normalizeOpenAiEndpointUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions');
      expect(normalizeOpenAiEndpointUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1/chat/completions');
    });

    it('leaves complete /chat/completions URLs unchanged', () => {
      expect(normalizeOpenAiEndpointUrl('http://localhost:1234/v1/chat/completions')).toBe('http://localhost:1234/v1/chat/completions');
      expect(normalizeOpenAiEndpointUrl('https://api.groq.com/openai/v1/chat/completions/')).toBe('https://api.groq.com/openai/v1/chat/completions');
    });

    it('returns empty string for empty input', () => {
      expect(normalizeOpenAiEndpointUrl('')).toBe('');
      expect(normalizeOpenAiEndpointUrl(null)).toBe('');
    });
  });

  describe('Models Endpoint URL Normalization', () => {
    it('normalizes bare host and port to /v1/models', () => {
      expect(getOpenAiModelsUrl('http://localhost:1234')).toBe('http://localhost:1234/v1/models');
      expect(getOpenAiModelsUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080/v1/models');
    });

    it('preserves /v1 and appends /models', () => {
      expect(getOpenAiModelsUrl('http://localhost:1234/v1')).toBe('http://localhost:1234/v1/models');
      expect(getOpenAiModelsUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/models');
    });

    it('replaces /chat/completions with /models', () => {
      expect(getOpenAiModelsUrl('http://localhost:1234/v1/chat/completions')).toBe('http://localhost:1234/v1/models');
    });
  });

  describe('Robust JSON Parsing for Local LLM Outputs', () => {
    it('parses direct JSON correctly', () => {
      const raw = '{"words_analysis":[{"surface":"가다","base":"가다","definitions":["to go"]}]}';
      const parsed = extractAndParseJson(raw);
      expect(parsed.words_analysis[0].base).toBe('가다');
    });

    it('extracts JSON from markdown code blocks (```json ... ```)', () => {
      const raw = `Here is the requested analysis:
\`\`\`json
{
  "words_analysis": [
    {
      "surface": "먹었다",
      "base": "먹다",
      "pos": "verb",
      "definitions": ["to eat"],
      "grammar_notes": "past tense -었-"
    }
  ]
}
\`\`\`
Hope this helps!`;
      const parsed = extractAndParseJson(raw);
      expect(parsed.words_analysis[0].base).toBe('먹다');
      expect(parsed.words_analysis[0].grammar_notes).toBe('past tense -었-');
    });

    it('extracts JSON from plain markdown blocks (``` ... ```)', () => {
      const raw = `\`\`\`
{
  "definitions": ["friend"],
  "pos": "noun",
  "grammar_notes": "basic noun"
}
\`\`\``;
      const parsed = extractAndParseJson(raw);
      expect(parsed.definitions[0]).toBe('friend');
      expect(parsed.pos).toBe('noun');
    });

    it('extracts JSON from conversational leading/trailing text without fences', () => {
      const raw = `Sure! Below is the JSON format you requested:
{
  "words_analysis": [
    {
      "surface": "예뻤다",
      "base": "예쁘다",
      "pos": "adjective",
      "definitions": ["was pretty"]
    }
  ]
}
Let me know if you need more analysis.`;
      const parsed = extractAndParseJson(raw);
      expect(parsed.words_analysis[0].base).toBe('예쁘다');
    });

    it('strips <think>...</think> blocks produced by reasoning models like DeepSeek-R1', () => {
      const raw = `<think>
The user is asking for the base form of 공부했다.
The word is 공부하다 (to study).
Let's format as JSON.
</think>
\`\`\`json
{
  "words_analysis": [
    {
      "surface": "공부했다",
      "base": "공부하다",
      "pos": "verb",
      "definitions": ["to study"],
      "grammar_notes": "past tense -았/었다"
    }
  ]
}
\`\`\``;
      const parsed = extractAndParseJson(raw);
      expect(parsed.words_analysis[0].base).toBe('공부하다');
      expect(parsed.words_analysis[0].definitions[0]).toBe('to study');
    });

    it('extracts array JSON format', () => {
      const raw = `[{"word": "한국어", "definition": "Korean language"}]`;
      const parsed = extractAndParseJson(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].word).toBe('한국어');
    });

    it('throws meaningful error when no valid JSON exists', () => {
      expect(() => extractAndParseJson('Just random text without braces')).toThrow(/Failed to extract valid JSON/);
    });
  });

  describe('Unified AI Chat Completion Dispatcher', () => {
    it('applies custom sampling parameters and reasoning toggles in custom OpenAI payload', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"words_analysis": [{"surface": "책", "base": "책", "definitions": ["book"]}]}'
              }
            }
          ]
        })
      });
      globalThis.fetch = mockFetch;

      const result = await callAiChatCompletion({
        promptText: "Analyze '책'",
        systemInstruction: "Korean helper",
        config: {
          aiProvider: 'custom',
          customEndpointUrl: 'http://localhost:1234/v1',
          customModelId: 'deepseek-r1-distill-qwen-7b',
          customApiKey: 'key-123',
          customDisableReasoning: true,
          customTemperature: '0.7',
          customTopP: '0.85',
          customTopK: '50',
          customMinP: '0.08',
          customRepeatPenalty: '1.2',
          customPresencePenalty: '0.1'
        }
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
      const body = JSON.parse(calledOptions.body);
      expect(body.temperature).toBe(0.7);
      expect(body.top_p).toBe(0.85);
      expect(body.top_k).toBe(50);
      expect(body.min_p).toBe(0.08);
      expect(body.repeat_penalty).toBe(1.2);
      expect(body.presence_penalty).toBe(0.1);
      expect(body.reasoning_effort).toBe('none');
      expect(body.enable_thinking).toBe(false);
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(result.words_analysis[0].base).toBe('책');
    });
    it('sends correct OpenAI chat completions payload and headers for custom endpoints', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  words_analysis: [{ surface: '사람', base: '사람', definitions: ['person'] }]
                })
              }
            }
          ]
        })
      });
      globalThis.fetch = mockFetch;

      const result = await callAiChatCompletion({
        promptText: "Analyze '사람'",
        systemInstruction: "You are a Korean assistant.",
        config: {
          aiProvider: 'custom',
          customEndpointUrl: 'http://localhost:1234/v1',
          customModelId: 'llama-3.2-3b-instruct',
          customApiKey: 'test-key-123'
        }
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('http://localhost:1234/v1/chat/completions');
      expect(calledOptions.method).toBe('POST');
      expect(calledOptions.headers['Authorization']).toBe('Bearer test-key-123');

      const body = JSON.parse(calledOptions.body);
      expect(body.model).toBe('llama-3.2-3b-instruct');
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are a Korean assistant.' },
        { role: 'user', content: "Analyze '사람'" }
      ]);
      expect(result.words_analysis[0].definitions[0]).toBe('person');
    });

    it('retries without response_format if custom backend returns HTTP 400', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () => 'response_format is not supported by this server'
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: '{"definitions": ["friend"], "pos": "noun"}'
                }
              }
            ]
          })
        });
      globalThis.fetch = mockFetch;

      const result = await callAiChatCompletion({
        promptText: "Analyze '친구'",
        systemInstruction: "Return JSON",
        config: {
          aiProvider: 'custom',
          customEndpointUrl: 'http://127.0.0.1:8080',
          customModelId: 'local-model'
        }
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.definitions[0]).toBe('friend');
    });

    it('calls Google Gemini endpoint correctly when aiProvider is gemini', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  { text: '{"words_analysis": [{"surface": "물", "base": "물", "definitions": ["water"]}]}' }
                ]
              }
            }
          ]
        })
      });
      globalThis.fetch = mockFetch;

      const result = await callAiChatCompletion({
        promptText: "Analyze '물'",
        systemInstruction: "Korean helper",
        config: {
          aiProvider: 'gemini',
          apiKey: 'AIzaSyGeminiTestKey',
          modelId: 'gemini-flash-lite-latest'
        }
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
      expect(calledUrl).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=AIzaSyGeminiTestKey');
      expect(calledOptions.method).toBe('POST');
      expect(result.words_analysis[0].definitions[0]).toBe('water');
    });
  });

  describe('Lightweight Models Endpoint Connection Testing', () => {
    it('tests custom OpenAI endpoint using GET /v1/models without sending prompts', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'llama-3.2-3b-instruct' },
            { id: 'qwen2.5-7b-instruct' }
          ]
        })
      });
      globalThis.fetch = mockFetch;

      const result = await testAiModelsEndpoint({
        aiProvider: 'custom',
        customEndpointUrl: 'http://localhost:1234/v1',
        customApiKey: 'test-key'
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('http://localhost:1234/v1/models');
      expect(calledOptions.method).toBe('GET');
      expect(calledOptions.headers['Authorization']).toBe('Bearer test-key');
      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.models).toContain('llama-3.2-3b-instruct');
      expect(result.models).toContain('qwen2.5-7b-instruct');
    });

    it('tests Gemini endpoint using GET /v1beta/models?key=... without sending prompts', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-1.5-flash' },
            { name: 'models/gemini-2.0-flash' }
          ]
        })
      });
      globalThis.fetch = mockFetch;

      const result = await testAiModelsEndpoint({
        aiProvider: 'gemini',
        apiKey: 'AIzaSyGeminiKey123'
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyGeminiKey123');
      expect(calledOptions.method).toBe('GET');
      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.models).toEqual(['gemini-1.5-flash', 'gemini-2.0-flash']);
    });
  });
});
