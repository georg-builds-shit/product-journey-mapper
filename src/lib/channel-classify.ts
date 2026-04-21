import type { ChannelDefinition } from "./config";
import { UNASSIGNED_CHANNEL_ID } from "./config";
import { profileMatchesSegment } from "./segment-eval";

export interface ProfileForClassification {
  id: string;
  properties: Record<string, any>;
  location: Record<string, any>;
  listIds?: string[];
  segmentIds?: string[];
}

/**
 * Classify each profile into a channel using first-match-wins on the ordered
 * `channels` array. Profiles matching no channel are omitted from the result
 * map (caller treats missing as UNASSIGNED_CHANNEL_ID).
 *
 * Note: list/segment membership must already be populated on each profile
 * (via fetchListOrSegmentProfileIds upstream) for rules that reference them.
 */
export function classifyChannels(
  profiles: ProfileForClassification[],
  channels: ChannelDefinition[]
): Map<string, string> {
  const result = new Map<string, string>();

  for (const profile of profiles) {
    for (const channel of channels) {
      if (profileMatchesChannel(profile, channel)) {
        result.set(profile.id, channel.id);
        break; // first-match-wins
      }
    }
  }

  return result;
}

/**
 * Determine whether a single profile matches a single channel definition.
 */
export function profileMatchesChannel(
  profile: ProfileForClassification,
  channel: ChannelDefinition
): boolean {
  const rule = channel.rule;
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
 * Convenience: resolve the channel ID for a profile (returns UNASSIGNED_CHANNEL_ID
 * if not present in the map).
 */
export function getChannelForProfile(
  profileId: string,
  channelMap: Map<string, string>
): string {
  return channelMap.get(profileId) ?? UNASSIGNED_CHANNEL_ID;
}

/**
 * Classify each profile into *all* channels it matches (as opposed to the
 * first-match-wins map). Used for the cross-channel metric: a profile that
 * matches ≥2 channels has orders "spanning channels" in the analytical sense
 * even though first-match-wins assigns it a single primary channel for
 * cohort bucketing.
 */
export function classifyAllMatches(
  profiles: ProfileForClassification[],
  channels: ChannelDefinition[]
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const profile of profiles) {
    const matches = new Set<string>();
    for (const channel of channels) {
      if (profileMatchesChannel(profile, channel)) {
        matches.add(channel.id);
      }
    }
    if (matches.size > 0) result.set(profile.id, matches);
  }
  return result;
}

/**
 * Collect every SegmentRule across all configured channels that references a
 * list or klaviyo_segment by ID. Useful for the analysis pipeline to batch
 * list/segment-member fetches.
 */
export function collectMembershipRefs(channels: ChannelDefinition[]): {
  listIds: string[];
  segmentIds: string[];
} {
  const listIds = new Set<string>();
  const segmentIds = new Set<string>();

  for (const ch of channels) {
    if (ch.rule.type === "list") {
      listIds.add(ch.rule.listId);
    } else if (ch.rule.type === "klaviyo_segment") {
      segmentIds.add(ch.rule.segmentId);
    } else if (ch.rule.type === "segment") {
      for (const rule of ch.rule.rules) {
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
