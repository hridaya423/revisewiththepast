import type { MetadataRoute } from "next";

const SITE_URL = "https://revise.hridya.tech";
const PRIVATE_PATHS = ["/api/", "/auth", "/marking", "/paper-maker", "/mcp"];
const BOTS = [
  "OAI-SearchBot", "ChatGPT-User", "GPTBot", "Claude-SearchBot", "Claude-User", "ClaudeBot",
  "PerplexityBot", "Perplexity-User", "Googlebot", "Google-Extended", "Bingbot",
  "Applebot", "Applebot-Extended", "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      ...BOTS.map((userAgent) => ({ userAgent, allow: "/", disallow: PRIVATE_PATHS })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
