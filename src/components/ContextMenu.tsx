import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";

export type MenuItem =
  | "sep"
  | {
      label: string;
      shortcut?: string;
      onClick?: () => void;
      submenu?: MenuItem[];
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
    };

const useMenu = create<{ x: number; y: number; items: MenuItem[] | null }>(() => ({ x: 0, y: 0, items: null }));

export const openMenu = (x: number, y: number, items: MenuItem[]) => useMenu.setState({ x, y, items });
export const closeMenu = () => useMenu.setState({ items: null });

export function ContextMenuHost() {
  const { x, y, items } = useMenu();
  useEffect(() => {
    if (!items) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      closeMenu();
    };
    const onDown = (e: PointerEvent) => !(e.target as HTMLElement).closest(".ctx-menu") && closeMenu();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [items]);
  if (!items) return null;
  return <Menu x={x} y={y} items={items} />;
}

function Menu({ x, y, items }: { x: number; y: number; items: MenuItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);
  return (
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <div
            key={i}
            className={`ctx-item ${it.disabled ? "disabled" : ""} ${it.danger ? "danger" : ""} ${sub?.i === i ? "open" : ""}`}
            onPointerEnter={(e) => {
              if (it.submenu) {
                const r = e.currentTarget.getBoundingClientRect();
                setSub({ i, x: r.right - 2, y: r.top - 4 });
              } else setSub(null);
            }}
            onClick={() => {
              if (it.disabled || it.submenu) return;
              closeMenu();
              it.onClick?.();
            }}
          >
            <span className="check">{it.checked ? "✓" : ""}</span>
            <span className="lbl">{it.label}</span>
            {it.shortcut && <span className="sc">{it.shortcut}</span>}
            {it.submenu && <span className="sc">▸</span>}
          </div>
        ),
      )}
      {sub && items[sub.i] !== "sep" && (items[sub.i] as { submenu?: MenuItem[] }).submenu && (
        <Menu x={sub.x} y={sub.y} items={(items[sub.i] as { submenu: MenuItem[] }).submenu} />
      )}
    </div>
  );
}
