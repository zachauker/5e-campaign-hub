"use client";

import { Shield } from "lucide-react";
import { SimpleEntityDetail } from "@/components/glossary/SimpleEntityDetail";

export default function FactionDetailPage() {
  return <SimpleEntityDetail resourcePath="factions" label="Factions" icon={Shield} />;
}
