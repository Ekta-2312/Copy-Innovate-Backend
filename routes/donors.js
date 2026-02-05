
express = require('express');
const Donor = require('../models/Donor');
const Notification = require('../models/Notification');
const { broadcastNotification } = require('../utils/notificationStream');
const router = express.Router();

// GET /donors - Fetch all donors
router.get('/', async (req, res) => {
  try {
    const donors = await Donor.find({}, { password: 0 }); // Exclude password field
    res.json(donors);
  } catch (error) {
    console.error('Error fetching donors:', error);
    res.status(500).json({ message: 'Failed to fetch donors' });
  }
});

// GET /donors/:id - Fetch a specific donor
router.get('/:id', async (req, res) => {
  try {
    const donor = await Donor.findById(req.params.id, { password: 0 });
    if (!donor) {
      return res.status(404).json({ message: 'Donor not found' });
    }
    res.json(donor);
  } catch (error) {
    console.error('Error fetching donor:', error);
    res.status(500).json({ message: 'Failed to fetch donor' });
  }
});

// GET /donors/verify/:uniqueId - Verify a donor by uniqueId
router.get('/verify/:uniqueId', async (req, res) => {
  try {
    const donor = await Donor.findOne({ uniqueId: req.params.uniqueId }, { password: 0 });
    if (!donor) {
      return res.status(404).json({
        success: false,
        message: `Donor with ID "${req.params.uniqueId}" not found in system`
      });
    }
    res.json({
      success: true,
      donor: {
        uniqueId: donor.uniqueId,
        name: donor.name,
        email: donor.email,
        phone: donor.phone,
        bloodGroup: donor.bloodGroup,
        rollNumber: donor.rollNumber
      }
    });
  } catch (error) {
    console.error('Error verifying donor:', error);
    res.status(500).json({ success: false, message: 'Failed to verify donor' });
  }
});

// POST /donors - Create a new donor
router.post('/', async (req, res) => {
  try {
    const donor = new Donor(req.body);
    const savedDonor = await donor.save();

    // Create notification for donor creation
    try {
      const notif = await Notification.create({
        type: 'success',
        title: 'New Donor Added',
        message: `Donor ${savedDonor.name} (${savedDonor.email}) registered`,
        read: false,
        meta: { donorId: savedDonor._id }
      });
      broadcastNotification(notif);
    } catch (e) { console.error('Failed to create donor creation notification:', e.message); }

    res.status(201).json({ success: true, message: 'Donor created successfully', donor: savedDonor });
  } catch (error) {
    console.error('Error creating donor:', error);
    res.status(500).json({ success: false, message: 'Failed to create donor' });
  }
});

// PUT /donors/:id - Update a donor
router.put('/:id', async (req, res) => {
  try {
    const donor = await Donor.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!donor) {
      return res.status(404).json({ success: false, message: 'Donor not found' });
    }

    // Create notification for donor update
    try {
      const notif = await Notification.create({
        type: 'info',
        title: 'Donor Updated',
        message: `Donor ${donor.name} (${donor.email}) was updated`,
        read: false,
        meta: { donorId: donor._id }
      });
      broadcastNotification(notif);
    } catch (e) { console.error('Failed to create donor update notification:', e.message); }

    res.json({ success: true, message: 'Donor updated successfully', donor });
  } catch (error) {
    console.error('Error updating donor:', error);
    res.status(500).json({ success: false, message: 'Failed to update donor' });
  }
});

// DELETE /donors/:id - Delete a donor
router.delete('/:id', async (req, res) => {
  try {
    const donor = await Donor.findByIdAndDelete(req.params.id);
    if (!donor) {
      return res.status(404).json({ success: false, message: 'Donor not found' });
    }

    // Create notification for donor deletion
    try {
      const notif = await Notification.create({
        type: 'warning',
        title: 'Donor Deleted',
        message: `Donor ${donor.name} (${donor.email}) was deleted`,
        read: false,
        meta: { donorId: donor._id }
      });
      broadcastNotification(notif);
    } catch (e) { console.error('Failed to create donor deletion notification:', e.message); }

    res.json({ success: true, message: 'Donor deleted successfully' });
  } catch (error) {
    console.error('Error deleting donor:', error);
    res.status(500).json({ success: false, message: 'Failed to delete donor' });
  }
});

module.exports = router; 