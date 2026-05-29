import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTTSCacheKey,
  buildTTSClientCacheKey,
  buildTTSProfileTag,
  buildLocalAudioCacheEntry,
  normalizeVoiceId,
  OPENAI_TTS_VOICE_OPTIONS,
  resolveOpenAITTSVoice,
  resolveTTSLanguageCode,
  resolveTTSVoice,
} from "./tts-voice.ts";

describe("TTS voice helpers", () => {
  it("normalizes optional voice ids from user input", () => {
    assert.equal(normalizeVoiceId(" fr_male "), "fr_male");
    assert.equal(normalizeVoiceId(""), undefined);
    assert.equal(normalizeVoiceId("bad/slash"), undefined);
  });

  it("prefers a valid runtime voice over the configured fallback", () => {
    assert.equal(resolveTTSVoice("fr", "default", "af_heart"), "fr");
    assert.equal(resolveTTSVoice(undefined, "default", "af_heart"), "default");
    assert.equal(resolveTTSVoice(" ", undefined, "af_heart"), "af_heart");
  });

  it("includes voice in profile and cache keys", () => {
    assert.equal(buildTTSProfileTag("chatterbox", "fr"), "chatterbox:fr");
    assert.equal(
      buildTTSCacheKey("chatterbox:fr", "bonjour"),
      "chatterbox:fr|bonjour",
    );
    assert.equal(buildTTSClientCacheKey("fr", "default"), "fr:default");
    assert.equal(buildTTSClientCacheKey("fr", "zh"), "fr:zh");
  });

  it("falls back to provider-valid OpenAI voices in cloud mode", () => {
    const voiceIds = OPENAI_TTS_VOICE_OPTIONS.map((voice) => voice.id);
    assert.ok(voiceIds.includes("coral"));
    assert.ok(!voiceIds.includes("default"));
    assert.equal(resolveOpenAITTSVoice("default"), "coral");
    assert.equal(resolveOpenAITTSVoice("fr_male"), "coral");
    assert.equal(resolveOpenAITTSVoice("cedar"), "cedar");
  });

  it("maps supported language names and codes before text heuristics", () => {
    assert.equal(resolveTTSLanguageCode("de", "hello"), "de");
    assert.equal(resolveTTSLanguageCode("German", "hello"), "de");
    assert.equal(resolveTTSLanguageCode("es", "hello"), "es");
    assert.equal(resolveTTSLanguageCode("Italian", "hello"), "it");
    assert.equal(resolveTTSLanguageCode("ja-JP", "hello"), "ja");
    assert.equal(resolveTTSLanguageCode("japanese-hiragana", "hello"), "ja");
    assert.equal(resolveTTSLanguageCode("../../tmp/foo", "hello"), "en");
    assert.equal(resolveTTSLanguageCode("../../tmp/foo", "你好"), "zh");
  });

  it("keeps local cache files inside the audio cache root", () => {
    const entry = buildLocalAudioCacheEntry(
      "/repo/.audio-cache",
      "../../tmp/foo",
      "abcdef",
      "hello",
    );
    assert.equal(entry.language, "en");
    assert.equal(entry.publicKey, "local/en/abcdef.mp3");
    assert.equal(entry.filePath, "/repo/.audio-cache/en/abcdef.mp3");
    assert.ok(entry.filePath.startsWith("/repo/.audio-cache/"));
  });
});
