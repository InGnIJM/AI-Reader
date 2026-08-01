# Annotation Interaction Fixes

## Goal

Make comment deletion reliable and discoverable, preserve a user's manual collapse choice, keep the comment panel aligned with the article being read, and let a source highlight navigate to its comment.

## Design

- The preload fallback channel map includes the annotation-delete channel. The delete control is a labelled destructive action with a safe hit target, a visible outline, and a higher stacking layer than the card header.
- `AnnotationSidebar` keeps manual expansion state independent from external annotation activation. An answered annotation may auto-expand once; a card manually collapsed by the user remains collapsed until the user expands it.
- Each rendered assistant document reports visibility to the workbench. The workbench promotes the visible document to the active document, clears stale selection state, and reloads its traces and annotations with the existing request-sequence race guard.
- Clicking a source highlight activates its annotation. The sidebar expands and scrolls the matching comment card into view, then focuses its accessible header.

## Testing

Add regression tests for the preload fallback channel, the first manual collapse, visible-document comment switching, source-highlight-to-card focus, and delete-control semantics. Retain existing unit and workbench suites, then run type checking and coverage.
