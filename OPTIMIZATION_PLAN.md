# OpenLingo Performance Optimization Plan

## Executive Summary

After thoroughly analyzing every file in the codebase, we identified **28 optimization opportunities** across 5 categories. The app suffers primarily from: (1) no code-splitting of heavy client components, (2) missing `React.memo` causing cascading re-renders, (3) client-side data fetching waterfalls, (4) redundant server-side queries on every navigation, and (5) missing `loading.tsx` / Suspense boundaries causing perceived slowness.

---

## P0 — Critical, Low Effort, High Impact

### ~~1. Wrap `getSession` in `React.cache()`~~  **[DONE]**
- **File:** `lib/auth-server.ts`
- **Problem:** `getSession()` is called multiple times in the same request tree (main layout, chat layout's `listConversations`, individual pages, etc.) without deduplication. Each call hits the auth API independently.
- **Fix:** Wrap `getSession` in `React.cache()` to deduplicate within a single server render pass.
- **Impact:** Eliminates 2-3 redundant auth calls per request.

### ~~2. Add `loading.tsx` to all routes~~  **[DONE]**
- **Problem:** Only `(main)/units/loading.tsx` exists. All other routes show no visual feedback during server-side data fetching on navigation, making the app feel frozen.
- **Missing routes:**
  - `/chat` and `/chat/[id]`
  - `/read`
  - `/words`
  - `/settings`
  - `/units/[courseId]`
  - `/unit/[unitId]`
  - `/unit/[unitId]/lesson/[lessonIndex]`
  - `/lesson/[courseId]/[unitId]/[lessonIndex]`
- **Fix:** Add `loading.tsx` skeleton files for all data-heavy routes.
- **Impact:** Immediate perceived speed improvement — users see content structure instead of blank screens.

### ~~3. `React.memo` on `ChatMessage`~~  **[DONE]**
- **File:** `components/chat/chat-message.tsx`
- **Problem:** `ChatMessage` is rendered in a `.map()` loop in `chat-view.tsx`. During AI streaming, the messages array changes on every token, causing ALL `ChatMessage` instances to re-render. Only the last message is actually changing.
- **Fix:** Wrap `ChatMessage` in `React.memo`.
- **Impact:** Stops streaming re-render cascade in chat.

### ~~4. `React.memo` on `WordSpan`, `ParagraphText`, `TranslationChunk`~~  **[DONE]**
- **File:** `components/article/translated-text.tsx`
- **Problem:** When `currentAudioTime` changes (~4x/sec from `timeupdate` events), the entire `TranslatedText` -> `TranslationChunk` -> `ParagraphText` -> `WordSpan` tree re-renders. Each component re-renders even when its own props haven't changed.
- **Fix:** Wrap `WordSpan`, `ParagraphText`, and `TranslationChunk` in `React.memo`.
- **Impact:** Stops 4x/sec re-render cascade affecting potentially hundreds of word spans in the article reader.

### ~~5. Memoize `JSON.parse(translatedContent)` in article reader~~  **[DONE]**
- **File:** `app/(main)/read/[id]/page.tsx`
- **Problem:** `JSON.parse(article.translatedContent)` runs on every render (line 213-214), parsing potentially large JSON. With 11 `useState` hooks and audio time updates at ~4x/sec, this is extremely wasteful.
- **Fix:** Wrap in `useMemo` keyed on `article.translatedContent`.
- **Impact:** Stops parsing large JSON 4x/sec during audio playback.

---

## P1 — High Impact, Medium Effort

### 6. `next/dynamic` for exercise components
- **Files:** `lesson-view.tsx:9-17`, `chat-exercise.tsx:5-11`
- **Problem:** Both files statically import ALL exercise types (9 and 7 respectively). Only one exercise renders at a time.
- **Fix:** Use `next/dynamic` per exercise type. `Speaking` (MediaRecorder API) and `Listening` (audio-heavy) are especially good candidates.
- **Impact:** Reduces initial bundle size for lessons and chat pages.

### 7. Convert `read/[id]/page.tsx` to server component (or parallel client fetches)
- **File:** `app/(main)/read/[id]/page.tsx`
- **Problem:** Entire page is `"use client"`. Data is fetched via cascading `useEffect` calls: fetch article -> wait -> fetch audio URL -> wait -> fetch timestamps. Triple waterfall.
- **Fix:** Convert to server component that fetches article data server-side and passes as props, or at minimum fetch all three in parallel on the client.
- **Impact:** Eliminates triple data-loading waterfall.

### 8. Combine `getSrsStats()` into a single SQL query
- **File:** `lib/actions/srs.ts:280-310`
- **Problem:** Five separate `SELECT COUNT(*)` queries, each awaited sequentially. 5 DB round-trips for what could be 1.
- **Fix:** Single query with conditional aggregation: `COUNT(CASE WHEN status = 'new' THEN 1 END)`, etc.
- **Impact:** Reduces 5 DB round-trips to 1.

### 9. Suspense boundary in main layout for stats
- **File:** `app/(main)/layout.tsx:20-23`
- **Problem:** `getUserStatsData()` and `getSrsStats()` block the entire layout (sidebar, nav, content) on every page navigation.
- **Fix:** Wrap stat fetching in a `<Suspense>` boundary so the layout shell renders immediately and stats stream in.
- **Impact:** Layout renders instantly on every navigation.

### 10. Lazy-load PostHog
- **File:** `components/providers/posthog.tsx:3,8-13`
- **Problem:** `posthog-js` (~40-50KB) initialized at module scope, included in every page's client bundle.
- **Fix:** Lazy-load PostHog initialization after hydration using `next/dynamic` with `ssr: false`, or defer `posthog.init()` to `useEffect`.
- **Impact:** Saves ~40-50KB from initial client bundle.

---

## P2 — Medium Impact, Low-Medium Effort

### 11. `next/dynamic` for `AudioPlayer` and `ReadingMode`
- **File:** `app/(main)/read/[id]/page.tsx:5-7`
- **Problem:** Both are statically imported but conditionally rendered (only on user action).
- **Fix:** Dynamic import with loading fallback.

### 12. Client-side word lookup cache
- **File:** `components/word/word-tooltip.tsx:46`
- **Problem:** Fetches `/api/word/lookup` on every click. Same word clicked twice = two API calls.
- **Fix:** Add module-level `Map` cache keyed by `${word}-${language}` (same pattern as `use-audio.ts`).

### 13. Configure `next.config.ts`
- **File:** `next.config.ts`
- **Problem:** Completely empty. No `serverExternalPackages` for heavy server-only deps (`@aws-sdk/client-s3`, `openai`, `linkedom`). No `experimental.optimizePackageImports`.
- **Fix:** Add both configurations.

### 14. Extract `currentAudioTime` state to prevent parent re-renders
- **File:** `app/(main)/read/[id]/page.tsx:62`
- **Problem:** `setCurrentAudioTime` updates state ~4x/sec, causing the entire 464-line page component (with 11 useState hooks) to re-render.
- **Fix:** Extract audio time tracking into a dedicated child component or use a ref + callback pattern.

### 15. Memoize `HoverableMarkdown` output
- **File:** `components/word/hoverable-markdown.tsx:55`
- **Problem:** `makeHoverable()` recursively walks and clones the React element tree on every render. Runs for every chat message.
- **Fix:** Memoize based on `text` and `language` props.

### 16. Parallelize `getProfileData()` queries
- **File:** `lib/actions/profile.ts:18-28`
- **Problem:** Sequential DB queries that could be `Promise.all`.

### 17. Include `getPreferredModel()` in `Promise.all` on chat page
- **File:** `app/(main)/chat/[id]/page.tsx:22`
- **Problem:** Runs after the parallel block instead of inside it.

---

## P3 — Low Impact, Quick Wins

### 18. Add `error.tsx` boundaries
- **Problem:** Zero `error.tsx` files. Unhandled errors crash to Next.js default.
- **Fix:** Add at least at `(main)` layout level.

### 19. Debounce MobileNav chat draft updates
- **File:** `components/layout/mobile-nav.tsx`
- **Problem:** Re-renders on every keystroke in chat input via custom DOM events.

### 20. Pre-compute CEFR level counts in word explorer
- **File:** `app/(main)/words/word-explorer.tsx:216`
- **Problem:** `words.filter()` runs 6x per render inside a `.map()`.
- **Fix:** Single `useMemo` computing a `Map<string, number>`.

### 21. Memoize `text.split()` in `ParagraphText`
- **File:** `components/article/translated-text.tsx:99`
- **Problem:** Not memoized, re-runs on every parent re-render.

### 22. Add `<link rel="preconnect">` for external services
- **Problem:** No preconnect hints for PostHog host, Cloudflare R2, or AI provider APIs.

### 23. Add middleware for faster auth redirects
- **Problem:** Unauthenticated users pay the cost of SSR up to layout rendering before redirect.
- **Fix:** Lightweight `middleware.ts` that checks for session cookie.

---

## Architecture Notes

- **Runtime:** Bun (package manager + script runner), Next.js 16 with Turbopack (dev)
- **React:** v19.2.3
- **Database:** PostgreSQL 16 via Drizzle ORM
- **Auth:** better-auth (email/password + Google OAuth)
- **AI:** Vercel AI SDK 6 with Anthropic/Google/OpenAI providers
- **CSS:** Tailwind CSS v4 (single `globals.css`, no CSS-in-JS)
- **Fonts:** `next/font/google` (Geist + Geist Mono, self-hosted)
- **Analytics:** PostHog
- **Storage:** Cloudflare R2 for audio files
- **Client components:** 54 files with `"use client"`
- **Server components:** ~16 files (pages + layouts)
