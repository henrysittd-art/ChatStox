# .harness/plan.md

## 1. Architecture & Schema
- **Typography & Styling**: Apply new design system to `StockChatScreen` and `GeneralChatScreen`.
  - Background: `#F7F7F8`
  - Bubbles: User (`#FFD400` background, `#111111` text), AI (`#FFFFFF` background, `#111111` text). Max width 75%, radius 20px, padding 14px x 10px.
  - Text Sizes: Name 18px (600), Message 16px (400), Time 12px (400), Separators 13px (500).
  - Header: Height 72px.
  - Input: Height 56px, Radius 28px, Placeholder 16px.
- **Gráfica Action**: 
  - Remove `<PriceChart>` from the top layout in `StockChatScreen`.
  - Add a Quick Action button "Gráfica".
  - When pressed, it will inject a local chat message `{ role: 'assistant', content: '', showChart: true, chartTicker: currentTicker }` to display the chart natively inside the conversation.
- **SidebarDrawer**: Remove the "Recent Chats" section from `src/components/SidebarDrawer.js` to simplify the navigation as requested.

## 2. Edge Case Matrix
1. **Empty Chat Chart Display**: If the user clicks "Gráfica" right away, the message should just append at the bottom seamlessly. Button will be disabled during `loading` or `thinking`.
2. **AI Context Bloat**: The injected chart message (with empty content) could confuse the AI if included in history. Mitigation: It has empty text, so the AI will likely ignore it, or we filter it out before sending to AI.
3. **GeneralChatScreen Styling**: We must also apply the bubble and input styles to `GeneralChatScreen.js` for consistency.
4. **Missing Font**: We will implement the exact sizes and weights. If 'Inter' is not loaded globally, system fonts will gracefully fallback with the specified weights.

## 3. Security Vector
- **State Integrity**: Injecting the chart message directly into the state ensures it only exists locally in the UI and doesn't pollute the backend/AI memory with false prompts.
