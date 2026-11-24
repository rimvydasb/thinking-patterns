# Thinking Patterns – MindMap MVP

Mind map editor built with React, React Flow, ELK.js and Zustand, with a Fastify server that exposes the maps to AI agents over MCP and pushes their changes live to the app. See [docs/mindmap-spec.md](docs/mindmap-spec.md) and [docs/mcp-server-spec.md](docs/mcp-server-spec.md).

## Run

```sh
npm install
npm run dev:all      # MCP/sync server on :3001 + app at http://localhost:5173 (live sync)
npm run dev          # app only (works offline, retries the server in the background)
npm run server       # server only, MCP endpoint http://localhost:3001/mcp
npm run storybook    # 5 example stories at http://localhost:6006
```

The app syncs its map with the server by default. It accepts `?sample=software-factory|product-launch|organisation|thinking-patterns` or `?offline` (in-memory, no server), and `?layout=mindmap|logic|org`.

## MCP

Claude Code picks up the server from [.mcp.json](.mcp.json) while `npm run server` runs. For other clients: `claude mcp add --transport http thinking-patterns http://localhost:3001/mcp`.

The agent works on the one map the user has open. It names topics by text (`topicName`) or, when the text is not unique, by path (`topicPath`, e.g. `["Plan", "Product", "Risks"]`); an ambiguous name returns a question listing every matching path.

Tools: `get_topic`, `search_topics`, `get_selection`, `add_topics`, `update_topic`, `move_topic`, `delete_topics`, `group_topics`, `replace_map`, `focus_topic`. See [docs/mcp-server-spec.md](docs/mcp-server-spec.md).

## Test

| Command                     | What                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `npm test`                  | Vitest: model, ops/diff, layout, store, server map, MCP tools, live sync |
| `npm run test:e2e`          | Playwright GUI tests (starts the server and Vite itself)                 |
| `npm run test:storybook`    | Vitest: story play functions in headless Chromium (no server needed)     |
| `npm run test:storybook:ci` | Same as `test:storybook` (kept for CI)                                   |
| `npm run test:all`          | Typecheck + all of the above                                             |

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
app/mindmap/
  model/       pure tree operations, MapOp ops + diff, Markdown lists (shared with the server)
  layout/      ELK.js auto-layout, text measurement, colours
  store/       Zustand store (selection, editing, undo/redo)
  components/  MindMap (React Flow canvas), TopicNode, BranchEdge, Toolbar
  sync/        WebSocket protocol + sync client (optimistic edits, rebase, reconnect)
  MindMap.stories.tsx
server/
  map/         MapDocument: the open map in memory (source of truth, versions, change events)
  mcp/         MCP tools, topic name/path resolution, Streamable HTTP route (POST /mcp)
  sync/        WebSocket /api/sync that pushes changes to the app
  api/         GET /api/health, /api/map
e2e/           Playwright tests for the app
```

Layouts: **Mind Map** (balanced, both sides), **Logic Chart** (right) and **Org Chart** (down). The model is a plain hierarchical tree (`fromOutline` / `toOutline`), ready for the Markdown-list persistence phase.
