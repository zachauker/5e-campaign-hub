"use client";

import { Package } from "lucide-react";
import { SimpleEntityDetail } from "@/components/glossary/SimpleEntityDetail";

export default function ItemDetailPage() {
  return <SimpleEntityDetail resourcePath="items" label="Items" icon={Package} />;
}
