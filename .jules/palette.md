## 2024-04-11 - Add focus visible styles
**Learning:** Keyboard navigation through tree items needs visible focus states.
**Action:** Add custom CSS for focus-visible on the icon buttons or rely on inline styles if global CSS cannot be modified easily.
**Action:** Added role="button" and tabIndex={0} and onKeyDown handler to 'tree-header' in ChangedFilesModal.tsx for better accessibility.
