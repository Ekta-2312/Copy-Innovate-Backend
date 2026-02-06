const express = require('express');
const DonorResponse = require('../models/DonorLocationResponse');
const BloodRequest = require('../models/BloodRequest');
const Donor = require('../models/Donor');
const DonationHistory = require('../models/DonationHistory');
const mongoose = require('mongoose');
const router = express.Router();

// In-memory lock to prevent concurrent processing
const processingLock = new Set();

// Create Location model
let Location;
try {
  Location = mongoose.model('Location');
} catch (error) {
  const LocationSchema = new mongoose.Schema({
    address: String,
    latitude: Number,
    longitude: Number,
    userName: String,
    rollNumber: String,
    mobileNumber: String,
    donorId: String,
    requestId: String,
    token: String,
    accuracy: Number,
    timestamp: Date
  }, { collection: 'locations' });
  Location = mongoose.model('Location', LocationSchema);
}

// Mark donation
router.post('/mark-donation', async (req, res) => {
  try {
    const { donorId, donorName, requestId } = req.body;

    console.log('\n🔍 QR DONATION:', { donorId, donorName, requestId });

    if (!donorId) {
      return res.status(400).json({ success: false, error: 'Donor ID required' });
    }

    // IMMEDIATE lock check - prevent concurrent processing
    if (processingLock.has(donorId)) {
      console.log('❌ Already processing this donor');
      return res.status(400).json({ success: false, error: 'Processing in progress' });
    }

    // Add to processing lock
    processingLock.add(donorId);
    console.log('🔒 Locked:', donorId);

    // Check for ANY existing donation
    const existingDonation = await DonationHistory.findOne({
      donorId: donorId,
      status: 'completed'
    }).sort({ completedAt: -1 });

    if (existingDonation) {
      const timeSince = Math.round((Date.now() - existingDonation.completedAt.getTime()) / 1000);
      console.log('❌ Already donated', timeSince, 'seconds ago');
      // DON'T delete lock - keep it permanently for already donated donors
      return res.status(400).json({ success: false, error: 'Already donated' });
    }

    // FIRST: Check if donor exists in the locations collection (live map users)
    console.log('Searching for donor in locations:', donorId);

    let locationRecord = await Location.findOne({ donorId: donorId });
    console.log('Mongoose Location.findOne result:', locationRecord);

    // Fallback: Try direct MongoDB query
    if (!locationRecord) {
      console.log('Trying direct MongoDB query...');
      locationRecord = await mongoose.connection.db.collection('locations').findOne({ donorId: donorId });
      console.log('Direct MongoDB query result:', locationRecord);
    }

    if (!locationRecord) {
      processingLock.delete(donorId);
      console.log('❌ Donor not found in live locations (both queries failed)');
      return res.status(404).json({
        success: false,
        error: `Donor with ID "${donorId}" not found on live map. Please ensure the donor has shared their location.`
      });
    }

    console.log('✅ Location found:', {
      userName: locationRecord.userName,
      mobileNumber: locationRecord.mobileNumber,
      address: locationRecord.address
    });

    // THEN: Try to find donor in registered donors for additional info (including blood group)
    let donorRecord = await Donor.findOne({ uniqueId: donorId });

    // If not found by uniqueId, try matching by phone or name
    if (!donorRecord && locationRecord.mobileNumber) {
      donorRecord = await Donor.findOne({
        $or: [
          { phone: locationRecord.mobileNumber },
          { phone: locationRecord.mobileNumber.replace(/\s+/g, '') }
        ]
      });
      console.log('Donor found by phone:', donorRecord ? 'YES' : 'NO');
    }

    // If still not found, try by name
    if (!donorRecord && locationRecord.userName) {
      donorRecord = await Donor.findOne({
        name: { $regex: new RegExp('^' + locationRecord.userName.trim() + '$', 'i') }
      });
      console.log('Donor found by name:', donorRecord ? 'YES' : 'NO');
    }

    console.log('Donor record found:', donorRecord ? `${donorRecord.name} (${donorRecord.bloodGroup})` : 'NO (using location data)');

    // Get the actual requestId from the location record if available
    const actualRequestId = requestId || locationRecord.requestId;

    // Find or create blood request
    let bloodRequest = null;
    if (actualRequestId) {
      bloodRequest = await BloodRequest.findById(actualRequestId);
      console.log('Request found:', bloodRequest ? `YES (${bloodRequest.bloodGroup}, status: ${bloodRequest.status})` : 'NO');
    }

    // If no specific request found, try to find a matching pending request
    if (!bloodRequest && donorRecord?.bloodGroup) {
      bloodRequest = await BloodRequest.findOne({
        bloodGroup: donorRecord.bloodGroup,
        status: 'active'
      }).sort({ createdAt: -1 }); // Get the most recent one

      if (bloodRequest) {
        console.log('Found matching pending request:', bloodRequest._id, 'for blood group:', bloodRequest.bloodGroup);
      }
    }

    // Still no request? Create one
    if (!bloodRequest) {
      bloodRequest = await BloodRequest.create({
        hospitalId: new mongoose.Types.ObjectId(),
        bloodGroup: donorRecord?.bloodGroup || 'O+',
        quantity: 1,
        urgency: 'medium',
        status: 'active',
        requiredBy: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
      console.log('Created new request:', bloodRequest._id);
    }

    // Create donation history using location data primarily
    const donation = await DonationHistory.create({
      donorId: donorRecord ? donorRecord._id.toString() : donorId,
      bloodRequestId: bloodRequest._id,
      hospitalId: bloodRequest.hospitalId,
      donorName: donorRecord ? donorRecord.name : (locationRecord.userName || donorName || 'Unknown Donor'),
      donorPhone: donorRecord ? donorRecord.phone : (locationRecord.mobileNumber || '0000000000'),
      donorBloodGroup: donorRecord ? donorRecord.bloodGroup : 'Unknown',
      status: 'completed',
      completedAt: new Date(),
      location: {
        lat: locationRecord.latitude || 0,
        lng: locationRecord.longitude || 0
      },
      address: locationRecord.address || 'Location Shared',
      notes: `Manual Entry: ${donorId}`
    });

    console.log('✅ Donation saved:', donation._id);

    // Update donor's last donation date
    if (donorRecord) {
      donorRecord.lastDonationDate = new Date();
      await donorRecord.save();
      console.log(`✅ Updated donor ${donorRecord.name} last donation date to ${donorRecord.lastDonationDate}`);
    } else {
      // Try to find donor one more time by using the donorId from the request if it matches a uniqueId
      try {
        const d = await Donor.findOne({ uniqueId: donorId });
        if (d) {
          d.lastDonationDate = new Date();
          await d.save();
          console.log(`✅ Updated donor ${d.name} last donation date to ${d.lastDonationDate}`);
        }
      } catch (err) {
        console.log('Could not update donor last donation date:', err.message);
      }
    }

    // Update blood request - ATOMIC increment and fulfillment (Requirement 3 & 4)
    try {
      // 1. Expiry Check (Requirement 5)
      if (bloodRequest.status === 'active' && bloodRequest.requiredBy && new Date() > bloodRequest.requiredBy) {
        bloodRequest.status = 'expired';
        bloodRequest.activeTokens = [];
        await bloodRequest.save();
        processingLock.delete(donorId);
        return res.status(400).json({ success: false, error: 'Blood request has expired.' });
      }

      // 2. Atomic Update (Requirement 3)
      const token = locationRecord.token;
      const updatedRequest = await BloodRequest.findOneAndUpdate(
        {
          _id: bloodRequest._id,
          status: 'active',
          $expr: { $lt: ["$confirmedUnits", "$quantity"] },
          // If token-based, check token. If direct share, skip token check.
          ...(token && !token.startsWith('DIRECT_') ? { activeTokens: token } : {})
        },
        { $inc: { confirmedUnits: 1 } },
        { new: true }
      );

      if (!updatedRequest) {
        console.log('❌ Atomic update failed - Request fulfilled, expired, or invalid token');
        processingLock.delete(donorId);
        return res.status(400).json({
          success: false,
          status: 'closed',
          error: 'Blood request already fulfilled or expired.'
        });
      }

      // 3. Lock Request (Requirement 4)
      if (updatedRequest.confirmedUnits >= updatedRequest.quantity) {
        updatedRequest.status = 'fulfilled';
        updatedRequest.fulfilledAt = new Date();
        updatedRequest.activeTokens = []; // Clear activeTokens instantly (Requirement 4)
        updatedRequest.batchInProgress = false; // Stop batches
        await updatedRequest.save();
        console.log('✅ Request fulfilled and locked:', updatedRequest._id);
      } else {
        console.log(`✅ request confirmedUnits updated: ${updatedRequest.confirmedUnits}/${updatedRequest.quantity}`);
      }
    } catch (err) {
      console.log('⚠️ Request update failed:', err.message);
      processingLock.delete(donorId);
      return res.status(500).json({ success: false, error: 'Database update failed' });
    }

    // Remove from live map
    try {
      const locationRecord = await Location.findOne({ donorId: donorId });
      if (locationRecord) {
        await Location.deleteOne({ _id: locationRecord._id });
        console.log('✅ Removed from map');
      }
    } catch (err) {
      console.log('⚠️ Map removal failed (non-critical):', err.message);
    }

    // Keep lock permanently - donor has donated
    console.log('🔒 Permanently locked:', donorId, '(donated)');

    res.json({
      success: true,
      message: `Donation completed for ${donation.donorName}`,
      donationHistory: {
        id: donation._id,
        donorName: donation.donorName,
        bloodGroup: donation.donorBloodGroup,
        completedAt: donation.completedAt
      }
    });

  } catch (error) {
    console.error('❌ Error:', error);
    // Only release lock on error if donation wasn't saved
    processingLock.delete(donorId);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'API working', time: new Date() });
});

// Recent donations
router.get('/recent-donations', async (req, res) => {
  try {
    const donations = await DonationHistory.find({ status: 'completed' })
      .sort({ completedAt: -1 })
      .limit(50);
    res.json({ success: true, donations });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify donor from live locations
router.get('/verify-location/:donorId', async (req, res) => {
  try {
    const { donorId } = req.params;

    console.log('\n========================================');
    console.log('=== VERIFYING DONOR LOCATION ===');
    console.log('Donor ID received:', donorId);
    console.log('Donor ID type:', typeof donorId);
    console.log('Donor ID length:', donorId.length);
    console.log('========================================\n');

    // List all locations to debug
    const allLocations = await mongoose.connection.db.collection('locations').find({}).toArray();
    console.log('Total locations in collection:', allLocations.length);
    console.log('All donor IDs in collection:', allLocations.map(l => l.donorId));

    // Try direct MongoDB query first with exact match
    const directQuery = await mongoose.connection.db.collection('locations').findOne({ donorId: donorId });
    console.log('Direct MongoDB query result:', directQuery ? 'FOUND' : 'NOT FOUND');
    if (directQuery) {
      console.log('Found location:', JSON.stringify(directQuery, null, 2));
    }

    // Check if donor exists in locations (live map) using Mongoose
    const locationRecord = await Location.findOne({ donorId: donorId });
    console.log('Mongoose query result:', locationRecord ? 'FOUND' : 'NOT FOUND');

    if (!locationRecord && !directQuery) {
      console.log('❌ Not found in either query');
      console.log('Searched for donorId:', donorId);
      return res.status(404).json({
        success: false,
        message: `Donor with ID "${donorId}" not found on live map. Please ensure the donor has shared their location.`
      });
    }

    const location = locationRecord || directQuery;
    console.log('✅ Using location data:', {
      donorId: location.donorId,
      userName: location.userName,
      mobileNumber: location.mobileNumber
    });

    // Also try to get donor details from registered donors
    const donorRecord = await Donor.findOne({ uniqueId: donorId }, { password: 0 });
    console.log('Donor record found:', donorRecord ? 'YES' : 'NO');

    res.json({
      success: true,
      location: {
        donorId: location.donorId,
        userName: location.userName,
        rollNumber: location.rollNumber,
        mobileNumber: location.mobileNumber,
        address: location.address,
        latitude: location.latitude,
        longitude: location.longitude,
        timestamp: location.timestamp
      },
      donor: donorRecord ? {
        name: donorRecord.name,
        email: donorRecord.email,
        phone: donorRecord.phone,
        bloodGroup: donorRecord.bloodGroup,
        rollNumber: donorRecord.rollNumber
      } : null
    });
  } catch (error) {
    console.error('❌ Error verifying donor location:', error);
    res.status(500).json({ success: false, message: 'Failed to verify donor' });
  }
});

module.exports = router;