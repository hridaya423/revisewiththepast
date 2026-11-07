import edexcelHigher from "@/config/shadow-papers/edexcel-higher.json";
import { manifestSchema, type ShadowManifest } from "../contracts/shadow-paper";
import { ShadowTemplateRegistry } from "../domain/template-registry";
import { JUNE_2019_PAPER_1_TEMPLATES } from "./edexcel-higher/pilot";

const MANIFEST_SOURCES = [edexcelHigher];

/** Every manifest, parsed once. A malformed manifest fails at import, not at request time. */
export const SHADOW_MANIFESTS: readonly ShadowManifest[] = Object.freeze(
  MANIFEST_SOURCES.flatMap((file) => file.manifests).map((raw) => manifestSchema.parse(raw)),
);

export const SHADOW_TEMPLATE_REGISTRY = new ShadowTemplateRegistry([...JUNE_2019_PAPER_1_TEMPLATES]);

export type ShadowCatalogOptions = {
  /** Allows draft manifests and templates. Only for tests, previews and review scripts. */
  includeDraft?: boolean;
};

const visible = (manifest: ShadowManifest, options: ShadowCatalogOptions) =>
  manifest.publicationStatus === "approved" || (options.includeDraft === true && manifest.publicationStatus === "draft");

export function listShadowManifests(options: ShadowCatalogOptions = {}): ShadowManifest[] {
  return SHADOW_MANIFESTS.filter((manifest) => visible(manifest, options));
}

/** The current visible manifest for a source paper, or null. Withdrawn manifests are never returned. */
export function findShadowManifest(sourcePaperId: string, options: ShadowCatalogOptions = {}): ShadowManifest | null {
  return SHADOW_MANIFESTS.find((manifest) => manifest.source.sourcePaperId === sourcePaperId && visible(manifest, options)) ?? null;
}
