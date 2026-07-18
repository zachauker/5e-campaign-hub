"use client";

// A small text chip rendered under a map marker pin. Absolutely positioned so
// it does not affect the pin's layout box (keeps the pin tip on its coordinate)
// and non-interactive so marker clicks still register. Used identically by the
// static, tiled, and world canvases — two of which stringify it via
// renderToStaticMarkup — so it stays a pure presentational component.
export function MarkerLabel({ text }: { text: string }) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 max-w-[7.5rem] truncate rounded bg-card/85 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-foreground ring-1 ring-border"
    >
      {text}
    </div>
  );
}
