const STORAGE_KEY = 'jjappattu.local-profile.v1';
const MAX_MATCH_HISTORY = 50;

function generateDevicePlayerId() {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `device_${randomPart}`;
}

function createDefaultProfile() {
  return {
    devicePlayerId: generateDevicePlayerId(),
    friends: [],
    matchHistory: [],
    totalWins: 0,
    totalLosses: 0,
  };
}

function sanitizeProfile(raw) {
  const base = createDefaultProfile();
  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const next = { ...base };

  if (typeof raw.devicePlayerId === 'string' && raw.devicePlayerId.trim()) {
    next.devicePlayerId = raw.devicePlayerId.trim();
  }

  if (Array.isArray(raw.friends)) {
    next.friends = [...new Set(raw.friends.filter((value) => typeof value === 'string' && value.trim()))];
  }

  if (Array.isArray(raw.matchHistory)) {
    next.matchHistory = raw.matchHistory
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        result: item.result === 'WIN' ? 'WIN' : 'LOSE',
        roomId: typeof item.roomId === 'string' ? item.roomId : '',
        reason: typeof item.reason === 'string' ? item.reason : 'NORMAL',
        at: typeof item.at === 'number' ? item.at : Date.now(),
      }))
      .slice(0, MAX_MATCH_HISTORY);
  }

  if (typeof raw.totalWins === 'number' && Number.isFinite(raw.totalWins)) {
    next.totalWins = Math.max(0, Math.floor(raw.totalWins));
  }

  if (typeof raw.totalLosses === 'number' && Number.isFinite(raw.totalLosses)) {
    next.totalLosses = Math.max(0, Math.floor(raw.totalLosses));
  }

  return next;
}

function loadProfile() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      const initial = createDefaultProfile();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }

    const parsed = JSON.parse(saved);
    const sanitized = sanitizeProfile(parsed);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    return sanitized;
  } catch (_err) {
    const fallback = createDefaultProfile();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
    return fallback;
  }
}

function saveProfile(nextProfile) {
  const sanitized = sanitizeProfile(nextProfile);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  return sanitized;
}

export const localStateService = {
  getProfile() {
    return loadProfile();
  },

  addFriend(friendPlayerId) {
    const friendId = String(friendPlayerId || '').trim();
    if (!friendId) {
      return loadProfile();
    }

    const profile = loadProfile();
    if (profile.friends.includes(friendId)) {
      return profile;
    }

    profile.friends.push(friendId);
    return saveProfile(profile);
  },

  removeFriend(friendPlayerId) {
    const friendId = String(friendPlayerId || '').trim();
    const profile = loadProfile();
    profile.friends = profile.friends.filter((id) => id !== friendId);
    return saveProfile(profile);
  },

  recordMatch(matchResult) {
    const profile = loadProfile();
    const result = matchResult?.result === 'WIN' ? 'WIN' : 'LOSE';

    if (result === 'WIN') {
      profile.totalWins += 1;
    } else {
      profile.totalLosses += 1;
    }

    profile.matchHistory.unshift({
      result,
      roomId: matchResult?.roomId || '',
      reason: matchResult?.reason || 'NORMAL',
      at: Date.now(),
    });

    if (profile.matchHistory.length > MAX_MATCH_HISTORY) {
      profile.matchHistory = profile.matchHistory.slice(0, MAX_MATCH_HISTORY);
    }

    return saveProfile(profile);
  },
};
