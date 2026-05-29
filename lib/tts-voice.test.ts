import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTTSCacheKey,
  buildTTSClientCacheKey,
  buildTTSProfileTag,
  normalizeVoiceId,
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
});
