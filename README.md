# Thinking Patterns – MindMap MVP

In-memory mind map editor built with React, React Flow, ELK.js and Zustand. See [docs/mindmap-spec.md](docs/mindmap-spec.md).

## Run

```sh
npm install
npm run dev          # stand-alone app at http://localhost:5173
npm run storybook    # 5 example stories at http://localhost:6006
```

The app accepts `?sample=software-factory|product-launch|organisation|thinking-patterns` and `?layout=mindmap|logic|org`.

## Test

| Command                     | What                                                                  |
| --------------------------- | --------------------------------------------------------------------- |
| `npm test`                  | Jest unit tests: tree model, ELK layout, measurement, store           |
| `npm run test:e2e`          | Playwright GUI tests against the stand-alone app (starts Vite itself) |
| `npm run test:storybook`    | Story play functions against a running `npm run storybook`            |
| `npm run test:storybook:ci` | Builds Storybook, serves it and runs the play functions               |
| `npm run test:all`          | Typecheck + all of the above                                          |

## Shortcuts (XMind-style)

| Key                             | Action                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| Tab                             | Add child (also from inside the editor: commit + add child)  |
| Enter / Shift+Enter             | Add sibling after / before                                   |
| ⌘/Ctrl+Enter                    | Insert parent topic                                          |
| Delete, Backspace               | Delete topic and its subtopics                               |
| F2, Space, or just start typing | Edit text (Enter commits, Shift+Enter new line, Esc cancels) |
| Arrows                          | Move selection, following the layout direction               |
| Alt+Arrows                      | Reorder among siblings                                       |
| ⌘/Ctrl+/                        | Collapse / expand                                            |
| ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z        | Undo / redo                                                  |

## Structure

```
src/mindmap/
  model/       pure, immutable tree operations + keyboard navigation (no React)
  layout/      ELK.js auto-layout, text measurement, colours
  store/       Zustand store (selection, editing, undo/redo)
  components/  MindMap (React Flow canvas), TopicNode, BranchEdge, Toolbar
  MindMap.stories.tsx
e2e/           Playwright tests for the app
```

Layouts: **Mind Map** (balanced, both sides), **Logic Chart** (right) and **Org Chart** (down). The model is a plain hierarchical tree (`fromOutline` / `toOutline`), ready for the Markdown-list persistence phase.
