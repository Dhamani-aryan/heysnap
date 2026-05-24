import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactElement } from "react";

import type { FilesystemEntry } from "../../../filesystem/types";
import {
  DesktopContextMenu,
  DesktopEntryContextMenu,
  DesktopSelectionContextMenu,
} from "./finder-context-menu";
import { EntryIcon } from "./finder-icons";
import type { ContextMenuState, SelectionBox, SelectionRect } from "./finder-types";

const CONTEXT_MENU_WIDTH = 200;
const CONTEXT_MENU_VIEWPORT_MARGIN = 8;
const BACKGROUND_CONTEXT_MENU_HEIGHT = 148;
const ENTRY_CONTEXT_MENU_HEIGHT = 148;
const MULTI_ENTRY_CONTEXT_MENU_HEIGHT = 64;

export const FinderBody = ({
  error,
  isLoading,
  entries,
  selectedPaths,
  renamingPath,
  onSelect,
  onSelectionChange,
  onActivate,
  onBackgroundClick,
  onCreateNewFolder,
  onUploadFiles,
  onUploadFolder,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onOpenEntry,
  onGetInfo,
  onTrashEntries,
  onDownloadEntries,
}: {
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly entries: FilesystemEntry[];
  readonly selectedPaths: string[];
  readonly renamingPath: string | null;
  readonly onSelect: (entry: FilesystemEntry, event: MouseEvent) => void;
  readonly onSelectionChange: (paths: string[]) => void;
  readonly onActivate: (entry: FilesystemEntry) => void;
  readonly onBackgroundClick: () => void;
  readonly onCreateNewFolder: () => void;
  readonly onUploadFiles: () => void;
  readonly onUploadFolder: () => void;
  readonly onRenameStart: (entry: FilesystemEntry) => void;
  readonly onRenameCommit: (entry: FilesystemEntry, nextName: string) => void;
  readonly onRenameCancel: () => void;
  readonly onOpenEntry: (entry: FilesystemEntry) => void;
  readonly onGetInfo: (entry: FilesystemEntry) => void;
  readonly onTrashEntries: (entries: readonly FilesystemEntry[]) => void;
  readonly onDownloadEntries: (entries: readonly FilesystemEntry[]) => void;
}): ReactElement => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const didDragSelectRef = useRef(false);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const selectionBox = selectionRect === null ? null : getNormalizedSelectionBox(selectionRect);

  useEffect(() => {
    if (contextMenu === null) {
      return;
    }

    const closeMenu = (): void => {
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        selectedPaths.length === 0 ||
        renamingPath !== null ||
        (event.key !== "Delete" && event.key !== "Backspace") ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      const selectedEntries = entries.filter((entry) => selectedPaths.includes(entry.path));

      if (selectedEntries.length === 0) {
        return;
      }

      event.preventDefault();
      setContextMenu(null);
      onTrashEntries(selectedEntries);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [entries, onTrashEntries, renamingPath, selectedPaths]);

  if (isLoading) {
    return <FinderEmptyState message="Loading folder..." />;
  }

  if (error !== null) {
    return <FinderEmptyState message={error} variant="error" />;
  }

  const isEmpty = entries.length === 0;

  return (
    <div
      ref={bodyRef}
      className={isEmpty ? "finder-body tiles empty" : "finder-body tiles"}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }

        const target = event.target;

        if (target instanceof Element && target.closest(".finder-item")) {
          return;
        }

        const body = bodyRef.current;

        if (body === null) {
          return;
        }

        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = getContentPoint(event, body);
        setSelectionRect({
          originX: point.x,
          originY: point.y,
          currentX: point.x,
          currentY: point.y,
        });
        didDragSelectRef.current = false;
        onSelectionChange([]);
      }}
      onPointerMove={(event) => {
        const body = bodyRef.current;

        if (selectionRect === null || body === null) {
          return;
        }

        const point = getContentPoint(event, body);
        const nextRect = {
          ...selectionRect,
          currentX: point.x,
          currentY: point.y,
        };

        setSelectionRect(nextRect);
        didDragSelectRef.current =
          Math.abs(nextRect.currentX - nextRect.originX) > 3 ||
          Math.abs(nextRect.currentY - nextRect.originY) > 3;
        onSelectionChange(getIntersectingEntryPaths(body, getNormalizedSelectionBox(nextRect)));
      }}
      onPointerUp={(event) => {
        if (selectionRect === null) {
          return;
        }

        event.currentTarget.releasePointerCapture(event.pointerId);
        setSelectionRect(null);
      }}
      onPointerCancel={() => {
        setSelectionRect(null);
      }}
      onContextMenu={(event) => {
        const target = event.target;

        if (target instanceof Element && target.closest(".finder-item")) {
          return;
        }

        event.preventDefault();
        setContextMenu({
          kind: "background",
          ...getContextMenuPosition(event.clientX, event.clientY, BACKGROUND_CONTEXT_MENU_HEIGHT),
        });
        onBackgroundClick();
      }}
      onClick={(event) => {
        if (didDragSelectRef.current) {
          didDragSelectRef.current = false;
          return;
        }

        if (event.target === event.currentTarget) {
          onBackgroundClick();
        }
      }}
    >
      {isEmpty ? (
        <div className="finder-empty-inline">
          <p>This folder is empty.</p>
        </div>
      ) : (
        <FinderTiles
          entries={entries}
          selectedPaths={selectedPaths}
          renamingPath={renamingPath}
          onSelect={onSelect}
          onContextMenu={(entry, event) => {
            event.preventDefault();
            event.stopPropagation();

            if (selectedPaths.length > 1 && selectedPaths.includes(entry.path)) {
              const selectedEntries = entries.filter((currentEntry) => selectedPaths.includes(currentEntry.path));

              setContextMenu({
                kind: "selection",
                ...getContextMenuPosition(event.clientX, event.clientY, MULTI_ENTRY_CONTEXT_MENU_HEIGHT),
                entries: selectedEntries,
              });
              return;
            }

            onSelect(entry, event);
            setContextMenu({
              kind: "entry",
              ...getContextMenuPosition(event.clientX, event.clientY, ENTRY_CONTEXT_MENU_HEIGHT),
              entry,
            });
          }}
          onActivate={onActivate}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
        />
      )}
      {contextMenu === null ? null : contextMenu.kind === "background" ? (
        <DesktopContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onCreateNewFolder={() => {
            setContextMenu(null);
            onCreateNewFolder();
          }}
          onUploadFiles={() => {
            setContextMenu(null);
            onUploadFiles();
          }}
          onUploadFolder={() => {
            setContextMenu(null);
            onUploadFolder();
          }}
        />
      ) : contextMenu.kind === "entry" ? (
        <DesktopEntryContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onOpen={(entry) => {
            setContextMenu(null);
            onOpenEntry(entry);
          }}
          onRename={(entry) => {
            setContextMenu(null);
            onRenameStart(entry);
          }}
          onGetInfo={(entry) => {
            setContextMenu(null);
            onGetInfo(entry);
          }}
          onTrash={(entry) => {
            setContextMenu(null);
            onTrashEntries([entry]);
          }}
          onDownload={(entry) => {
            setContextMenu(null);
            onDownloadEntries([entry]);
          }}
        />
      ) : (
        <DesktopSelectionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entries={contextMenu.entries}
          onTrash={(selectedEntries) => {
            setContextMenu(null);
            onTrashEntries(selectedEntries);
          }}
          onDownload={(selectedEntries) => {
            setContextMenu(null);
            onDownloadEntries(selectedEntries);
          }}
        />
      )}
      {selectionBox === null ? null : (
        <div
          className="selection-rectangle"
          style={{
            left: selectionBox.left,
            top: selectionBox.top,
            width: selectionBox.width,
            height: selectionBox.height,
          }}
        />
      )}
    </div>
  );
};

