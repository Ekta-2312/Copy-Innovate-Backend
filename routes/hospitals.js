const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const Hospital = require('../models/Hospital');

// GET all hospitals
router.get('/', async (req, res) => {
  try {
    console.log('Fetching all hospitals from database...');
    const docs = await Hospital.find({}, { password: 0 }).sort({ createdAt: -1 });
    console.log(`Found ${docs.length} hospitals`);

    const hospitals = docs.map(h => ({
      ...h.toObject(),
      id: h._id.toString(), // alias for frontend
      registeredAt: h.createdAt
    }));
    
    res.json({
      success: true,
      message: `Fetched ${hospitals.length} hospitals`,
      hospitals,
      count: hospitals.length
    });
  } catch (error) {
    console.error('Error fetching hospitals:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hospitals',
      error: error.message
    });
// ...existing code...

// GET single hospital by ID
router.get('/:id', async (req, res) => {
  try {
    const h = await Hospital.findById(req.params.id).select('-password');
    if (!h) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }
    const hospital = { ...h.toObject(), id: h._id.toString(), registeredAt: h.createdAt };
    res.json({
      success: true,
      hospital
    });
  } catch (error) {
    console.error('Error fetching hospital:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hospital',
      error: error.message
    });
  }
});

// POST create new hospital
router.post('/', async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email || !name) {
      return res.status(400).json({ success: false, message: 'Name and email are required' });
    }

    // Ensure unique email
    const existing = await Hospital.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Hospital with this email already exists' });
    }

    // Provide a password if not supplied (admin-created)
    let { password } = req.body;
    if (!password) {
      password = Math.random().toString(36).slice(-8); // simple temp password
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const hospital = new Hospital({
      name: req.body.name,
      email: email.toLowerCase(),
      password: hashedPassword,
      phone: req.body.phone,
      emergencyContact: req.body.emergencyContact,
      address: req.body.address,
      radius: req.body.radius,
      status: req.body.status || 'pending'
    });
    const savedHospital = await hospital.save();

    const hospitalObj = savedHospital.toObject();
    delete hospitalObj.password; // hide password

    hospitalObj.id = hospitalObj._id.toString();
    hospitalObj.registeredAt = hospitalObj.createdAt;

    // Create notification for hospital creation
    try {
      const notif = await Notification.create({
        hospitalId: savedHospital._id,
        type: 'success',
        title: 'Hospital Created',
        message: `Hospital ${savedHospital.name} (${savedHospital.email}) created successfully`,
        read: false,
        meta: { hospitalId: savedHospital._id }
      });
      broadcastNotification(notif);
    } catch (e) { console.error('Failed to create hospital creation notification:', e.message); }

    res.status(201).json({
      success: true,
      message: 'Hospital created successfully',
      hospital: hospitalObj,
      tempPassword: !req.body.password ? password : undefined
    });
  } catch (error) {
    console.error('Error creating hospital:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create hospital',
      error: error.message
    });
  }
});

// PUT update hospital
router.put('/:id', async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (updateData.email) updateData.email = updateData.email.toLowerCase();
    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }
    const hospital = await Hospital.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true, select: '-password' }
    );

    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    const hospitalObj = { ...hospital.toObject(), id: hospital._id.toString(), registeredAt: hospital.createdAt };
    
    // Create notification for hospital update
    try {
      const notif = await Notification.create({
        hospitalId: hospital._id,
        type: 'info',
        title: 'Hospital Updated',
        message: `Hospital ${hospital.name} (${hospital.email}) was updated`,
        read: false,
        meta: { hospitalId: hospital._id }
      });
      broadcastNotification(notif);
    } catch (e) { console.error('Failed to create hospital update notification:', e.message); }
    
    res.json({
      success: true,
      message: 'Hospital updated successfully',
      hospital: hospitalObj
    });
  } catch (error) {
    console.error('Error updating hospital:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update hospital',
      error: error.message
    });
  }
});

// DELETE hospital
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { broadcastNotification } = require('../utils/notificationStream');
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid hospital id' });
    }
    const hospital = await Hospital.findByIdAndDelete(id);
    if (!hospital) {
      const notif = await Notification.create({
        hospitalId: id,
        type: 'error',
        title: 'Hospital Delete Failed',
        message: `Hospital not found (id: ${id})`,
        read: false,
        meta: { hospitalId: id }
      });
      broadcastNotification(notif);
      return res.status(404).json({ success: false, message: 'Hospital not found' });

    }
    const notif = await Notification.create({
      hospitalId: id,
      type: 'warning',
      title: 'Hospital Deleted',
      message: `Hospital ${hospital.name || hospital.email || id} deleted`,
      read: false,
      meta: { hospitalId: id }
    });
    broadcastNotification(notif);
    res.json({ success: true, message: 'Hospital deleted successfully' });
  } catch (error) {
    console.error('Error deleting hospital:', error);
    const notif = await Notification.create({
      hospitalId: req.params.id,
      type: 'error',
      title: 'Hospital Delete Error',
      message: error.message,
      read: false,
      meta: { hospitalId: req.params.id }
    });
    broadcastNotification(notif);
    res.status(500).json({ success: false, message: 'Failed to delete hospital', error: error.message });
  }
});
  }
});

// PUT update hospital status
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const hospital = await Hospital.findByIdAndUpdate(
      req.params.id,
      { status },
  { new: true, select: '-password' }
    );
    
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }
    
    const hospitalObj = { ...hospital.toObject(), id: hospital._id.toString(), registeredAt: hospital.createdAt };
    res.json({
      success: true,
      message: `Hospital status updated to ${status}`,
      hospital: hospitalObj
    });
  } catch (error) {
    console.error('Error updating hospital status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update hospital status',
      error: error.message
    });
  }
});



module.exports = router;
