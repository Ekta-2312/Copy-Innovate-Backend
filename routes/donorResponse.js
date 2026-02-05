const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Import Donor model
const Donor = require('../models/Donor');
const DonorLocationResponse = require('../models/DonorLocationResponse');

// Import location filter utility
const { filterRecentLocations, addExpiryInfo } = require('../utils/locationFilter');

// ADD THIS TEST ENDPOINT AT THE TOP
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Donor response API is working!',
    timestamp: new Date()
  });
});

// Handle direct location sharing from frontend page (not SMS)
router.post('/donor-location', async (req, res) => {
  try {
    console.log('=== DIRECT LOCATION SHARING FROM FRONTEND ===');
    const { requestId, donorId, lat, lng } = req.body;

    console.log('Received data:', { requestId, donorId, lat, lng });

    if (!requestId || !donorId || !lat || !lng) {
      return res.status(400).json({
        error: 'Missing required fields: requestId, donorId, lat, lng'
      });
    }

    // Find the blood request to validate
    const BloodRequest = require('../models/BloodRequest');
    const bloodRequest = await BloodRequest.findById(requestId);

    if (!bloodRequest) {
      return res.status(404).json({ error: 'Blood request not found' });
    }

    // Check if request is already fulfilled
    if (bloodRequest.status === 'fulfilled' || bloodRequest.status === 'cancelled' || bloodRequest.status === 'completed') {
      console.log(`❌ Location rejected: Request ${requestId} is ${bloodRequest.status}`);
      return res.status(400).json({
        success: false,
        error: 'Request already fulfilled',
        message: 'Thank you for your willingness to help, but this blood request has already been fulfilled.'
      });
    }

    console.log('Found blood request:', {
      id: bloodRequest._id,
      bloodGroup: bloodRequest.bloodGroup,
      status: bloodRequest.status
    });

    // Try to find donor information
    let donorInfo = null;
    try {
      const Donor = require('../models/Donor');
      donorInfo = await Donor.findById(donorId);
      if (!donorInfo) {
        donorInfo = await Donor.findOne({ uniqueId: donorId });
      }
    } catch (error) {
      console.log('Could not find donor in database, proceeding with location only');
    }

    // Create location data with proper requestId
    const locationData = {
      address: donorInfo ? `${donorInfo.name} - Current Location` : 'Direct location share',
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      accuracy: 0,
      userName: donorInfo ? donorInfo.name : `Donor ${donorId}`,
      rollNumber: donorInfo ? donorInfo.rollNumber || '' : '',
      mobileNumber: donorInfo ? donorInfo.phone : '',
      timestamp: new Date(),
      // IMPORTANT: Store the requestId from the frontend
      requestId: requestId,
      donorId: donorId,
      token: `DIRECT_${requestId}_${donorId}`, // Generate a unique token
      isAvailable: true,
      responseTime: new Date()
    };

    console.log('Saving location with requestId:', locationData.requestId);

    // Save to locations collection
    const mongoose = require('mongoose');
    const result = await mongoose.connection.db.collection('locations').insertOne(locationData);

    console.log('✅ Location saved successfully with requestId:', requestId);

    res.json({
      success: true,
      message: 'Location shared successfully',
      data: {
        locationId: result.insertedId,
        requestId: requestId,
        donorId: donorId,
        coordinates: { lat, lng }
      }
    });

  } catch (error) {
    console.error('Error in direct location sharing:', error);
    res.status(500).json({
      error: 'Failed to save location',
      details: error.message
    });
  }
});

