# Settings help maintenance

When adding or changing a setting or operation:

- Add or update its explanation in `src/qna/settingsHelp.ts`, or provide an explicit `data-settings-help` description for contextual controls.
- Explain what it changes, when it applies, and relevant filter or calculation limits. Do not claim unsupported behaviour.
- Keep the small help marker beside the caption. It must support hover and keyboard focus; clicking it must not toggle the control.
- Section headings created by `settingsLayout` reuse their descriptions as tooltip text. Update those descriptions when behaviour changes.
- Add coverage for new controls. Verify that dynamically added editors receive help and do not duplicate markers.
- Review affected help text with every behaviour change; automated coverage checks cannot verify that prose is accurate.

Existing settings still need a full coverage audit; do not substitute generic explanations merely to achieve a count.
