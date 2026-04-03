import type { OrderedProductEvent } from "./klaviyo";

export interface SegmentRule {
  field: string; // "properties.is_affiliate", "location.country", "lists", "metric_name"
  operator: "equals" | "contains" | "not_equals" | "in_list" | "in_segment" | "not_in_list" | "not_in_segment";
  value: string;
}

export interface SegmentDefinition {
  id: string;
  name: string;
  segmentType: "profile" | "event";
  rules: SegmentRule[];
}

interface ProfileData {
  id: string;
  properties: Record<string, any>;
  location: Record<string, any>;
  listIds?: string[];
  segmentIds?: string[];
}

/**
 * Evaluate whether a profile matches a profile-type segment's rules.
 * All rules are AND-combined.
 */
export function profileMatchesSegment(
  profile: ProfileData,
  rules: SegmentRule[]
): boolean {
  return rules.every((rule) => {
    const fieldValue = getFieldValue(profile, rule.field);

    switch (rule.operator) {
      case "equals":
        return String(fieldValue).toLowerCase() === rule.value.toLowerCase();
      case "not_equals":
        return String(fieldValue).toLowerCase() !== rule.value.toLowerCase();
      case "contains":
        return String(fieldValue).toLowerCase().includes(rule.value.toLowerCase());
      case "in_list":
        // Check if profile is in a specific Klaviyo list
        return (profile.listIds || []).includes(rule.value);
      case "in_segment":
        // Check if profile is in a specific Klaviyo segment
        return (profile.segmentIds || []).includes(rule.value);
      case "not_in_list":
        return !(profile.listIds || []).includes(rule.value);
      case "not_in_segment":
        return !(profile.segmentIds || []).includes(rule.value);
      default:
        return false;
    }
  });
}

/**
 * Get a nested field value from a profile using dot notation.
 * e.g., "properties.is_affiliate" → profile.properties.is_affiliate
 */
function getFieldValue(profile: ProfileData, field: string): any {
  const parts = field.split(".");
  let current: any = profile;

  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }

  return current;
}

/**
 * Filter events by profile segment — keep only events from matching profiles.
 */
export function filterEventsByProfileSegment(
  events: OrderedProductEvent[],
  profiles: ProfileData[],
  rules: SegmentRule[]
): OrderedProductEvent[] {
  const matchingProfileIds = new Set(
    profiles
      .filter((p) => profileMatchesSegment(p, rules))
      .map((p) => p.id)
  );

  return events.filter((e) => matchingProfileIds.has(e.profileId));
}

/**
 * Find matching metric IDs for an event-type segment.
 */
export function findMatchingMetricIds(
  metrics: Array<{ id: string; name: string }>,
  rules: SegmentRule[]
): string[] {
  return metrics
    .filter((m) =>
      rules.every((rule) => {
        if (rule.field !== "metric_name") return true;
        switch (rule.operator) {
          case "equals":
            return m.name.toLowerCase() === rule.value.toLowerCase();
          case "contains":
            return m.name.toLowerCase().includes(rule.value.toLowerCase());
          case "not_equals":
            return m.name.toLowerCase() !== rule.value.toLowerCase();
          default:
            return false;
        }
      })
    )
    .map((m) => m.id);
}
