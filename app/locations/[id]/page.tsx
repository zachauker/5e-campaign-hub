"use client";

import { MapPin } from "lucide-react";
import { SimpleEntityDetail } from "@/components/glossary/SimpleEntityDetail";

export default function LocationDetailPage() {
  return <SimpleEntityDetail resourcePath="locations" label="Locations" icon={MapPin} />;
}