const FinderTiles = ({
  entries,
  selectedPaths,
  renamingPath,
  onSelect,
  onContextMenu,
  onActivate,
  onRenameCommit,
  onRenameCancel,
}: {
  readonly entries: FilesystemEntry[];
  readonly selectedPaths: string[];
  readonly renamingPath: string | null;
  readonly onSelect: (entry: FilesystemEntry, event: MouseEvent) => void;
  readonly onContextMenu: (entry: FilesystemEntry, event: MouseEvent) => void;
  readonly onActivate: (entry: FilesystemEntry) => void;
  readonly onRenameCommit: (entry: FilesystemEntry, nextName: string) => void;
  readonly onRenameCancel: () => void;
}): ReactElement => (
  <div className="finder-tiles">
    {entries.map((entry) => (
      <FinderItem
        key={entry.path}
        entry={entry}
        isSelected={selectedPaths.includes(entry.path)}
        isRenaming={entry.path === renamingPath}
        onSelect={(event) => onSelect(entry, event)}
        onContextMenu={(event) => onContextMenu(entry, event)}
        onActivate={() => onActivate(entry)}
        onRenameCommit={(nextName) => onRenameCommit(entry, nextName)}
        onRenameCancel={onRenameCancel}
      />
    ))}
  </div>
);

