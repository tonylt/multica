"use client";

/**
 * Link preview system — shared floating card for link inspection.
 *
 * Two entry points, same UI:
 * - EditorLinkPreview: for editable ContentEditor (listens to selectionUpdate)
 * - ReadonlyLinkWrapper: for ReadonlyContent (triggered by click on <a>)
 *
 * Positioning uses position: absolute inside a position: relative wrapper.
 * The card lives in the document flow and scrolls with the content naturally.
 * No createPortal(body), no position: fixed, no scroll listeners needed.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { ExternalLink, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@multica/ui/components/ui/button";
import type { Editor } from "@tiptap/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open a link — internal paths use multica:navigate, external use window.open */
function openLink(href: string) {
  if (href.startsWith("/")) {
    window.dispatchEvent(
      new CustomEvent("multica:navigate", { detail: { path: href } }),
    );
  } else {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

function truncateUrl(url: string, max = 48): string {
  if (url.length <= max) return url;
  try {
    const u = new URL(url);
    const origin = u.origin;
    const rest = url.slice(origin.length);
    if (rest.length <= 10) return url;
    return `${origin}${rest.slice(0, max - origin.length - 1)}…`;
  } catch {
    return `${url.slice(0, max - 1)}…`;
  }
}

// ---------------------------------------------------------------------------
// LinkPreviewCard — pure UI
// ---------------------------------------------------------------------------

function LinkPreviewCard({
  href,
  onMouseDown,
}: {
  href: string;
  onMouseDown?: (e: React.MouseEvent) => void;
}) {
  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(href);
        toast.success("Link copied");
      } catch {
        toast.error("Failed to copy");
      }
    },
    [href],
  );

  const handleOpen = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      openLink(href);
    },
    [href],
  );

  return (
    <div className="link-preview-card" onMouseDown={onMouseDown}>
      <span
        className="min-w-0 flex-1 truncate text-xs text-muted-foreground px-1"
        title={href}
      >
        {truncateUrl(href)}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        className="text-muted-foreground"
        onClick={handleCopy}
        title="Copy link"
      >
        <Copy className="size-3.5" />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        className="text-muted-foreground"
        onClick={handleOpen}
        title="Open link"
      >
        <ExternalLink className="size-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditorLinkPreview — for editable ContentEditor
//
// Renders inside the editor's wrapper div (position: relative). The card
// uses position: absolute so it scrolls with the editor content naturally.
// ---------------------------------------------------------------------------

function EditorLinkPreview({ editor }: { editor: Editor }) {
  const [visible, setVisible] = useState(false);
  const [href, setHref] = useState("");
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const update = () => {
      if (!editor.isEditable || !editor.view.hasFocus()) {
        setVisible(false);
        return;
      }
      if (!editor.state.selection.empty || !editor.isActive("link")) {
        setVisible(false);
        return;
      }
      const linkHref = (editor.getAttributes("link").href as string) || "";
      if (!linkHref) {
        setVisible(false);
        return;
      }

      // Compute position relative to the editor's wrapper (offsetParent).
      // coordsAtPos returns viewport coords; subtract the wrapper's rect.
      const wrapperEl = editor.view.dom.parentElement;
      if (!wrapperEl) return;

      const from = editor.state.selection.from;
      const coords = editor.view.coordsAtPos(from);
      const wrapperRect = wrapperEl.getBoundingClientRect();

      setHref(linkHref);
      setStyle({
        position: "absolute",
        top: coords.bottom - wrapperRect.top + 4,
        left: Math.max(0, coords.left - wrapperRect.left),
        zIndex: 50,
      });
      setVisible(true);
    };

    const hide = () => setVisible(false);

    editor.on("selectionUpdate", update);
    editor.on("blur", hide);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("blur", hide);
    };
  }, [editor]);

  // Close on outside click
  useEffect(() => {
    if (!visible) return;
    const handle = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".link-preview-card")) return;
      setVisible(false);
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handle), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handle);
    };
  }, [visible]);

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVisible(false);
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [visible]);

  if (!visible) return null;

  return (
    <div style={style}>
      <LinkPreviewCard href={href} onMouseDown={(e) => e.preventDefault()} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadonlyLinkWrapper — for ReadonlyContent (react-markdown)
//
// Wraps the <a> in a position: relative span. The card positions absolutely
// below the link and scrolls with it.
// ---------------------------------------------------------------------------

function ReadonlyLinkWrapper({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const toggle = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen((v) => !v);
    },
    [],
  );

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current?.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest(".link-preview-card")) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <span ref={wrapperRef} className="link-preview-wrapper">
      <a href={href} onClick={toggle} role="button" aria-expanded={open}>
        {children}
      </a>
      {open && (
        <span className="link-preview-anchor">
          <LinkPreviewCard href={href} />
        </span>
      )}
    </span>
  );
}

export { EditorLinkPreview, ReadonlyLinkWrapper, openLink };
