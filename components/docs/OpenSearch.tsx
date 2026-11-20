"use client";

import { Search } from "lucide-react";

/** The big search bar on the docs home page. It only asks the shell to open the search box. */
export default function OpenSearch() {
  return (
    <button type="button" className="dx-hero-find" onClick={() => window.dispatchEvent(new Event("wraith:docs-search"))}>
      <Search size={18} aria-hidden="true" />
      <span>Search the docs</span>
      <kbd>/</kbd>
    </button>
  );
}
