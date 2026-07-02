"use client";

import { Shield } from "lucide-react";
import { SimpleEntityManager } from "@/components/entities/SimpleEntityManager";

export default function FactionsPage() {
  return <SimpleEntityManager resourcePath="factions" label="Factions" icon={Shield} />;
}
