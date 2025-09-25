const DAY_IN_MS = 24 * 60 * 60 * 1000;

function formatDate(date) {
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.valueOf())) {
    return null;
  }
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function enrichDomain(domain) {
  const thresholds = Array.isArray(domain.level_thresholds) ? domain.level_thresholds : [];
  const nextThreshold = thresholds[domain.level] ?? thresholds[thresholds.length - 1] ?? domain.xp + 100;
  const previousThreshold = thresholds[Math.max(0, domain.level - 1)] ?? 0;
  const xpToNextLevel = Math.max(0, nextThreshold - domain.xp);
  const xpIntoCurrentLevel = Math.max(0, domain.xp - previousThreshold);
  const xpRequiredForLevel = Math.max(1, nextThreshold - previousThreshold);
  const progressRatio = Math.max(0, Math.min(1, xpIntoCurrentLevel / xpRequiredForLevel));
  return {
    ...domain,
    next_level_threshold: nextThreshold,
    xp_to_next_level: xpToNextLevel,
    level_progress_ratio: progressRatio
  };
}

function groupQuestsByDate(quests) {
  const today = formatDate(new Date());
  const tomorrow = formatDate(new Date(Date.now() + DAY_IN_MS));
  const groups = {
    today: [],
    tomorrow: [],
    upcoming: []
  };
  const sorted = [...quests].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const quest of sorted) {
    if (quest.is_completed) {
      continue;
    }
    const questDate = quest.date;
    if (questDate === today) {
      groups.today.push(quest);
    } else if (questDate === tomorrow) {
      groups.tomorrow.push(quest);
    } else if (questDate < today) {
      groups.today.push(quest);
    } else {
      groups.upcoming.push(quest);
    }
  }
  return groups;
}

async function buildSnapshotPayload(dependencies, deviceId) {
  const { fetchDomains, fetchConfig, fetchQuests } = dependencies;
  const [domains, config, quests] = await Promise.all([
    fetchDomains(deviceId),
    fetchConfig(deviceId),
    fetchQuests(deviceId)
  ]);
  const enrichedDomains = domains.map(enrichDomain);
  return {
    domains: enrichedDomains,
    config,
    questsByDate: groupQuestsByDate(quests),
    quests,
    serverTime: new Date().toISOString()
  };
}

module.exports = { formatDate, enrichDomain, groupQuestsByDate, buildSnapshotPayload };