// Get all available donors with their information
router.get('/available-donors', async (req, res) => {
  try {
    console.log('=== FETCHING AVAILABLE DONORS ===');

    // Get all donors from the donors collection
    const donors = await Donor.find({}).sort({ createdAt: -1 });
    console.log('Donors found:', donors.length);

    // Get recent location data to match with donors
    const allLocations = await mongoose.connection.db.collection('locations').find({}).toArray();
    console.log('Locations found:', allLocations.length);

    // ⏰ FILTER: Only include locations from the last 1 hour
    const locations = filterRecentLocations(allLocations, 1);
    console.log(`✅ Recent locations (within 1 hour): ${locations.length} (filtered out ${allLocations.length - locations.length} expired)`);

    // Combine donor data with location data
    const availableDonors = donors.map(donor => {
      // Try to find matching location by multiple criteria for better matching
      const location = locations.find(loc => {
        // Match by phone number (most reliable)
        const phoneMatch = loc.mobileNumber === donor.phone ||
          loc.mobileNumber === donor.phone.replace(/\s+/g, '') ||
          loc.mobileNumber?.replace(/\s+/g, '') === donor.phone.replace(/\s+/g, '');

        // Match by name (case insensitive, flexible matching)
        const nameMatch = loc.userName && donor.name &&
          loc.userName.toLowerCase().trim() === donor.name.toLowerCase().trim();

        return phoneMatch || nameMatch;
      });

      // Calculate distance if location is available
      let distance = null;
      let detailedStatus = 'not_contacted'; // Default status

      if (location && location.latitude && location.longitude) {
        const hospitalLat = 22.6013;
        const hospitalLng = 72.8327;
        distance = calculateDistance(hospitalLat, hospitalLng, location.latitude, location.longitude);
        detailedStatus = 'location_shared';
      }

      // Determine status based on location sharing
      let status = 'available';
      if (location) {
        status = 'responded'; // Has shared location via SMS link
      }

      return {
        id: donor._id,
        name: donor.name,
        email: donor.email,
        phone: donor.phone,
        bloodGroup: donor.bloodGroup,
        rollNo: donor.rollNo,
        status: status,
        detailedStatus: detailedStatus, // More specific status
        distance: distance,
        lastDonation: null, // This would need to be tracked separately
        address: location ? location.address : null,
        location: location ? {
          lat: location.latitude,
          lng: location.longitude
        } : null,
        responseTime: location ? location.timestamp : null,
        hasLocationData: !!location, // Boolean flag for easier filtering
        matchedBy: location ? (locations.find(l => l.mobileNumber === donor.phone) ? 'phone' : 'name') : null
      };
    });

    // Sort donors: those with location data first, then by distance, then by name
    availableDonors.sort((a, b) => {
      if (a.hasLocationData && !b.hasLocationData) return -1;
      if (!a.hasLocationData && b.hasLocationData) return 1;
      if (a.distance !== null && b.distance !== null) {
        return a.distance - b.distance;
      }
      return a.name.localeCompare(b.name);
    });

    console.log('Available donors processed:', availableDonors.length);
    console.log('Donors with location:', availableDonors.filter(d => d.hasLocationData).length);

    res.json({
      success: true,
      donors: availableDonors,
      total: availableDonors.length,
      withLocation: availableDonors.filter(d => d.hasLocationData).length,
      withoutLocation: availableDonors.filter(d => !d.hasLocationData).length
    });

  } catch (error) {
    console.error('Error fetching available donors:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available donors',
      error: error.message
    });
  }
});

// Helper function to calculate distance
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
}

// Create a model for the locations collection
const LocationSchema = new mongoose.Schema({
  address: String,
  latitude: Number,
  longitude: Number,
  userName: String,
  rollNumber: String,
  mobileNumber: String,
  timestamp: Date
}, { collection: 'locations' });

const Location = mongoose.model('Location', LocationSchema);

