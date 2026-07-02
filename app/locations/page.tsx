"use client";

import { MapPin } from "lucide-react";
import { SimpleEntityManager } from "@/components/entities/SimpleEntityManager";

export default function LocationsPage() {
  return <SimpleEntityManager resourcePath="locations" label="Locations" icon={MapPin} />;
}
