/**
 * @fileoverview Tasktotime — Wiki editor (MDXEditor v3.x wrapper).
 *
 * Phase 4.3 standalone component. Wraps `@mdxeditor/editor` with a small,
 * tree-shake-friendly plugin set so the rendered editor stays close to the
 * ~200 KB gzipped budget. The component round-trips real Markdown (no opaque
 * JSON state), which lets the parent persist `value` directly to Firestore as
 * a string and diff/version it without a custom serializer.
 *
 * What this component is:
 *   - Controlled-ish: `value` seeds the editor on mount (MDXEditor reads
 *     `markdown` once and ignores subsequent prop changes by design — see the
 *     editor's docs); `onChange(md)` fires on every internal edit so the parent
 *     keeps an up-to-date copy for save / preview / autosave hooks.
 *   - Read-only aware: when `readOnly` flips on, the toolbar collapses and
 *     the contenteditable goes inert.
 *   - Image-upload aware: when `onAttachmentUpload(file) → Promise<URL>` is
 *     provided, the toolbar's "insert image" button + drag-and-drop becomes
 *     active; otherwise drop is disabled and the toolbar button uploads to
 *     `null` (MDXEditor falls back to a "no upload handler" UX).
 *
 * What this component is NOT (intentional, future PRs):
 *   - It does NOT wire Firebase Storage. The caller passes a callback; the
 *     placeholder demo on `/crm/tasktotime/wiki-demo` returns a stub URL.
 *   - It does NOT integrate into `TaskDetailPage` — that lands in the Phase
 *     4.1 PR. Keep this component pure-presentational so 4.1 can drop it in
 *     without entangling.
 *   - It does NOT version, diff, or autosave. The caller owns those.
 *
 * Theming:
 *   MDXEditor uses Radix-scoped CSS variables. Mapping a few tokens onto MUI
 *   palette/typography keeps the editor visually aligned with the surrounding
 *   surfaces without leaking styles globally (the overrides are scoped via a
 *   single class on the wrapper `<Box>`).
 *
 * Bundle:
 *   The editor bundle is split off automatically by Vite because MDXEditor is
 *   a top-level dependency loaded only by the views that import this file.
 *   Phase 4.3 ships the editor lazily through the demo page; integration in
 *   4.1 should follow the same `React.lazy` pattern so users who never open
 *   a task-detail page never download the editor.
 */

import React from 'react';
import { Box, Paper } from '@mui/material';
import {
    MDXEditor,
    headingsPlugin,
    listsPlugin,
    quotePlugin,
    linkPlugin,
    linkDialogPlugin,
    imagePlugin,
    tablePlugin,
    toolbarPlugin,
    UndoRedo,
    BoldItalicUnderlineToggles,
    BlockTypeSelect,
    ListsToggle,
    CreateLink,
    InsertImage,
    InsertTable,
    Separator,
    type MDXEditorMethods,
} from '@mdxeditor/editor';

// MDXEditor ships its own stylesheet. The import is side-effectful by design
// (the package's `package.json` lists `*.css` under `sideEffects`); Vite will
// bundle this CSS only into the chunk that imports this file, which is what
// keeps the editor cost off the main bundle.
import '@mdxeditor/editor/style.css';

export interface WikiEditorProps {
    /** Initial Markdown value. Read once on mount. */
    value: string;
    /** Fires on every keystroke / structural edit with the up-to-date Markdown. */
    onChange: (markdown: string) => void;
    /** When `true`, the toolbar is hidden and the contenteditable is inert. */
    readOnly?: boolean;
    /**
     * Optional callback for image / file uploads. If omitted, image insertion
     * via toolbar still renders a UI, but drag-and-drop image dropping is
     * disabled (MDXEditor will not accept a file without a handler).
     *
     * Contract: receive a single `File`, return a hosted URL (e.g. Firebase
     * Storage download URL) the editor can embed. Throwing rejects the upload.
     */
    onAttachmentUpload?: (file: File) => Promise<string>;
    /**
     * Optional ref to the underlying editor methods (`getMarkdown`,
     * `setMarkdown`, `focus`, etc). Useful for parents that need to imperatively
     * update content (e.g. after a remote-conflict merge) without remounting.
     */
    editorRef?: React.Ref<MDXEditorMethods>;
}

/**
 * Build the plugin list inside the component so `onAttachmentUpload` is
 * captured fresh on every render (rebuild cost is ~free; the plugins are
 * factory-created descriptors, not heavy state).
 *
 * Plugins included (and only these — keep the bundle thin):
 *   - headingsPlugin: H1–H6 nodes
 *   - listsPlugin: bullet, numbered, task-list
 *   - quotePlugin: blockquote
 *   - linkPlugin + linkDialogPlugin: anchor nodes + the floating "edit link" UI.
 *     `linkDialogPlugin` is required for `<CreateLink />` to function — the
 *     toolbar button opens its dialog. Both must be present.
 *   - imagePlugin: image nodes + optional upload handler
 *   - tablePlugin: GFM tables
 *   - toolbarPlugin: top toolbar with the canonical block buttons
 *
 * Explicitly NOT included (keep them out unless asked):
 *   - codeBlockPlugin / codeMirrorPlugin (heavy: pulls CodeMirror)
 *   - sandpackPlugin (extremely heavy: pulls @codesandbox/sandpack-react)
 *   - diffSourcePlugin (markdown diff viewer; not needed for in-page editing)
 *   - frontmatterPlugin (we don't use frontmatter on task wikis)
 *   - directivesPlugin / jsxPlugin (custom MDX components — out of scope)
 */
