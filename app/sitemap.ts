import type { MetadataRoute } from "next";

const SITE_URL = "https://revise.hridya.tech";

// Update these dates when the page content changes.
const PAGES = [
  { path: "", lastModified: "2026-11-04", changeFrequency: "monthly", priority: 1 },
  { path: "/docs/mcp", lastModified: "2026-11-04", changeFrequency: "monthly", priority: 0.6 },
  { path: "/support", lastModified: "2026-11-04", changeFrequency: "monthly", priority: 0.5 },
  { path: "/privacy", lastModified: "2026-11-04", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", lastModified: "2026-11-04", changeFrequency: "yearly", priority: 0.3 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, lastModified, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(lastModified),
    changeFrequency,
    priority,
  }));
}
