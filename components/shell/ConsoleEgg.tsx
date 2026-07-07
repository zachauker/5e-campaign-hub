"use client";

import { useEffect } from "react";

// Print-once guard so React StrictMode's double-invoke doesn't repeat it in dev.
let logged = false;

/**
 * A small, discoverable console greeting in the app's voice — zero UI cost,
 * invisible to screen readers, a wink for anyone who opens DevTools.
 */
export function ConsoleEgg() {
  useEffect(() => {
    if (logged) return;
    logged = true;
    console.log(
      "%c⚔ Roll for initiative.",
      "color:#c0392b;font-weight:700;font-size:13px;letter-spacing:0.02em"
    );
    console.log(
      "%cEncounter Tracker — built for the table, not the boardroom.",
      "color:#8a8a9a"
    );
  }, []);

  return null;
}
