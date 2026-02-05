/**
 * Utility functions for filtering locations based on time
 */

const ONE_HOUR_MS = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Filter locations to only include those added within the last hour
 * @param {Array} locations - Array of location objects
 * @param {Number} maxAgeHours - Maximum age in hours (default: 1)
 * @returns {Array} Filtered locations
 */
function filterRecentLocations(locations, maxAgeHours = 1) {
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const cutoffTime = new Date(Date.now() - maxAgeMs);
  
  return locations.filter(location => {
    // Get timestamp from either timestamp or responseTime field
    const locationTime = new Date(location.timestamp || location.responseTime || location.createdAt);
    
    // Check if location is within the time limit
    const isRecent = locationTime >= cutoffTime;
    
    if (!isRecent) {
      console.log(`⏰ Location expired: ${location.userName || 'Unknown'} - Added ${locationTime.toLocaleString()}`);
    }
    
    return isRecent;
  });
}

/**
 * Get MongoDB query filter for recent locations
 * @param {Number} maxAgeHours - Maximum age in hours (default: 1)
 * @returns {Object} MongoDB query filter
 */
function getRecentLocationQuery(maxAgeHours = 1) {
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const cutoffTime = new Date(Date.now() - maxAgeMs);
  
  return {
    timestamp: { $gte: cutoffTime }
  };
}

/**
 * Calculate time remaining until location expires
 * @param {Date} locationTime - When the location was added
 * @param {Number} maxAgeHours - Maximum age in hours (default: 1)
 * @returns {Object} Object with minutes and seconds remaining
 */
function getTimeRemaining(locationTime, maxAgeHours = 1) {
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const expiryTime = new Date(locationTime.getTime() + maxAgeMs);
  const now = new Date();
  const remainingMs = expiryTime - now;
  
  if (remainingMs <= 0) {
    return { expired: true, minutes: 0, seconds: 0 };
  }
  
  const minutes = Math.floor(remainingMs / (60 * 1000));
  const seconds = Math.floor((remainingMs % (60 * 1000)) / 1000);
  
  return { expired: false, minutes, seconds, totalMs: remainingMs };
}

/**
 * Add expiry information to location object
 * @param {Object} location - Location object
 * @param {Number} maxAgeHours - Maximum age in hours (default: 1)
 * @returns {Object} Location with expiry info added
 */
function addExpiryInfo(location, maxAgeHours = 1) {
  const locationTime = new Date(location.timestamp || location.responseTime || location.createdAt);
  const timeRemaining = getTimeRemaining(locationTime, maxAgeHours);
  
  return {
    ...location,
    expiryInfo: {
      addedAt: locationTime,
      expiresAt: new Date(locationTime.getTime() + (maxAgeHours * 60 * 60 * 1000)),
      timeRemaining: timeRemaining,
      isExpiringSoon: !timeRemaining.expired && timeRemaining.minutes < 10 // Last 10 minutes
    }
  };
}

module.exports = {
  filterRecentLocations,
  getRecentLocationQuery,
  getTimeRemaining,
  addExpiryInfo,
  ONE_HOUR_MS
};
