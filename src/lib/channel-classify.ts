// NOTE: filename is kept as channel-classify.ts for git history; the exported
// symbols use the user-facing "audience" terminology.

import type { AudienceDefinition } from "./config";
import { UNASSIGNED_AUDIENCE_ID } from "./config";
import { profileMatchesSegment } from "./segment-eval";

export interface ProfileForClassification {
  id: string;
  properties: Record<string, unknown>;
  location: Record<string, unknown>;
  listIds?: string[];
  segmentIds?: string[];
}

/**
 * Classify each profile into an audience using first-match-wins on the ordered
 * `audiences` array. Profiles matching no audience are omitted from the result
 * map (caller treats missing as UNASSIGNED_AUDIENCE_ID).
 */
export function classifyAudiences(
  profiles: ProfileForClassification[],
  audiences: AudienceDefinition[]
): Map<string, string> {
  const result = new Map<string, string>();

  for (const profile of profiles) {
    for (const audience of audiences) {
      if (profileMatchesAudience(profile, audience)) {
        result.set(profile.id, audience.id);
        break; // first-match-wins
      }
    }
  }

  return result;
}

/**
 * Determine whether a single profile matches a single audience definition.
 */
export function profileMatchesAudience(
  profile: ProfileForClassification,
  audience: AudienceDefinition
): boolean {
  const rule = audience.rule;
  if (rule.type === "segment") {
    return profileMatchesSegment(
      {
        id: profile.id,
        properties: profile.properties,
        location: profile.location,
        listIds: profile.listIds,
        segmentIds: profile.segmentIds,
      },
      rule.rules
    );
  }
  if (rule.type === "list") {
    return (profile.listIds || []).includes(rule.listId);
  }
  if (rule.type === "klaviyo_segment") {
    return (profile.segmentIds || []).includes(rule.segmentId);
  }
  return false;
}

/**
 * Convenience: resolve the audience ID for a profile (returns UNASSIGNED_AUDIENCE_ID
 * if not present in the map).
 */
export function getAudienceForProfile(
  profileId: string,
  audienceMap: Map<string, string>
): string {
  return audienceMap.get(profileId) ?? UNASSIGNED_AUDIENCE_ID;
}

/**
 * Classify each profile into *all* audiences it matches (as opposed to the
 * first-match-wins map). Used for the cross-audience metric: a profile that
 * matches ≥2 audiences has orders "spanning audiences" in the analytical
 * sense even though first-match-wins assigns it a single primary audience
 * for cohort bucketing.
 */
export function classifyAllMatches(
  profiles: ProfileForClassification[],
  audiences: AudienceDefinition[]
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const profile of profiles) {
    const matches = new Set<string>();
    for (const audience of audiences) {
      if (profileMatchesAudience(profile, audience)) {
        matches.add(audience.id);
      }
    }
    if (matches.size > 0) result.set(profile.id, matches);
  }
  return result;
}

/**
 * Collect every SegmentRule across all configured audiences that references a
 * list or klaviyo_segment by ID. Useful for the analysis pipeline to batch
 * list/segment-member fetches.
 */
export function collectMembershipRefs(audiences: AudienceDefinition[]): {
  listIds: string[];
  segmentIds: string[];
} {
  const listIds = new Set<string>();
  const segmentIds = new Set<string>();

  for (const a of audiences) {
    if (a.rule.type === "list") {
      listIds.add(a.rule.listId);
    } else if (a.rule.type === "klaviyo_segment") {
      segmentIds.add(a.rule.segmentId);
    } else if (a.rule.type === "segment") {
      for (const rule of a.rule.rules) {
        if (rule.operator === "in_list" || rule.operator === "not_in_list") {
          if (rule.value) listIds.add(rule.value);
        } else if (rule.operator === "in_segment" || rule.operator === "not_in_segment") {
          if (rule.value) segmentIds.add(rule.value);
        }
      }
    }
  }

  return { listIds: Array.from(listIds), segmentIds: Array.from(segmentIds) };
}
