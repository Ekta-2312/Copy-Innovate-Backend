const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ResponseToken = require('../models/ResponseToken');
const BloodRequest = require('../models/BloodRequest');
const Donor = require('../models/Donor');
const DonorLocationResponse = require('../models/DonorLocationResponse');

// GET route for token-based donor response
router.get('/r/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Find the token first without population
    const responseToken = await ResponseToken.findOne({ token, isUsed: false });

    if (!responseToken) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired response link'
      });
    }

    // Get request and donor details separately
    const request = await BloodRequest.findById(responseToken.requestId);
    const donor = await Donor.findById(responseToken.donorId);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Blood request no longer exists' });
    }

    // Check if fulfills logic
    const isFulfilled = request.status === 'fulfilled' || request.status === 'cancelled' || (request.confirmedUnits >= request.quantity);

    // Return token details for frontend
    res.json({
      success: true,
      data: {
        token: responseToken.token,
        request: request,
        donor: donor,
        isFulfilled: isFulfilled, // Explicit flag for frontend
        statusMessage: isFulfilled ? 'This blood request has already been fulfilled. Thank you for your support!' : null
      }
    });

  } catch (error) {
    console.error('Error fetching token:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// POST route to submit donor location response
router.post('/r/:token/respond', async (req, res) => {
  try {
    const { token } = req.params;
    const { latitude, longitude, isAvailable, address } = req.body;

    // Find and validate token without population
    const responseToken = await ResponseToken.findOne({ token, isUsed: false });

    if (!responseToken) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired response link'
      });
    }

    // Check request status
    const request = await BloodRequest.findById(responseToken.requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Blood request not found' });
    }

    if (request.status === 'fulfilled' || request.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Request already fulfilled',
        message: 'Thank you for your willingness to help, but this blood request has already been fulfilled.'
      });
    }

    // Get donor information
    const donor = await Donor.findById(responseToken.donorId);
    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor not found'
      });
    }

    // Save to locations collection instead of donorresponses
    const locationData = {
      address: address || `${donor.name} - Response Location`,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      accuracy: 0, // Default accuracy
      userName: donor.name,
      rollNumber: donor.rollNumber || '',
      mobileNumber: donor.phone,
      timestamp: new Date(),
      // Additional fields for blood request tracking
      requestId: responseToken.requestId,
      donorId: responseToken.donorId,
      token: token,
      isAvailable: isAvailable !== false,
      responseTime: new Date()
    };

    console.log('Attempting to save to locations collection:', locationData);

    // Save directly to locations collection
    const result = await mongoose.connection.db.collection('locations').insertOne(locationData);
    console.log('✅ Location response saved successfully to locations collection');

    // Mark token as used
    responseToken.isUsed = true;
    await responseToken.save();

    console.log(`✅ Location response saved for donor ${donor.name} at ${latitude}, ${longitude}`);

    res.json({
      success: true,
      message: 'Response recorded successfully',
      data: {
        donorId: responseToken.donorId,
        requestId: responseToken.requestId,
        latitude,
        longitude,
        isAvailable,
        address,
        responseTime: locationData.responseTime,
        locationId: result.insertedId
      }
    });

  } catch (error) {
    console.error('Error recording response:', error);
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);

    // Return specific error details for debugging
    res.status(500).json({
      success: false,
      message: 'Failed to record response',
      error: error.message,
      details: error.errors ? Object.keys(error.errors).join(', ') : 'Unknown error'
    });
  }
});

module.exports = router;
