# OpenLingo UI — Voice 音色切换功能

## 目标
在 OpenLingo 的某个合适位置（如用户设置页或对话侧边栏）添加一个 **Voice 音色选择器**，让用户可以实时切换 TTS 音色。

## 背景

OpenLingo 使用 `lib/tts.ts` 调用本地 TTS 服务。当前音色由 `.env.local` 中的 `LOCAL_TTS_VOICE` 决定，用户无法在 UI 中更改。

后端已支持通过 API 传 `voice` 参数（OpenAI SDK 兼容），前端只需把用户选择的 voice 传到后端即可。

## 需要修改的文件

### 1. `lib/tts.ts` — 让后端支持动态 voice

当前 `getTTSClient()` 和 `getTTSClientForLanguage()` 从环境变量读取 voice，不支持运行时切换。

需要：
- 新增一个可选参数 `preferredVoice?: string`
- 如果传了 `preferredVoice`，优先使用；否则回退到 `LOCAL_TTS_VOICE`
- `ttsProfileTag()` 需要包含 voice，确保缓存正确失效

```typescript
// lib/tts.ts 改动示意
export function getTTSClient(preferredVoice?: string): TTSClient {
  const voice = preferredVoice ?? process.env.LOCAL_TTS_VOICE ?? "fr_male";
  // ... 其余不变
}
```

### 2. `app/api/tts/route.ts` — 接受 voice 参数

当前的 TTS API endpoint 接收 `{ text, language }`，需要扩展为接受可选的 `voice`：

```typescript
const { text, language, voice } = await request.json();
// 把 voice 传给 generateSpeech 或 getTTSClient
```

### 3. 新增 `app/api/voices/route.ts` — 返回可用音色列表

前端需要知道当前模型支持哪些音色。新增一个 endpoint：

```typescript
// GET /api/voices?model=voxtral
// 返回:
// {
//   "model": "voxtral",
//   "voices": [
//     { "id": "fr_male", "name": "French Male", "language": "fr" },
//     { "id": "fr_female", "name": "French Female", "language": "fr" },
//     ...
//   ]
// }
```

实现方式：
- 先尝试访问 `LOCAL_TTS_URL/v1/voices`（本地 TTS 服务提供）
- 如果不可用，fallback 到硬编码的映射表（按 `LOCAL_TTS_MODEL` 匹配）

### 4. 前端 UI — 音色选择器

在合适的位置添加 voice selector：

**推荐位置**：
- 对话页面侧边栏底部（和语言选择器并列）
- 或用户设置页的 "Voice & Audio" 区块

**行为**：
- 下拉选择框，列出当前模型支持的音色
- 选择后立即生效，下一次 TTS 请求使用新音色
- 选择持久化到 localStorage（用户刷新后保留）
- 切换音色后，已缓存的音频需要重新生成（或提示用户）

**状态管理**：
```typescript
// 用 React Context 或 Zustand store
const useVoiceStore = create((set) => ({
  voice: localStorage.getItem("tts_voice") ?? "fr_male",
  setVoice: (v: string) => {
    localStorage.setItem("tts_voice", v);
    set({ voice: v });
  },
}));
```

### 5. 前端 TTS 调用 — 传入 voice

找到前端调用 TTS API 的位置（可能在聊天组件或单词卡片组件），把 `voice` 加到请求 body：

```typescript
const res = await fetch("/api/tts", {
  method: "POST",
  body: JSON.stringify({ text, language, voice: selectedVoice }),
});
```

## 音色参考表

按模型分类（供 fallback 使用）：

| 模型 | 可用音色 |
|------|----------|
| voxtral | fr_male, fr_female, casual_male, casual_female, neutral_male, neutral_female, de_male, de_female, es_male, es_female, it_male, it_female |
| chatterbox | default, en_us, en_gb, fr, zh |
| kokoro | af_heart, af_bella, am_adam, am_michael, bf_emma, bm_george |
| cosyvoice3 | default, zh_female, zh_male, en_female |

## 验收标准

- [ ] UI 能看到当前模型支持的音色列表
- [ ] 用户可以选择不同音色
- [ ] 选择后下一次 TTS 使用新音色
- [ ] 刷新页面后选择仍然保留
- [ ] 切换音色后，已缓存音频提示用户"音色已更改，点击重新播放"

## 不做的

- 不需要支持 per-language 不同音色的独立配置（这已经在 `LOCAL_TTS_URL_EN/FR/ZH` 中支持）
- 不需要实时预览音色（可以后续迭代）
