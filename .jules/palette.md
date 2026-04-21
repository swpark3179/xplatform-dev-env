## 2024-04-11 - Add focus visible styles
**Learning:** Keyboard navigation through tree items needs visible focus states.
**Action:** Add custom CSS for focus-visible on the icon buttons or rely on inline styles if global CSS cannot be modified easily.
**Action:** Added role="button" and tabIndex={0} and onKeyDown handler to 'tree-header' in ChangedFilesModal.tsx for better accessibility.
## 2024-05-15 - Ensure title and aria-label match for screen readers, and add aria-expanded to custom collapsibles
**Learning:** Found several places where icon-only buttons had static "title" attributes (e.g., `title="제거"`) but dynamic `aria-label` attributes (e.g., `aria-label="file.txt 제거"`). For screen reader consistency and clear visual tooltips, both should dynamically reflect the item they act on. Also discovered custom implementations of collapsible elements using `role="button"` which lacked `aria-expanded` state.
**Action:** When adding or checking `aria-label`s on icon-only buttons within lists, ensure `title` also receives the dynamic text. Always add `aria-expanded` to custom element collapsibles to announce open/close state.