// Get all locations (user positions) for the live map
router.get('/locations', async (req, res) => {
  try {
    console.log('=== FETCHING ALL LOCATIONS FOR LIVE MAP ===');

    // Get all donors to match with location data
    const donors = await Donor.find({});
    console.log('Found donors for matching:', donors.length);

    // Get all locations from the locations collection (simplified approach)
    const allLocations = await mongoose.connection.db.collection('locations').find({}).toArray();
    console.log('Total locations found:', allLocations.length);

    // ⏰ FILTER: Only include locations from the last 1 hour
    const recentLocations = filterRecentLocations(allLocations, 1);
    console.log(`✅ Locations within last hour: ${recentLocations.length} (filtered out ${allLocations.length - recentLocations.length} expired)`);

    // Transform locations with donor info
    const transformedLocations = recentLocations.map(location => {
      console.log('Processing location for:', location.userName);
      console.log('Location data:', {
        userName: location.userName,
        mobileNumber: location.mobileNumber,
        requestId: location.requestId,
        timestamp: location.timestamp
      });

      // Match with donor data by mobile number only
      const matchingDonor = donors.find(donor => {
        if (!location.mobileNumber || !donor.phone) return false;

        const cleanLocationPhone = location.mobileNumber.replace(/\D/g, '');
        const cleanDonorPhone = donor.phone.replace(/\D/g, '');

        const phoneMatch =
          donor.phone === location.mobileNumber ||
          cleanDonorPhone === cleanLocationPhone ||
          cleanDonorPhone === `91${cleanLocationPhone}` ||
          `91${cleanDonorPhone}` === cleanLocationPhone;

        console.log(`Checking donor ${donor.name} (${donor.phone}) against location ${location.userName} (${location.mobileNumber})`);
        console.log(`Phone match: ${phoneMatch}`);

        return phoneMatch;
      });

      if (matchingDonor) {
        console.log(`✅ Matched ${location.userName} with donor ${matchingDonor.name}, blood group: ${matchingDonor.bloodGroup}`);
      } else {
        console.log(`⚠️ No donor match found for ${location.userName} with phone ${location.mobileNumber}`);
      }

      // Add expiry information to the location
      // Use matched donor details if found, otherwise use location data
      // Use rollNumber (DON number) from location collection for display
      const locationWithExpiry = addExpiryInfo({
        _id: location._id.toString(),
        name: matchingDonor ? matchingDonor.name : (location.userName || 'Unknown User'),
        phone: matchingDonor ? matchingDonor.phone : (location.mobileNumber || 'No phone'),
        donorId: location.rollNumber || location.donorId || 'No ID', // Use rollNumber (DON number) from location
        bloodGroup: matchingDonor ? matchingDonor.bloodGroup : 'Unknown',
        location: {
          lat: location.latitude,
          lng: location.longitude
        },
        status: 'responded',
        responseTime: location.responseTime || location.timestamp || new Date(),
        address: location.address,
        requestId: location.requestId || null,
        isAvailable: location.isAvailable !== false,
        token: location.token || null,
        // Add matched donor info for reference
        matchedDonor: matchingDonor ? {
          id: matchingDonor._id,
          name: matchingDonor.name,
          bloodGroup: matchingDonor.bloodGroup
        } : null
      }, 1); // 1 hour expiry

      return locationWithExpiry;
    });

    console.log('Total locations processed:', transformedLocations.length);

    res.json({
      success: true,
      responses: transformedLocations,
      summary: {
        total: transformedLocations.length,
        matched: transformedLocations.filter(loc => loc.bloodGroup !== 'Unknown').length,
        unmatched: transformedLocations.filter(loc => loc.bloodGroup === 'Unknown').length,
        expiringSoon: transformedLocations.filter(loc => loc.expiryInfo?.isExpiringSoon).length
      },
      filterInfo: {
        maxAgeHours: 1,
        totalBeforeFilter: allLocations.length,
        filteredOut: allLocations.length - recentLocations.length
      }
    });
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch locations',
      error: error.message
    });
  }
});

