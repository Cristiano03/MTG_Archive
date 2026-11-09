import { useState, type MouseEvent } from 'react';
// Anteprima grande della carta quando il puntatore è sopra la sua miniatura (solo con mouse o trackpad, non sul telefono).
// bind(src) va sull'<img> della miniatura; preview va messo una volta nella pagina.
export function useCardPreview() {
  const [hover, setHover] = useState<{ src: string; x: number; y: number } | null>(null);
  const [canHover] = useState(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
  const bind = (src?: string | null) => canHover && src
    ? { onMouseMove: (e: MouseEvent) => setHover({ src: src.replace('/small/', '/normal/'), x: e.clientX, y: e.clientY }), onMouseLeave: () => setHover(null) } : {};
  const preview = hover && <img className="hover-card" alt="" src={hover.src}
    style={{ left: hover.x + 274 > innerWidth ? hover.x - 274 : hover.x + 24, top: Math.max(8, Math.min(hover.y - 175, innerHeight - 358)) }} />;
  return { bind, preview };
}