function buildPlugins(
    onAttachmentUpload: WikiEditorProps['onAttachmentUpload'],
    readOnly: boolean,
) {
    const plugins = [
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        tablePlugin(),
        imagePlugin({
            // `null` disables drag-and-drop / paste uploads; the toolbar button
            // still works for URL-based images. When a handler is supplied we
            // hand it through directly (MDXEditor's signature is identical to
            // ours).
            imageUploadHandler: onAttachmentUpload ?? null,
        }),
    ];

    if (!readOnly) {
        plugins.push(
            toolbarPlugin({
                toolbarClassName: 'wiki-editor-toolbar',
                toolbarContents: () => (
                    <>
                        <UndoRedo />
                        <Separator />
                        <BoldItalicUnderlineToggles />
                        <Separator />
                        <BlockTypeSelect />
                        <Separator />
                        <ListsToggle />
                        <Separator />
                        <CreateLink />
                        <InsertImage />
                        <InsertTable />
                    </>
                ),
            }),
        );
    }

    return plugins;
}

/**
 * Map MUI design tokens to the MDXEditor / Radix CSS-variable surface.
 *
 * MDXEditor exposes a long list of `--baseN` / `--accentN` / `--font-body`
 * vars (Radix Colors palette). We override a focused subset so the editor
 * picks up the host theme without us forking its stylesheet. Anything we
 * don't override falls back to MDXEditor's defaults (the Radix `slate` /
 * `blue` scales), which is fine in the meantime.
 *
 * Scoped via the `.tasktotime-wiki-editor-root` class on the outer Box so the
 * overrides never leak past this component's subtree.
 */
const editorThemeSx = {
    '--accentBase': 'rgba(0, 122, 255, 0.10)',
    '--accentBgSubtle': 'rgba(0, 122, 255, 0.08)',
    '--accentBg': '#E3F2FD',
    '--accentBgHover': '#BBDEFB',
    '--accentBgActive': '#90CAF9',
    '--accentLine': '#90CAF9',
    '--accentBorder': '#64B5F6',
    '--accentBorderHover': '#42A5F5',
    '--accentSolid': '#007AFF',
    '--accentSolidHover': '#005FCC',
    '--accentText': '#005FCC',
    '--accentTextContrast': '#FFFFFF',

    '--baseBg': '#FFFFFF',
    '--baseBase': '#FAFBFC',
    '--baseBgSubtle': '#F9FAFB',
    '--baseBgHover': '#F3F4F6',
    '--baseBgActive': '#E5E7EB',
    '--baseLine': '#E5E7EB',
    '--baseBorder': '#E0E0E0',
    '--baseBorderHover': '#BDBDBD',
    '--baseSolid': '#9CA3AF',
    '--baseText': '#374151',
    '--baseTextContrast': '#111827',

    '--font-body':
        '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    '--font-mono': '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace',

    // Subtle styling on the editor's internal containers. Keep these minimal
    // — anything more aggressive risks fighting MDXEditor's internal layout.
    '& .wiki-editor-toolbar': {
        borderBottom: '1px solid #E0E0E0',
    },
    '& .mdxeditor-root-contenteditable': {
        minHeight: 240,
        padding: '12px 16px',
    },
    '& [contenteditable="true"]:focus': {
        outline: 'none',
    },
} as const;

const WikiEditor: React.FC<WikiEditorProps> = ({
    value,
    onChange,
    readOnly = false,
    onAttachmentUpload,
    editorRef,
}) => {
    // MDXEditor's `onChange` exposes a 2nd boolean param (`initialMarkdownNormalize`)
    // we don't surface — callers shouldn't have to care whether a normalize-on-load
    // pass triggered the call. They want the latest Markdown either way.
    const handleChange = React.useCallback(
        (markdown: string) => {
            onChange(markdown);
        },
        [onChange],
    );

    const plugins = React.useMemo(
        () => buildPlugins(onAttachmentUpload, readOnly),
        [onAttachmentUpload, readOnly],
    );

    return (
        <Paper
            elevation={1}
            sx={{
                overflow: 'hidden',
                border: '1px solid #E0E0E0',
                bgcolor: '#FFFFFF',
            }}
        >
            <Box
                className="tasktotime-wiki-editor-root"
                sx={editorThemeSx}
            >
                <MDXEditor
                    ref={editorRef}
                    markdown={value}
                    onChange={handleChange}
                    readOnly={readOnly}
                    plugins={plugins}
                    contentEditableClassName="mdxeditor-root-contenteditable"
                />
            </Box>
        </Paper>
    );
};

export default WikiEditor;