// Get donor responses for a specific blood request
router.get('/responses/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { timeFilter = 'all', maxAgeHours } = req.query; // New filtering parameters

    console.log('Fetching responses for requestId:', requestId);
    console.log('Time filter:', timeFilter, 'Max age hours:', maxAgeHours);

    // Helper function to normalize blood group strings
    const normalizeBloodGroup = (bloodGroup) => {
      if (!bloodGroup || bloodGroup === 'Unknown') return 'Unknown';
      // Remove spaces and standardize format
      return bloodGroup.replace(/\s+/g, '').toUpperCase();
    };

    // Get the blood request to know when it was created
    const BloodRequest = require('../models/BloodRequest');
    const bloodRequest = await BloodRequest.findById(requestId);

    if (!bloodRequest) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    console.log('Blood request created at:', bloodRequest.createdAt);

    // Calculate time filter boundaries
    let responseTimeFilter = {};
    const requestCreatedAt = bloodRequest.createdAt;

    if (timeFilter === 'after-request') {
      // Only responses AFTER the blood request was created
      responseTimeFilter = { $gte: requestCreatedAt };
    } else if (timeFilter === 'recent' || maxAgeHours) {
      // Only responses within specified hours (default 24 hours)
      const hoursLimit = parseInt(maxAgeHours) || 24;
      const cutoffTime = new Date(Date.now() - (hoursLimit * 60 * 60 * 1000));
      responseTimeFilter = {
        $gte: new Date(Math.max(requestCreatedAt.getTime(), cutoffTime.getTime()))
      };
    }
    // 'all' filter = no time restrictions

    // Get all donors to match with location data
    const donors = await Donor.find({});
    console.log('Found donors:', donors.length);

    // Get new location responses for this specific request with time filtering
    let newResponseQuery = { requestId };
    if (Object.keys(responseTimeFilter).length > 0) {
      newResponseQuery.createdAt = responseTimeFilter;
    }

    const newLocationResponses = await DonorLocationResponse.find(newResponseQuery)
      .populate('donorId')
      .populate('requestId')
      .sort({ createdAt: -1 });
    console.log('New location responses found for request:', newLocationResponses.length);

    // Get locations that responded to this specific request
    let locationFilter = { requestId: requestId };
    if (Object.keys(responseTimeFilter).length > 0) {
      locationFilter.timestamp = responseTimeFilter;
    }

    // ⏰ ADD 1-HOUR EXPIRY: Always filter locations to last 1 hour
    const oneHourAgo = new Date(Date.now() - (60 * 60 * 1000));
    if (locationFilter.timestamp) {
      // Combine with existing time filter - use the more recent cutoff
      const existingCutoff = locationFilter.timestamp.$gte;
      locationFilter.timestamp = {
        $gte: new Date(Math.max(existingCutoff.getTime(), oneHourAgo.getTime()))
      };
    } else {
      locationFilter.timestamp = { $gte: oneHourAgo };
    }

    console.log('Looking for locations with specific requestId:', locationFilter);
    const locationsWithRequestId = await mongoose.connection.db.collection('locations')
      .find(locationFilter)
      .toArray();

    console.log(`Locations found with requestId ${requestId}:`, locationsWithRequestId.length);

    // ALSO get locations without requestId but created after this request
    // This handles cases where users submit location directly without SMS token
    let fallbackFilter = {
      requestId: { $exists: false } // No requestId field
    };
    if (Object.keys(responseTimeFilter).length > 0) {
      fallbackFilter.timestamp = responseTimeFilter;
    }

    // ⏰ ADD 1-HOUR EXPIRY to fallback filter too
    if (fallbackFilter.timestamp) {
      const existingCutoff = fallbackFilter.timestamp.$gte;
      fallbackFilter.timestamp = {
        $gte: new Date(Math.max(existingCutoff.getTime(), oneHourAgo.getTime()))
      };
    } else {
      fallbackFilter.timestamp = { $gte: oneHourAgo };
    }

    console.log('Looking for locations without requestId (fallback):', fallbackFilter);
    const locationsWithoutRequestId = await mongoose.connection.db.collection('locations')
      .find(fallbackFilter)
      .toArray();

    console.log(`Locations found without requestId (created after request):`, locationsWithoutRequestId.length);

    // Combine both sets of locations
    const locations = [...locationsWithRequestId, ...locationsWithoutRequestId];
    console.log(`✅ Total locations (within 1 hour): ${locations.length}`);

    // CHECK: If request is already fulfilled, return empty responses to clear the map
    if (bloodRequest.status === 'fulfilled' || bloodRequest.status === 'cancelled' || (bloodRequest.confirmedUnits >= bloodRequest.quantity)) {
      console.log(`🚫 Request ${requestId} is already ${bloodRequest.status}. Returning empty response list to clear map.`);
      return res.json({
        success: true,
        responses: [],
        requestInfo: {
          requestId: requestId,
          createdAt: bloodRequest.createdAt,
          bloodGroup: bloodRequest.bloodGroup,
          status: bloodRequest.status,
          isFulfilled: true
        }
      });
    }

    // Transform new location responses with enhanced time info
    const transformedNewResponses = newLocationResponses.map(response => {
      const responseTime = response.responseTime || response.createdAt;
      const timeSinceRequest = responseTime ?
        Math.round((responseTime.getTime() - requestCreatedAt.getTime()) / (1000 * 60)) : null;

      return {
        _id: response._id.toString(),
        requestId: requestId,
        name: response.donorId?.name || 'Unknown User',
        phone: response.donorId?.phone || 'No phone',
        donorId: response.donorId?._id.toString() || 'No ID',
        bloodGroup: normalizeBloodGroup(response.donorId?.bloodGroup) || 'Unknown',
        location: {
          lat: response.latitude,
          lng: response.longitude
        },
        status: response.isAvailable ? 'responded' : 'unavailable',
        responseTime: responseTime,
        timeSinceRequest: timeSinceRequest, // Minutes after request was created
        address: response.address,
        source: 'token_response',
        isRecentResponse: timeSinceRequest !== null && timeSinceRequest >= 0
      };
    });

    // Transform old locations with enhanced time info
    const transformedOldLocations = locations.map(location => {
      // Try to match with donor data to get blood group
      const matchingDonor = donors.find(donor => {
        const phoneMatch = donor.phone === location.mobileNumber ||
          donor.phone?.replace(/\s+/g, '') === location.mobileNumber?.replace(/\s+/g, '');
        const nameMatch = donor.name && location.userName &&
          donor.name.toLowerCase().trim() === location.userName.toLowerCase().trim();
        return phoneMatch || nameMatch;
      });

      const responseTime = location.timestamp || new Date();
      const timeSinceRequest = Math.round((responseTime.getTime() - requestCreatedAt.getTime()) / (1000 * 60));

      return {
        _id: location._id.toString(),
        requestId: requestId,
        name: location.userName || 'Unknown User',
        phone: location.mobileNumber || 'No phone',
        donorId: location.rollNumber || 'No ID',
        bloodGroup: normalizeBloodGroup(matchingDonor ? matchingDonor.bloodGroup : 'Unknown'),
        location: {
          lat: location.latitude,
          lng: location.longitude
        },
        status: 'responded',
        responseTime: responseTime,
        timeSinceRequest: timeSinceRequest, // Minutes after request was created
        address: location.address,
        source: 'old_collection',
        isRecentResponse: timeSinceRequest >= 0
      };
    });

    // Combine both sources, prioritizing new responses
    let allResponses = [...transformedNewResponses, ...transformedOldLocations];

    // Sort by response time (most recent first)
    allResponses.sort((a, b) => {
      if (!a.responseTime) return 1;
      if (!b.responseTime) return -1;
      return new Date(b.responseTime).getTime() - new Date(a.responseTime).getTime();
    });

    // Filter out responses that came BEFORE the request (if any)
    const validResponses = allResponses.filter(response => response.isRecentResponse);
    const invalidResponses = allResponses.filter(response => !response.isRecentResponse);

    console.log(`Total responses for request ${requestId}:`, allResponses.length);
    console.log('Valid responses (after request):', validResponses.length);
    console.log('Invalid responses (before request):', invalidResponses.length);
    console.log('New token responses:', transformedNewResponses.length);
    console.log('Old collection responses:', transformedOldLocations.length);

    res.json({
      success: true,
      responses: validResponses, // Only return valid responses
      requestInfo: {
        requestId: requestId,
        createdAt: bloodRequest.createdAt,
        bloodGroup: bloodRequest.bloodGroup,
        status: bloodRequest.status
      },
      filterInfo: {
        timeFilter: timeFilter,
        maxAgeHours: maxAgeHours,
        filterApplied: Object.keys(responseTimeFilter).length > 0
      },
      summary: {
        total: validResponses.length,
        tokenResponses: transformedNewResponses.filter(r => r.isRecentResponse).length,
        oldResponses: transformedOldLocations.filter(r => r.isRecentResponse).length,
        excludedOldResponses: invalidResponses.length
      }
    });
  } catch (error) {
    console.error('Error fetching donor responses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch donor responses',
      error: error.message
    });
  }
});