const FinderEmptyState = ({
  message,
  variant = "info",
}: {
  readonly message: string;
  readonly variant?: "info" | "error";
}): ReactElement => (
  <div className="finder-empty">
    <p className={variant === "error" ? "error" : ""}>{message}</p>
  </div>
);

const FinderItem = ({
  entry,
  isSelected,
  isRenaming,
  onSelect,
  onContextMenu,
  onActivate,
  onRenameCommit,
  onRenameCancel,
}: {
  readonly entry: FilesystemEntry;
  readonly isSelected: boolean;
  readonly isRenaming: boolean;
  readonly onSelect: (event: MouseEvent) => void;
  readonly onContextMenu: (event: MouseEvent) => void;
  readonly onActivate: () => void;
  readonly onRenameCommit: (nextName: string) => void;
  readonly onRenameCancel: () => void;
}): ReactElement => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasCommittedRef = useRef(false);
  const [draftName, setDraftName] = useState(entry.name);

  useEffect(() => {
    setDraftName(entry.name);
    hasCommittedRef.current = false;
  }, [entry.name, isRenaming]);

  useEffect(() => {
    if (!isRenaming) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isRenaming]);

  const commitRename = (): void => {
    if (hasCommittedRef.current) {
      return;
    }

    hasCommittedRef.current = true;
    onRenameCommit(draftName);
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        if (!isRenaming) {
          onSelect(event);
        }
      }}
      onDoubleClick={() => {
        if (!isRenaming) {
          onActivate();
        }
      }}
      onContextMenu={(event) => {
        if (!isRenaming) {
          onContextMenu(event);
        }
      }}
      onKeyDown={(event) => {
        if (isRenaming) {
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          onActivate();
        }
      }}
      className={isSelected ? "finder-item selected" : "finder-item"}
      data-entry-path={entry.path}
    >
      <div className="finder-item-icon">
        <EntryIcon entry={entry} />
      </div>
      {isRenaming ? (
        <input
          ref={inputRef}
          className="finder-rename-input"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              hasCommittedRef.current = true;
              onRenameCancel();
            }
          }}
          onBlur={commitRename}
        />
      ) : (
        <span className="finder-item-label" title={entry.name}>
          {entry.name}
        </span>
      )}
    </button>
  );
};

const getContentPoint = (
  event: PointerEvent<HTMLElement>,
  container: HTMLElement,
): { readonly x: number; readonly y: number } => {
  const rect = container.getBoundingClientRect();

  return {
    x: event.clientX - rect.left + container.scrollLeft,
    y: event.clientY - rect.top + container.scrollTop,
  };
};

const getNormalizedSelectionBox = (rect: SelectionRect): SelectionBox => {
  const left = Math.min(rect.originX, rect.currentX);
  const top = Math.min(rect.originY, rect.currentY);
  const right = Math.max(rect.originX, rect.currentX);
  const bottom = Math.max(rect.originY, rect.currentY);

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
};

const getIntersectingEntryPaths = (container: HTMLElement, selectionBox: SelectionBox): string[] => {
  const containerRect = container.getBoundingClientRect();

  return [...container.querySelectorAll<HTMLElement>(".finder-item[data-entry-path]")]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const box = {
        left: rect.left - containerRect.left + container.scrollLeft,
        top: rect.top - containerRect.top + container.scrollTop,
        right: rect.right - containerRect.left + container.scrollLeft,
        bottom: rect.bottom - containerRect.top + container.scrollTop,
      };

      return (
        box.left < selectionBox.right &&
        box.right > selectionBox.left &&
        box.top < selectionBox.bottom &&
        box.bottom > selectionBox.top
      );
    })
    .map((element) => element.dataset.entryPath)
    .filter((path): path is string => typeof path === "string");
};

const getContextMenuPosition = (
  clientX: number,
  clientY: number,
  menuHeight: number,
): { readonly x: number; readonly y: number } => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  return {
    x: Math.min(clientX, viewportWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_VIEWPORT_MARGIN),
    y: Math.min(clientY, viewportHeight - menuHeight - CONTEXT_MENU_VIEWPORT_MARGIN),
  };
};

export const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
};
