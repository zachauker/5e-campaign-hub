"use client";

import { Package } from "lucide-react";
import { SimpleEntityManager } from "@/components/entities/SimpleEntityManager";

export default function ItemsPage() {
  return <SimpleEntityManager resourcePath="items" label="Items" icon={Package} />;
}