// Get recent blood requests for dropdown filtering
router.get('/recent-requests', async (req, res) => {
  try {
    const BloodRequest = require('../models/BloodRequest');
    const Hospital = require('../models/Hospital');

    // Get recent blood requests (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));

    const recentRequests = await BloodRequest.find({
      createdAt: { $gte: sevenDaysAgo }
    })
      .populate('hospitalId', 'name')
      .sort({ createdAt: -1 })
      .limit(20);

    // Format requests for dropdown
    const formattedRequests = recentRequests.map(request => ({
      _id: request._id,
      label: `${request.bloodGroup} - ${request.quantity} unit(s) - ${request.hospitalId?.name || 'Unknown Hospital'} - ${new Date(request.createdAt).toLocaleDateString('en-GB')}`,
      bloodGroup: request.bloodGroup,
      quantity: request.quantity,
      urgency: request.urgency,
      hospitalName: request.hospitalId?.name || 'Unknown Hospital',
      createdAt: request.createdAt,
      status: request.status
    }));

    console.log(`Found ${formattedRequests.length} recent blood requests for dropdown`);

    res.json({
      success: true,
      requests: formattedRequests,
      total: formattedRequests.length
    });

  } catch (error) {
    console.error('Error fetching recent requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent requests',
      error: error.message
    });
  }
});

module.exports = router;