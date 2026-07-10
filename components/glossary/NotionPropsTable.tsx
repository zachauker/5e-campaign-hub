import React from "react";

export type NotionProp = { label: string; value: string };

export function NotionPropsTable({ props }: { props: NotionProp[] }) {
  if (!props || props.length === 0) return null;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      {props.map((p) => (
        <React.Fragment key={p.label}>
          <dt className="text-muted-foreground">{p.label}</dt>
          <dd className="text-foreground/90">{p.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
