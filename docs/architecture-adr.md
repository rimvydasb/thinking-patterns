# Architecture Decision Record

## ADR-001: The map file is the durable truth, and `MapDocument` is the working copy

- **Status:** Accepted
- **Context:** The user edits the map in the GUI, in a text editor with Git, and through AI agents. Before this decision, `MapDocument` held the map in memory only, and a restart reset it ([map-file-lifecycle-story.md](map-file-lifecycle-story.md), D1).
- **Decision:** `MapFileBinding` connects one `.map.md` file to one `MapDocument`. GUI edits, MCP tool calls and file changes all become `MapOp` batches that `MapDocument.apply()` applies, and the binding writes the document to the file after each content change.
- **Rejected:** the GUI reads and writes the file itself (Tauri `fs`) - the GUI and the MCP server become two writers of one file with no common state.
- **Rejected:** an app database holds the truth and the file is an export - Git review of the file is the main reason for the Markdown format.
- **Consequences:** the existing sync protocol carries file changes with no file-specific content path. A Rust back end MUST replace `MapWorkspace`, `MapFileBinding` and `NodeFsPort` and keep the protocol.

## ADR-002: The map file contains no topic ids, and `reconcileTrees()` matches topics after a file change

- **Status:** Accepted
- **Context:** The GUI needs stable topic ids for selection, undo history and pending edits. Humans and agents edit the file by topic text.
- **Decision:** ids exist only in memory. The parser assigns random ids (`newId()`), including the root. After a file change, `reconcileTrees()` keeps the ids of unchanged, renamed and moved topics. The file content always defines the result.
- **Rejected:** ids in the file (HTML comments or `^id` block anchors) - they add noise to every diff, and agents copy or break them.
- **Rejected:** path ids from `fromOutline()` (`root.0.1`) - after an offline edit, the same id names a different topic, so a pending GUI op changes the wrong topic.
- **Consequences:** a weak match costs only UX (selection, undo), never data. A new root id per load makes `connectSync` replace the map after a server restart or a file switch, so stale pending GUI ops skip.

## ADR-003: `MapFileBinding` detects file changes by stamp and confirms them by content hash

- **Status:** Accepted
- **Context:** Modification times are not reliable: `git checkout` and some editors change them without a content change, and some file systems store them with 1 s or 2 s resolution.
- **Decision:** `FileStamp` is `{mtimeMs, size, hash}`. A directory watch event, a 1000 ms poll and the start of each write run `checkDisk()`; only the poll skips the read when `mtimeMs` and `size` are equal. A read counts as a change only if its SHA-256 hash differs from the known hash, which also suppresses the echo of the binding's own writes.
- **Rejected:** modification time only - it misses same-second, same-size edits and reports false changes.
- **Rejected:** the `chokidar` package - the poll already covers the events that `fs.watch` misses.
- **Consequences:** an integration test verifies that `fs.watch` on macOS reports an atomic rename save. The Rust port uses the `notify` crate with the same poll.

## ADR-004: A file change wins, and unwritten in-memory changes are rebased on it

- **Status:** Accepted
- **Context:** One user can edit the file and the GUI in the same short write window, or an agent can edit the file during a GUI edit.
- **Decision:** on a file change, the binding applies `diffTrees(syncedTree, reconciled parse)` to `MapDocument` as one batch. In-memory changes stay because ops apply leniently; the binding writes the file only if the merged content then differs from the file.
- **Rejected:** a text-level three-way merge - the map is a tree, and the tree-level rebase already exists in `connectSync`.
- **Rejected:** a conflict dialog - with one user, it asks the user to choose between two of their own edits.
- **Consequences:** the binding never rewrites a file only to change its formatting. Concurrent edits of the same topic text keep the in-memory value.

## ADR-005: `remark-parse` reads the map file, and a project serializer writes it

- **Status:** Accepted
- **Context:** The user reviews the file on GitHub and in Git diffs, which render it with CommonMark rules.
- **Decision:** `parseMapFile()` reads the file with `remark-parse` and `remark-frontmatter` and copies topic and note text by node offsets. `serializeMapFile()` is project code that writes the canonical form; golden fixtures in `app/mindmap/model/mapFile/fixtures/` define the expected parse.
- **Rejected:** a hand-written line scanner - it is a private Markdown dialect that differs from what GitHub shows. It also needs a second copy in Rust with no specification to test against.
- **Rejected:** `@tanstack/markdown` 1.2.1 - its AST has no source positions and it resolves escapes, so each write would change text the user did not edit.
- **Rejected:** `remark-stringify` for writing - it applies its own choices for bullets, escapes and blank lines.
- **Consequences:** the Rust back end MUST use a CommonMark parser with source offsets, such as `comrak`. It MUST pass the same fixtures.

## ADR-006: Vitest replaces Jest for all tests

- **Status:** Accepted
- **Context:** Jest with `ts-jest` ran in CommonJS mode, so ESM-only packages such as `remark-parse` needed the experimental `--experimental-vm-modules` flag. `@storybook/test-runner` brought a second Jest.
- **Decision:** Vitest runs the unit and server tests (`unit` project) and the Storybook play tests (`storybook` project). Playwright stays for E2E.
- **Rejected:** `ts-jest` in ESM mode - it depends on an experimental Node flag and keeps a second transform setup next to Vite.
- **Consequences:** `jest`, `ts-jest`, `@types/jest`, `@storybook/test-runner` and `jest.config.cjs` are removed. Tests use the Vite pipeline and `tsconfig.json` with no extra transform setup.
