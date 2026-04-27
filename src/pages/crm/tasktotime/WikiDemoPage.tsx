/**
 * @fileoverview Tasktotime — Wiki editor demo page.
 *
 * **Temporary** route at `/crm/tasktotime/wiki-demo`. Used to verify the
 * MDXEditor wrapper renders, round-trips Markdown, and lays out cleanly under
 * `MainLayout`. This file is intended to be deleted in the Phase 4.1 PR that
 * embeds the editor inside `TaskDetailPage`.
 *
 * What this page does:
 *   - Mounts a `<WikiEditor>` with a hard-coded Markdown sample containing
 *     each block type the wrapper supports (headings, lists, link, table)
 *     so a quick visual scan validates plugin coverage.
 *   - Mirrors the live editor value into a `<pre>` next to it. Watching the
 *     `<pre>` update on each keystroke is the cheapest way to confirm the
 *     `onChange` contract is working before integration.
 *   - Stubs `onAttachmentUpload` with an artificial 500 ms delay returning a
 *     placeholder URL. **No Firebase Storage wiring** — that's a future PR.
 *
 * What this page does NOT do:
 *   - Persist anything. Reload = fresh state.
 *   - Read or write Firestore.
 *   - Validate Markdown shape (e.g. strip unsupported MDX directives).
 */

import React from 'react';
import { Box, Stack, Typography, Alert } from '@mui/material';

import WikiEditor from '../../../components/tasktotime/WikiEditor';

const INITIAL_MARKDOWN = `# Wiki editor demo

This page is a temporary smoke-test for the **Phase 4.3** Wiki editor wrapper.
The component round-trips real Markdown, so anything you type below should
appear in the live source on the right.

## Why MDXEditor

We picked MDXEditor v3.x because:

- it serializes to plain Markdown (no opaque JSON state);
- it ships a built-in image-upload hook we can wire to Firebase Storage later;
- it tree-shakes — we only load 6 plugins.

## Things you can try

1. Toggle a heading via the block-type select.
2. Make a [link](https://profit-step.web.app) using the toolbar.
3. Insert a table:

| Column A | Column B |
| -------- | -------- |
| one      | two      |
| three    | four     |

4. Drag an image onto the editor — it'll go through the placeholder upload
   handler that returns a stub URL after 500 ms.

> Tip: the live Markdown source on the right updates on every keystroke.
`;

/**
 * Tiny sleep helper. Inlined so the page has zero internal deps beyond the
 * editor itself, which keeps it trivially deletable in the integration PR.
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

const WikiDemoPage: React.FC = () => {
    const [markdown, setMarkdown] = React.useState<string>(INITIAL_MARKDOWN);

    const handleAttachmentUpload = React.useCallback(async (file: File): Promise<string> => {
        // Simulate latency so we can see the editor's "uploading…" state in
        // a realistic-feeling cadence. No real upload happens — Firebase
        // Storage wiring lands in a follow-up PR.
        await sleep(500);
        // eslint-disable-next-line no-console
        console.info(
            `[WikiDemoPage] stub upload for "${file.name}" (${file.size} bytes) — returning placeholder URL`,
        );
        return 'https://placehold.co/600x400';
    }, []);

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                bgcolor: '#FAFBFC',
            }}
        >
            {/* Page header — matches the visual rhythm of TaskListPage so the
                demo feels native to the tasktotime layout. */}
            <Box
                sx={{
                    px: 3,
                    py: 1.5,
                    borderBottom: '1px solid #E0E0E0',
                    bgcolor: '#FFFFFF',
                    flexShrink: 0,
                }}
            >
                <Typography
                    variant="h6"
                    fontWeight={700}
                    sx={{
                        fontFamily:
                            '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                    }}
                >
                    Wiki editor — demo
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    Temporary route. Will be removed when the editor lands inside TaskDetailPage.
                </Typography>
            </Box>

            <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 2, md: 3 } }}>
                <Alert severity="info" sx={{ mb: 2 }}>
                    Image upload is stubbed — the handler returns a placeholder
                    URL after 500&nbsp;ms. Firebase Storage wiring is a follow-up PR.
                </Alert>

                <Stack
                    direction={{ xs: 'column', lg: 'row' }}
                    spacing={2}
                    alignItems="stretch"
                    sx={{ minHeight: 480 }}
                >
                    {/* Editor column */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                            variant="overline"
                            sx={{ display: 'block', mb: 1, color: '#6B7280', fontWeight: 700 }}
                        >
                            Editor
                        </Typography>
                        <WikiEditor
                            value={INITIAL_MARKDOWN}
                            onChange={setMarkdown}
                            onAttachmentUpload={handleAttachmentUpload}
                        />
                    </Box>

                    {/* Live source column */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                            variant="overline"
                            sx={{ display: 'block', mb: 1, color: '#6B7280', fontWeight: 700 }}
                        >
                            Live Markdown source
                        </Typography>
                        <Box
                            component="pre"
                            sx={{
                                m: 0,
                                p: 2,
                                bgcolor: '#0F172A',
                                color: '#E2E8F0',
                                borderRadius: 1,
                                border: '1px solid #1E293B',
                                fontSize: '0.8rem',
                                fontFamily:
                                    '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                overflow: 'auto',
                                maxHeight: 640,
                                minHeight: 240,
                            }}
                        >
                            {markdown}
                        </Box>
                    </Box>
                </Stack>
            </Box>
        </Box>
    );
};

export default WikiDemoPage;
