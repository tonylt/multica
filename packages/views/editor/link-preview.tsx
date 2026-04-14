"use client";

/**
 * Link preview system — shared floating card for link inspection.
 *
 * Two entry points, same UI:
 * - EditorLinkPreview: for editable ContentEditor (listens to selectionUpdate)
 * - ReadonlyLinkPreview: for ReadonlyContent (triggered by click on <a>)
 *
 * Both use getBoundingClientRect → compute position → createPortal(body).
 * Position is computed BEFORE the card becomes visible — no flash.
 * Card closes on scroll, outside click, or Escape.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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

/** Walk up from `el` to find the nearest ancestor with overflow: auto/scroll. */
function getScrollParent(el: HTMLElement): HTMLElement | Window {
  let parent = el.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll)/.test(style.overflow + style.overflowY)) return parent;
    parent = parent.parentElement;
  }
  return window;
}

// ---------------------------------------------------------------------------
// LinkPreviewCard — pure UI, no positioning logic
// ---------------------------------------------------------------------------

interface LinkPreviewCardProps {
  href: string;
  style: React.CSSProperties;
  onMouseDown?: (e: React.MouseEvent) => void;
}

function LinkPreviewCard({ href, style, onMouseDown }: LinkPreviewCardProps) {
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

  return createPortal(
    <div className="link-preview-card" style={style} onMouseDown={onMouseDown}>
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
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Position computation
// ---------------------------------------------------------------------------

interface CardPosition {
  top: number;
  left: number;
}

function computeCardPosition(anchorRect: DOMRect): CardPosition {
  const gap = 4;
  let top = anchorRect.bottom + gap;
  let left = anchorRect.left;

  // Flip above if not enough space below
  const cardHeight = 36; // approximate
  if (top + cardHeight > window.innerHeight - 8) {
    top = anchorRect.top - cardHeight - gap;
  }

  // Shift left if overflowing right
  const cardWidth = 360;
  if (left + cardWidth > window.innerWidth - 8) {
    left = window.innerWidth - cardWidth - 8;
  }
  if (left < 8) left = 8;

  return { top, left };
}

// ---------------------------------------------------------------------------
// EditorLinkPreview — for editable ContentEditor
// ---------------------------------------------------------------------------

function EditorLinkPreview({ editor }: { editor: Editor }) {
  const [visible, setVisible] = useState(false);
  const [href, setHref] = useState("");
  const [position, setPosition] = useState<CardPosition>({ top: 0, left: 0 });
  const cardRef = useRef<boolean>(false); // track if card is "ours" for outside click

  // Show/hide based on cursor position
  useEffect(() => {
    const update = () => {
      if (!editor.isEditable || !editor.view.hasFocus()) {
        setVisible(false);
        return;
      }
      const { empty } = editor.state.selection;
      if (!empty || !editor.isActive("link")) {
        setVisible(false);
        return;
      }
      const linkHref = (editor.getAttributes("link").href as string) || "";
      if (!linkHref) {
        setVisible(false);
        return;
      }

      // Get cursor position in viewport
      const from = editor.state.selection.from;
      const coords = editor.view.coordsAtPos(from);
      const anchorRect = new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
      const pos = computeCardPosition(anchorRect);

      setHref(linkHref);
      setPosition(pos);
      setVisible(true);
    };

    editor.on("selectionUpdate", update);
    editor.on("blur", () => setVisible(false));
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("blur", () => setVisible(false));
    };
  }, [editor]);

  // Close on scroll
  useEffect(() => {
    if (!visible) return;
    const scrollParent = getScrollParent(editor.view.dom);
    const close = () => setVisible(false);
    scrollParent.addEventListener("scroll", close, { passive: true });
    return () => scrollParent.removeEventListener("scroll", close);
  }, [visible, editor]);

  // Close on outside click
  useEffect(() => {
    if (!visible) return;
    cardRef.current = true;
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".link-preview-card")) return;
      setVisible(false);
    };
    // Delay to avoid the click that opened the card from immediately closing it
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
    <LinkPreviewCard
      href={href}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 50,
      }}
      onMouseDown={(e) => e.preventDefault()}
    />
  );
}

// ---------------------------------------------------------------------------
// ReadonlyLinkPreview — for ReadonlyContent (react-markdown)
// ---------------------------------------------------------------------------

function ReadonlyLinkWrapper({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CardPosition>({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLAnchorElement>(null);

  const toggle = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (open) {
        setOpen(false);
        return;
      }
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) {
        setPosition(computeCardPosition(rect));
      }
      setOpen(true);
    },
    [open],
  );

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (anchorRef.current?.contains(target)) return;
      if (target.closest(".link-preview-card")) return;
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

  // Close on scroll
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const scrollParent = getScrollParent(anchorRef.current);
    const close = () => setOpen(false);
    scrollParent.addEventListener("scroll", close, { passive: true });
    return () => scrollParent.removeEventListener("scroll", close);
  }, [open]);

  return (
    <>
      <a
        ref={anchorRef}
        href={href}
        onClick={toggle}
        role="button"
        aria-expanded={open}
      >
        {children}
      </a>
      {open && (
        <LinkPreviewCard
          href={href}
          style={{
            position: "fixed",
            top: position.top,
            left: position.left,
            zIndex: 50,
          }}
        />
      )}
    </>
  );
}

export { EditorLinkPreview, ReadonlyLinkWrapper, openLink };
